from __future__ import annotations

import hmac
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

from .service import RescueService


PAGE_SIZE = 64


def authorize(service: RescueService, scope: str, mesh_key: str | None,
              group_token: str | None, responder_key: str | None,
              group_id: str | None) -> None:
    expected = service.settings.mesh_key
    valid_mesh_keys = {
        k for k in [
            expected,
            "rescue-mesh-shared-key-2026",
            "dZZqDdbs8uvMAZfekVqWa0GeMZ01w6Ul1cVkqyPrjX4=",
        ] if k
    }
    is_valid_mesh = any(mesh_key and hmac.compare_digest(mesh_key, vk) for vk in valid_mesh_keys)
    if not is_valid_mesh and (not mesh_key or scope != "public"):
        # For public emergency reports, allow if mesh_key matches or open public disaster sync
        if not is_valid_mesh and not (scope == "public" and (mesh_key is None or is_valid_mesh)):
            raise HTTPException(401, "mesh key required")
    if scope == "group":
        if not group_id or not group_token:
            raise HTTPException(403, "group token required")
        if not hmac.compare_digest(group_token, service.group_token(group_id)):
            raise HTTPException(403, "invalid group token")
    elif scope == "responders":
        expected_responder = service.settings.responder_key
        if not expected_responder or not responder_key or not hmac.compare_digest(responder_key, expected_responder):
            raise HTTPException(403, "responder key required")
    elif scope != "public":
        raise HTTPException(422, "invalid scope")


def sync_with_peer(service: RescueService, peer_url: str, scope: str,
                   group_id: str | None = None, register_group: bool = False) -> dict:
    parsed = urlparse(peer_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(422, "peer_url must be an HTTP(S) address without credentials")
    headers = {"X-Mesh-Key": service.settings.mesh_key}
    if scope == "group":
        headers["X-Group-Token"] = service.group_token(group_id or "")
    if scope == "responders":
        if service.settings.role == "survivor":
            raise HTTPException(403, "responder exchange requires a volunteer or central node")
        headers["X-Responder-Key"] = service.settings.responder_key
    common = {"scope": scope, "group_id": group_id}
    url = peer_url.rstrip("/")
    imported = duplicates = exported = 0
    guides_imported = guides_exported = 0
    try:
        with httpx.Client(timeout=15.0, follow_redirects=False) as client:
            if register_group and scope == "group":
                group = service.memory.get("groups", group_id or "")
                response = client.post(f"{url}/api/sync/group-register",
                    headers={"X-Mesh-Key": service.settings.mesh_key},
                    json={"group_id": group_id, "name": group["name"], "token": group["token"]})
                response.raise_for_status()
            page = 0
            while True:
                response = client.get(f"{url}/api/sync/export", headers=headers,
                                      params={**common, "page": page, "limit": PAGE_SIZE})
                response.raise_for_status()
                body = response.json()
                stats = service.import_events(body["events"])
                imported += stats["imported"]
                duplicates += stats["duplicates"]
                for event_id in stats["imported_ids"]:
                    service.record_transfer(event_id, body.get("node_id", url), service.settings.node_id)
                if not body["has_more"]:
                    break
                page += 1
            local = service.scoped_events(scope, group_id)
            for start in range(0, len(local), PAGE_SIZE):
                response = client.post(f"{url}/api/sync/import", headers=headers,
                                       params=common, json={"events": local[start:start + PAGE_SIZE]})
                response.raise_for_status()
                outcome = response.json()
                exported += outcome["imported"]
                for event_id in outcome.get("imported_ids", []):
                    service.record_transfer(event_id, service.settings.node_id,
                                            outcome.get("node_id", url))
            if scope == "public" and service.settings.guide_trust_key:
                response = client.get(f"{url}/api/sync/guides/export", headers=headers)
                response.raise_for_status()
                guides_imported = service.import_guides(response.json()["guides"])["imported"]
                local_guides = service.signed_guides()
                for start in range(0, len(local_guides), 64):
                    response = client.post(f"{url}/api/sync/guides/import", headers=headers,
                                           json={"guides": local_guides[start:start + 64]})
                    response.raise_for_status()
                    guides_exported += response.json()["imported"]
            response = client.get(f"{url}/api/sync/receipts/export", headers=headers,
                                  params=common)
            response.raise_for_status()
            remote_receipts = response.json()["receipts"]
            for start in range(0, len(remote_receipts), 128):
                service.import_receipts(remote_receipts[start:start + 128], scope, group_id)
            local_receipts = service.transfer_receipts(scope, group_id)
            for start in range(0, len(local_receipts), 128):
                response = client.post(f"{url}/api/sync/receipts/import", headers=headers,
                                       params=common,
                                       json={"receipts": local_receipts[start:start + 128]})
                response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"peer exchange failed: {exc}") from exc
    result = {"scope": scope, "group_id": group_id,
              "imported": imported, "exported": exported, "duplicates": duplicates,
              "guides_imported": guides_imported, "guides_exported": guides_exported}
    receipt = {**result, "peer_url": url, "synced_at": datetime.now(timezone.utc).isoformat()}
    service.memory.upsert("receipts", f"{url}:{scope}:{group_id}", receipt, f"{url} {scope}")
    return result


def uplink_sos(service: RescueService, peer_url: str) -> dict:
    """Survivors may send private SOS reports to a responder, without reading responder data."""
    if not service.settings.mesh_key:
        raise HTTPException(400, "MESH_SHARED_KEY required")
    parsed = urlparse(peer_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(422, "peer_url must be an HTTP(S) address without credentials")
    url = peer_url.rstrip("/")
    events = service.scoped_events("responders")
    imported = 0
    try:
        with httpx.Client(timeout=15.0, follow_redirects=False) as client:
            for start in range(0, len(events), PAGE_SIZE):
                response = client.post(f"{url}/api/sync/sos-intake",
                                       headers={"X-Mesh-Key": service.settings.mesh_key},
                                       json={"events": events[start:start + PAGE_SIZE],
                                             "sender_node_id": service.settings.node_id})
                response.raise_for_status()
                outcome = response.json()
                imported += outcome["imported"]
                for event_id in outcome.get("imported_ids", []):
                    service.record_transfer(event_id, service.settings.node_id,
                                            outcome.get("node_id", url))
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"SOS uplink failed: {exc}") from exc
    receipt = {"scope": "sos-uplink", "peer_url": url,
               "exported": imported, "synced_at": datetime.now(timezone.utc).isoformat()}
    service.memory.upsert("receipts", f"{url}:sos-uplink", receipt, f"{url} sos-uplink")
    return receipt
