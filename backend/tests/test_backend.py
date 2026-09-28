from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app


MODEL_CACHE = Path("data/model_cache")


def node(tmp_path, name: str, role: str = "survivor"):
    settings = Settings(name, role, tmp_path / name, MODEL_CACHE, "mesh-test-key", "responder-test-key")
    return TestClient(create_app(settings))


def test_offline_search_presence_geo_and_restart(tmp_path):
    with node(tmp_path, "a") as client:
        response = client.post("/api/chat", json={
            "text": "Someone is bleeding badly from the leg",
            "survivor_id": "survivor-1", "share_location": True,
            "visibility": "public", "location": {"lat": 28.7041, "lon": 77.1025},
        })
        assert response.status_code == 200, response.text
        assert response.json()["cards"][0]["id"] == "first-aid-heavy-bleeding"
        assert response.json()["location_shared"] is True
        nearby = client.post("/api/map/nearby", json={
            "location": {"lat": 28.7041, "lon": 77.1025}, "radius_m": 1000,
        }).json()["items"]
        assert len(nearby) == 1
        assert nearby[0]["kind"] == "presence"
        assert nearby[0]["text"] == "Survivor requested help"
        assert nearby[0]["location"] == {"lat": 28.7, "lon": 77.1}
        assert nearby[0]["distance_m"] < 1000
    with node(tmp_path, "a") as restarted:
        assert restarted.get("/health").json()["events"] == 1


def test_dedup_conflict_and_geo_filter(tmp_path):
    with node(tmp_path, "a") as client:
        body = {"kind": "checkpoint", "text": "Bridge flooded", "reporter_id": "p1",
                "entity_id": "bridge-17", "status": "flooded", "location": {"lat": 28.7, "lon": 77.1}}
        first = client.post("/api/reports", json=body).json()
        second = client.post("/api/reports", json=body).json()
        assert first["duplicate"] is False
        assert second["duplicate"] is True
        assert first["event"]["id"] == second["event"]["id"]
        body.update({"text": "Bridge reopened", "status": "open"})
        client.post("/api/reports", json=body)
        state = client.get("/api/entities/bridge-17").json()
        assert state["conflict"] is True
        assert state["effective"]["status"] == "flooded"
        far = client.post("/api/map/nearby", json={"location": {"lat": 40, "lon": -70}, "radius_m": 1000})
        assert far.json()["items"] == []


def test_group_scoping_and_verified_import(tmp_path):
    with node(tmp_path, "a") as a, node(tmp_path, "b") as b:
        group = a.post("/api/groups", json={"name": "Camp Alpha"}).json()
        b.post("/api/groups/join", json=group)
        report = a.post("/api/reports", json={
            "kind": "resource", "text": "Clean water at north gate",
            "reporter_id": "p1", "visibility": "group", "group_id": group["group_id"],
            "location": {"lat": 28.7, "lon": 77.1},
        }, headers={"X-Group-Token": group["token"]}).json()["event"]
        assert a.get("/api/sync/export", params={"scope": "group", "group_id": group["group_id"]},
                     headers={"X-Mesh-Key": "mesh-test-key"}).status_code == 403
        headers = {"X-Mesh-Key": "mesh-test-key", "X-Group-Token": group["token"]}
        export = a.get("/api/sync/export", params={"scope": "group", "group_id": group["group_id"]},
                       headers=headers).json()["events"]
        assert len(export) == 1
        imported = b.post("/api/sync/import", params={"scope": "group", "group_id": group["group_id"]},
                          headers=headers, json={"events": export})
        assert imported.json()["imported"] == 1
        assert b.post("/api/sync/import", params={"scope": "group", "group_id": group["group_id"]},
                      headers=headers, json={"events": export}).json()["duplicates"] == 1
        assert b.post("/api/map/nearby", json={"location": {"lat": 28.7, "lon": 77.1}}).json()["items"] == []
        assert b.post("/api/map/nearby", json={"location": {"lat": 28.7, "lon": 77.1},
                                                 "group_id": group["group_id"]},
                      headers={"X-Group-Token": group["token"]}).json()["items"][0]["id"] == report["id"]
        tampered = dict(report, text="Bridge safe")
        response = b.post("/api/sync/import", params={"scope": "group", "group_id": group["group_id"]},
                          headers=headers, json={"events": [tampered]})
        assert response.status_code == 422


def test_private_sos_only_responder_intake(tmp_path):
    with node(tmp_path, "a") as survivor, node(tmp_path, "v", "volunteer") as volunteer:
        event = survivor.post("/api/reports", json={
            "kind": "incident", "text": "Cannot walk, injured leg", "reporter_id": "p1",
            "visibility": "responders", "location": {"lat": 28.7, "lon": 77.1},
        }).json()["event"]
        assert survivor.get("/api/sync/export", headers={"X-Mesh-Key": "mesh-test-key"}).json()["events"] == []
        assert volunteer.post("/api/sync/sos-intake", headers={"X-Mesh-Key": "mesh-test-key"},
                              json={"events": [event]}).json()["imported"] == 1
        assert volunteer.post("/api/map/nearby", json={"location": {"lat": 28.7, "lon": 77.1}}).json()["items"] == []
        response = volunteer.post("/api/map/nearby",
                                  headers={"X-Responder-Key": "responder-test-key"},
                                  json={"location": {"lat": 28.7, "lon": 77.1}, "include_responders": True})
        assert response.json()["items"][0]["id"] == event["id"]
