"""Central-only exchange between Qdrant Edge memory and Qdrant Cloud/Server.

Qdrant Cloud is never called by survivor browsers. The central API is the
authorization boundary; separate collections reduce cross-scope mistakes.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import threading
from uuid import NAMESPACE_URL, UUID, uuid5

from fastapi import HTTPException
from qdrant_client import QdrantClient, models
from qdrant_client.http.exceptions import UnexpectedResponse
from qdrant_client.local.qdrant_local import QdrantLocal

from .service import RescueService
from .schemas import ReportRequest


EVENT_COLLECTIONS = {
    "public": "rescue_public_events",
    "group": "rescue_group_events",
    "responders": "rescue_responder_events",
}
GUIDES_COLLECTION = "rescue_approved_guides"


def _cloud_inventory(client: QdrantClient, available: list[str]) -> dict:
    """Count the same application collections the cloud record browser reads."""
    shards, errors = {}, {}
    names = [*EVENT_COLLECTIONS.values(), GUIDES_COLLECTION]
    available_set = set(available)

    def count_collection(name: str):
        if name not in available_set:
            return name, 0, None  # Collection list confirmed it is absent.
        try:
            return name, client.count(name, exact=True).count, None
        except Exception as exc:
            return name, None, str(exc)

    # Remote counts cost independent network round trips. Qdrant's local mode
    # has thread-affine storage, so keep that path on the calling thread.
    if isinstance(getattr(client, "_client", None), QdrantLocal):
        counted = map(count_collection, names)
        for name, value, error in counted:
            shards[name] = value
            if error is not None:
                errors[name] = error
    else:
        with ThreadPoolExecutor(max_workers=len(names)) as executor:
            for name, value, error in executor.map(count_collection, names):
                shards[name] = value
                if error is not None:
                    errors[name] = error
    return {"shards": shards, "count_errors": errors, "counts_verified": not errors,
            "total_points": sum(shards.values()) if not errors else None,
            "checked_at": datetime.now(timezone.utc).isoformat(), "source": "qdrant_cloud"}


def read_cloud_records(service: RescueService, collection: str, offset=None, limit: int = 50) -> dict:
    if collection not in [*EVENT_COLLECTIONS.values(), GUIDES_COLLECTION]:
        raise HTTPException(422, "Invalid cloud collection")
    if not service.settings.qdrant_url:
        raise HTTPException(503, "Cloud connection is not configured")
    client = QdrantClient(url=service.settings.qdrant_url,
                          api_key=service.settings.qdrant_api_key, timeout=10)
    try:
        try:
            points, next_offset = client.scroll(collection, offset=offset, limit=limit,
                                                with_payload=True, with_vectors=False)
        except UnexpectedResponse as exc:
            if exc.status_code != 404:
                raise
            points, next_offset = [], None
        items = [{"point_id": str(p.id), "payload": p.payload or {}} for p in points]
        def _record_timestamp(item):
            payload = item.get("payload") or {}
            val = (payload.get("observed_at") or payload.get("created_at") or 
                   payload.get("published_at") or payload.get("timestamp") or 
                   payload.get("updated_at") or payload.get("time") or "")
            return str(val)
        items.sort(key=_record_timestamp, reverse=True)
        return {"collection": collection, "items": items,
                "next_offset": next_offset, "source": "qdrant_cloud",
                "checked_at": datetime.now(timezone.utc).isoformat()}
    except Exception as exc:
        raise HTTPException(502, f"Cloud records could not be read: {exc}") from exc
    finally:
        client.close()


def _point_id(record_id: str) -> str:
    return str(uuid5(NAMESPACE_URL, record_id))


def _event_point_id(record: dict) -> str:
    source_id = record.get("source_report_id") or record["id"]
    # Matches the phone's strToUuid: first 16 SHA-256 bytes with UUID v4 bits.
    raw = bytearray(hashlib.sha256(source_id.encode()).digest()[:16])
    raw[6] = (raw[6] & 0x0f) | 0x40
    raw[8] = (raw[8] & 0x3f) | 0x80
    return str(UUID(bytes=bytes(raw)))


def _ensure_collection(client: QdrantClient, name: str, *, events: bool,
                       available: set[str] | None = None) -> None:
    exists = name in available if available is not None else client.collection_exists(name)
    if exists:
        return
    client.create_collection(
        name, vectors_config={"dense": models.VectorParams(size=384, distance=models.Distance.COSINE)}
    )
    fields = (("kind", models.PayloadSchemaType.KEYWORD),
              ("visibility", models.PayloadSchemaType.KEYWORD),
              ("group_id", models.PayloadSchemaType.KEYWORD),
              ("location", models.PayloadSchemaType.GEO)) if events else (
                  ("id", models.PayloadSchemaType.KEYWORD),)
    for field, kind in fields:
        client.create_payload_index(name, field, kind)
    if available is not None:
        available.add(name)


def _cloud_payloads(client: QdrantClient, name: str):
    offset = None
    while True:
        points, offset = client.scroll(name, limit=64, offset=offset,
                                       with_payload=True, with_vectors=False)
        for point in points:
            yield point
        if offset is None:
            break


def _upsert_new(client: QdrantClient, name: str, records: list[dict],
                service: RescueService, text_of) -> None:
    # Match reference seeding's small batches on memory-limited Render instances.
    for start in range(0, len(records), 16):
        batch = records[start:start + 16]
        vectors = list(service.memory.embedder.embed([text_of(record) for record in batch], batch_size=16))
        client.upsert(name, points=[
            models.PointStruct(id=_point_id(record["id"]) if name == GUIDES_COLLECTION else _event_point_id(record),
                               vector={"dense": vector.tolist()}, payload=record)
            for record, vector in zip(batch, vectors)
        ], wait=True)


def check_cloud_connection(service: RescueService) -> dict:
    """Read-only health check for Qdrant Cloud connectivity."""
    if not service.settings.qdrant_url:
        return {"connected": False, "configured": False, "reason": "QDRANT_URL missing"}
    client = QdrantClient(url=service.settings.qdrant_url,
                          api_key=service.settings.qdrant_api_key, timeout=10)
    try:
        raw_collections = client.get_collections().collections
        collections = [c.name for c in raw_collections]
        return {
            "connected": True,
            "configured": True,
            "url": service.settings.qdrant_url,
            "collections": collections,
            **_cloud_inventory(client, collections),
            "event_collections_found": [c for c in EVENT_COLLECTIONS.values() if c in collections],
            "guides_collection_found": GUIDES_COLLECTION in collections,
        }
    except Exception as exc:
        return {
            "connected": False,
            "configured": True,
            "url": service.settings.qdrant_url,
            "error": str(exc),
        }
    finally:
        client.close()


def purge_cloud_data(service: RescueService) -> dict:
    """Purge all points from all Qdrant Cloud collections and return updated 0 counts."""
    if not service.settings.qdrant_url:
        return {"purged": False, "reason": "QDRANT_URL missing"}
    client = QdrantClient(url=service.settings.qdrant_url,
                          api_key=service.settings.qdrant_api_key, timeout=20)
    purged_counts = {}
    try:
        collections = list(EVENT_COLLECTIONS.values()) + [GUIDES_COLLECTION]
        for c in collections:
            purged_counts[c] = 0
            if client.collection_exists(c):
                while True:
                    pts, _ = client.scroll(c, limit=500)
                    if not pts:
                        break
                    ids = [p.id for p in pts]
                    client.delete(c, points_selector=models.PointIdsList(points=ids), wait=True)
                    purged_counts[c] += len(ids)

        return {
            "purged": True, "purged_counts": purged_counts,
            **_cloud_inventory(client, [c.name for c in client.get_collections().collections]),
        }
    finally:
        client.close()


def mirror_to_qdrant_server(service: RescueService) -> dict:
    # Manual mirror and automatic uplinks must not race while normalizing IDs.
    if not hasattr(service, "_cloud_mirror_lock"):
        service._cloud_mirror_lock = threading.Lock()
    with service._cloud_mirror_lock:
        return _mirror_to_qdrant_server(service)


def _mirror_to_qdrant_server(service: RescueService) -> dict:
    """Exchange scoped events and centrally authenticated guides with Cloud."""
    if not service.settings.qdrant_url:
        raise ValueError("QDRANT_URL required")
    client = QdrantClient(url=service.settings.qdrant_url,
                          api_key=service.settings.qdrant_api_key, timeout=30)
    result = {"events_uploaded": {}, "events_downloaded": {}, "events_migrated": {},
              "guides_uploaded": 0, "guides_downloaded": 0}
    try:
        service.purge_expired()
        available = {c.name for c in client.get_collections().collections}
        for scope, collection in EVENT_COLLECTIONS.items():
            _ensure_collection(client, collection, events=True, available=available)
            existing: dict[str, str] = {}
            local_ids = {event["id"] for event in service.memory.all("events")}
            downloaded = 0
            cloud_events: list[dict] = []
            expired_points: list[str] = []
            legacy_points: dict[str, list] = {}
            for point in _cloud_payloads(client, collection):
                if not isinstance(point.payload, dict):
                    continue
                event = point.payload
                if event.get("visibility") != scope:
                    raise HTTPException(422, f"Cloud collection {collection} contains wrong scope")
                expiry = event.get("expires_at")
                if expiry:
                    try:
                        dt = datetime.fromisoformat(expiry)
                        if dt.tzinfo is None:
                            dt = dt.replace(tzinfo=timezone.utc)
                        if dt < datetime.now(timezone.utc):
                            expired_points.append(point.id)
                            continue
                    except (ValueError, TypeError):
                        pass
                if not event.get("id"):
                    continue
                if event.get("kind") in {"sos", "incident", "checkpoint", "resource", "hazard"} and str(point.id) != _event_point_id(event):
                    legacy_points.setdefault(event.get("source_report_id") or event["id"], []).append(point.id)
                existing[event["id"]] = event.get("content_hash") or ""
                if not event.get("content_hash"):
                    # Phone uploads are real reports too. Ingest them into the
                    # server feed before replacing the same point with its
                    # normalized, hash-checked server representation.
                    if event.get("kind") in {"sos", "incident", "checkpoint", "resource", "hazard"} and event["id"] not in local_ids:
                        try:
                            request = ReportRequest.model_validate({**event,
                                "idempotency_key": event.get("source_report_id") or event["id"],
                                "origin_device": event.get("origin_device") or event.get("reporter_id"),
                                "observed_at": event.get("observed_at") or event.get("created_at"),
                                "verified": bool(service.settings.prototype_access and event.get("prototype_confirmed"))})
                            service.report(request, mirror=False)
                            local_ids.add(request.idempotency_key)
                            downloaded += 1
                        except (ValueError, HTTPException) as exc:
                            import logging
                            logging.getLogger("rescue.cloud").warning("Phone report %s rejected: %s", event["id"], exc)
                    continue
                if scope != "group" or service.memory.get("groups", event.get("group_id") or ""):
                    cloud_events.append(event)
            if expired_points:
                client.delete(collection, points_selector=models.PointIdsList(
                    points=expired_points), wait=True)
            for start in range(0, len(cloud_events), 64):
                downloaded += service.import_events(cloud_events[start:start + 64])["imported"]
            local_events = [event for event in service.memory.all("events")
                            if event["visibility"] == scope]
            to_upload = [event for event in local_events if not existing.get(event["id"])
                         or (event.get("source_report_id") or event["id"]) in legacy_points]
            if to_upload:
                _upsert_new(client, collection, to_upload, service, lambda item: item["text"])
            # Delete only alternate point IDs for reports just committed at their
            # canonical hash ID. Separate initiations/entities are never merged.
            migrated = [point_id for event in to_upload
                        for point_id in legacy_points.get(event.get("source_report_id") or event["id"], [])]
            if migrated:
                client.delete(collection, points_selector=models.PointIdsList(points=migrated), wait=True)
            result["events_migrated"][scope] = len(migrated)
            result["events_uploaded"][scope] = len(to_upload)
            result["events_downloaded"][scope] = downloaded
            for event in to_upload:
                service.record_transfer(event["id"], service.settings.node_id, "qdrant-cloud")

        if service.settings.guide_trust_key:
            _ensure_collection(client, GUIDES_COLLECTION, events=False, available=available)
            existing_guides: dict[str, dict] = {}
            for point in _cloud_payloads(client, GUIDES_COLLECTION):
                if not isinstance(point.payload, dict) or "id" not in point.payload:
                    continue
                guide = point.payload
                try:
                    result["guides_downloaded"] += service.import_guides([guide])["imported"]
                    existing_guides[guide["id"]] = guide
                except Exception:
                    pass
            to_upload = [guide for guide in service.signed_guides()
                         if (guide["id"] not in existing_guides or
                             guide["version"] > existing_guides[guide["id"]]["version"])]
            _upsert_new(client, GUIDES_COLLECTION, to_upload, service,
                        lambda item: f"{item['title']} {item['keywords']} {item['summary']}")
            result["guides_uploaded"] = len(to_upload)

        result.update(_cloud_inventory(client, list(available)))
        result.update({"mirrored": True, "status": "ok"})
        return result
    finally:
        client.close()
