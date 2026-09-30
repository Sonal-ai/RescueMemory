from __future__ import annotations

import hashlib
from pathlib import Path

from fastapi.testclient import TestClient
from qdrant_client import QdrantClient

from backend.app import cloud
from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.service import canonical


MODEL_CACHE = Path("data/model_cache")
MESH = {"X-Mesh-Key": "mesh-test-key"}
ADMIN = {"X-Node-Admin-Key": "admin-test-key"}


def test_authenticated_guide_update_and_command_correction(tmp_path):
    def client(name, role):
        return TestClient(create_app(Settings(
            name, role, tmp_path / name, MODEL_CACHE, "mesh-test-key", "responder-test-key",
            node_admin_key="admin-test-key", guide_trust_key="guide-test-key")))

    with client("hq", "central") as hq, client("a", "survivor") as survivor:
        guide = hq.post("/api/guides/publish", headers=ADMIN, json={
            "id": "shelter-guidance", "title": "Verified shelter update",
            "keywords": "shelter north gate", "summary": "Use the north gate shelter, as verified by command.",
            "steps": ["Go to the marked north gate shelter."], "warnings": ["Avoid flooded roads."],
            "source": "https://example.org/official-shelter-update", "reviewer": "Command reviewer",
        })
        assert guide.status_code == 200, guide.text
        exported = hq.get("/api/sync/guides/export", headers=MESH).json()["guides"]
        assert survivor.post("/api/sync/guides/import", headers=MESH,
                             json={"guides": exported}).json()["imported"] == 1
        assert survivor.post("/api/sync/guides/import", headers=MESH,
                             json={"guides": exported}).json()["duplicates"] == 1
        assert survivor.post("/api/chat", json={"text": "Where is north shelter?"}).json()["cards"][0]["id"] == "shelter-guidance"
        altered = {**exported[0], "summary": "Unsafe altered directions"}
        assert survivor.post("/api/sync/guides/import", headers=MESH,
                             json={"guides": [altered]}).status_code == 422

        danger = survivor.post("/api/reports", json={
            "kind": "checkpoint", "text": "Gate 3 flooded", "reporter_id": "p1",
            "entity_id": "gate-3", "status": "flooded",
            "location": {"lat": 28.7041, "lon": 77.1025},
        }).json()["event"]
        assert survivor.post("/api/reports", json={
            "kind": "checkpoint", "text": "Gate 3 open", "reporter_id": "p1",
            "entity_id": "gate-3", "status": "open", "verified": True,
        }).status_code == 403
        assert hq.post("/api/sync/import", headers=MESH,
                       json={"events": [danger]}).status_code == 200
        verified_response = hq.post("/api/reports", headers=ADMIN, json={
            "kind": "checkpoint", "text": "Gate 3 verified closed", "reporter_id": "command",
            "entity_id": "gate-3", "status": "blocked", "verified": True,
        })
        verified_response.raise_for_status()
        verified = verified_response.json()["event"]
        forged = {**verified, "text": "Gate 3 verified open", "status": "open"}
        forged["content_hash"] = hashlib.sha256(canonical({
            key: value for key, value in forged.items() if key not in {"id", "content_hash"}
        })).hexdigest()
        assert survivor.post("/api/sync/import", headers=MESH,
                             json={"events": [forged]}).status_code == 422
        assert survivor.post("/api/sync/import", headers=MESH,
                             json={"events": [verified]}).json()["imported"] == 1
        assert hq.get("/api/entities/gate-3").json()["effective"]["verified"] is True


def test_scoped_qdrant_cloud_mirror_and_pull(tmp_path, monkeypatch):
    cloud_dir = tmp_path / "cloud"
    monkeypatch.setattr(cloud, "QdrantClient", lambda **kwargs: QdrantClient(path=cloud_dir))

    def central(name):
        return TestClient(create_app(Settings(
            name, "central", tmp_path / name, MODEL_CACHE, "mesh-test-key", "responder-test-key",
            qdrant_url="https://test-cloud.invalid", node_admin_key="admin-test-key",
            guide_trust_key="guide-test-key")))

    with central("hq") as first:
        group = first.post("/api/groups", json={"name": "Camp Alpha"}).json()
        first.post("/api/reports", json={"kind": "hazard", "text": "Bridge closed",
                   "reporter_id": "p1", "location": {"lat": 28.7, "lon": 77.1}}).raise_for_status()
        first.post("/api/reports", headers={"X-Group-Token": group["token"]}, json={
            "kind": "resource", "text": "Group water cache", "reporter_id": "p1",
            "visibility": "group", "group_id": group["group_id"]}).raise_for_status()
        first.post("/api/reports", json={"kind": "incident", "text": "Injured survivor",
                   "reporter_id": "p2", "location": {"lat": 28.7, "lon": 77.1}}).raise_for_status()
        first.post("/api/guides/publish", headers=ADMIN, json={
            "id": "shelter", "title": "Shelter status bulletin", "keywords": "shelter status",
            "summary": "The command team has published a reviewed shelter bulletin.",
            "steps": ["Follow the posted shelter signs."], "warnings": [],
            "source": "https://example.org/official-bulletin", "reviewer": "Command reviewer",
        }).raise_for_status()
        result = first.post("/api/sync/cloud-mirror", headers=ADMIN)
        assert result.status_code == 200, result.text
        assert result.json()["events_uploaded"] == {"public": 1, "group": 1, "responders": 1}
        assert result.json()["guides_uploaded"] == 1

        status_res = first.get("/api/sync/cloud-status", headers=ADMIN)
        assert status_res.status_code == 200
        assert status_res.json()["connected"] is True
        assert "rescue_public_events" in status_res.json()["collections"]

    remote = QdrantClient(path=cloud_dir)
    try:
        for scope, collection in cloud.EVENT_COLLECTIONS.items():
            points, _ = remote.scroll(collection, limit=10, with_payload=True)
            assert len(points) == 1
            assert points[0].payload["visibility"] == scope
        guides, _ = remote.scroll(cloud.GUIDES_COLLECTION, limit=10, with_payload=True)
        assert len(guides) == 1
    finally:
        remote.close()

    with central("hq-restored") as restored:
        restored.post("/api/groups/join", json=group).raise_for_status()
        result = restored.post("/api/sync/cloud-mirror", headers=ADMIN)
        assert result.status_code == 200, result.text
        assert result.json()["events_downloaded"] == {"public": 1, "group": 1, "responders": 1}
        assert result.json()["guides_downloaded"] == 1
        assert restored.get("/health").json()["events"] == 3
        assert restored.post("/api/sync/cloud-mirror", headers=ADMIN).json()["events_uploaded"] == {
            "public": 0, "group": 0, "responders": 0}
