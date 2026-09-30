"""Central-only exchange between Qdrant Edge memory and Qdrant Cloud/Server.

Qdrant Cloud is never called by survivor browsers. The central API is the
authorization boundary; separate collections reduce cross-scope mistakes.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import NAMESPACE_URL, uuid5

from fastapi import HTTPException
from qdrant_client import QdrantClient, models

from .service import RescueService


EVENT_COLLECTIONS = {
    "public": "rescue_public_events",
    "group": "rescue_group_events",
    "responders": "rescue_responder_events",
}
GUIDES_COLLECTION = "rescue_approved_guides"


def _point_id(record_id: str) -> str:
    return str(uuid5(NAMESPACE_URL, record_id))


def _ensure_collection(client: QdrantClient, name: str, *, events: bool) -> None:
    if client.collection_exists(name):
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
    for start in range(0, len(records), 64):
        batch = records[start:start + 64]
        vectors = list(service.memory.embedder.embed([text_of(record) for record in batch]))
        client.upsert(name, points=[
            models.PointStruct(id=_point_id(record["id"]),
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
        collections = [c.name for c in client.get_collections().collections]
        return {
            "connected": True,
            "configured": True,
            "url": service.settings.qdrant_url,
            "collections": collections,
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


def mirror_to_qdrant_server(service: RescueService) -> dict:
    """Exchange scoped events and centrally authenticated guides with Cloud."""
    if not service.settings.qdrant_url or not service.settings.qdrant_api_key:
        raise ValueError("QDRANT_URL and QDRANT_API_KEY required")
    client = QdrantClient(url=service.settings.qdrant_url,
                          api_key=service.settings.qdrant_api_key, timeout=30)
    result = {"events_uploaded": {}, "events_downloaded": {},
              "guides_uploaded": 0, "guides_downloaded": 0}
    try:
        service.purge_expired()
        for scope, collection in EVENT_COLLECTIONS.items():
            _ensure_collection(client, collection, events=True)
            existing: dict[str, str] = {}
            cloud_events: list[dict] = []
            expired_points: list[str] = []
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
                if not event.get("id") or not event.get("content_hash"):
                    continue
                existing[event["id"]] = event["content_hash"]
                if scope != "group" or service.memory.get("groups", event.get("group_id") or ""):
                    cloud_events.append(event)
            if expired_points:
                client.delete(collection, points_selector=models.PointIdsList(
                    points=expired_points), wait=True)
            downloaded = 0
            for start in range(0, len(cloud_events), 64):
                downloaded += service.import_events(cloud_events[start:start + 64])["imported"]
            local_events = [event for event in service.memory.all("events")
                            if event["visibility"] == scope]
            to_upload = [event for event in local_events if event["id"] not in existing]
            if to_upload:
                _upsert_new(client, collection, to_upload, service, lambda item: item["text"])
            result["events_uploaded"][scope] = len(to_upload)
            result["events_downloaded"][scope] = downloaded
            for event in to_upload:
                service.record_transfer(event["id"], service.settings.node_id, "qdrant-cloud")

        if service.settings.guide_trust_key:
            _ensure_collection(client, GUIDES_COLLECTION, events=False)
            existing_guides: dict[str, dict] = {}
            for point in _cloud_payloads(client, GUIDES_COLLECTION):
                if not isinstance(point.payload, dict) or "id" not in point.payload:
                    continue
                guide = point.payload
                try:
                    result["guides_downloaded"] += service.import_guides([guide])["imported"]
                except Exception:
                    pass
            to_upload = [guide for guide in service.signed_guides()
                         if (guide["id"] not in existing_guides or
                             guide["version"] > existing_guides[guide["id"]]["version"])]
            _upsert_new(client, GUIDES_COLLECTION, to_upload, service,
                        lambda item: f"{item['title']} {item['keywords']} {item['summary']}")
            result["guides_uploaded"] = len(to_upload)
        return result
    finally:
        client.close()
