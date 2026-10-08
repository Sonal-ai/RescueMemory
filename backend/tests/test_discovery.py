from __future__ import annotations

import json
import time
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.discovery import PeerDiscovery, distance_meters
from backend.app.main import create_app


MODEL_CACHE = Path("data/model_cache")


def test_distance_meters_calculation():
    # DTU Main Gate to nearby point (~150-200m)
    loc1 = {"lat": 28.7499, "lon": 77.1170}
    loc2 = {"lat": 28.7510, "lon": 77.1180}
    d = distance_meters(loc1, loc2)
    assert d is not None
    assert 100 < d < 200

    # Same location should be 0
    assert distance_meters(loc1, loc1) == 0.0

    # None handling
    assert distance_meters(None, loc1) is None
    assert distance_meters(loc1, None) is None


def test_peer_discovery_packet_and_distance():
    disc = PeerDiscovery(node_id="node-alpha", role="survivor", broadcast_port=8899)
    # Set my location
    disc.update_location(lat=28.7499, lon=77.1170, status="sos", battery=82)
    loc = disc.get_my_location()
    assert loc["lat"] == 28.7499
    assert loc["status"] == "sos"
    assert loc["battery"] == 82

    # Simulate incoming packet from peer "volunteer-bravo"
    packet = {
        "type": "rescue_beacon",
        "version": 1,
        "node_id": "volunteer-bravo",
        "role": "volunteer",
        "port": 8001,
        "lat": 28.7510,
        "lon": 77.1180,
        "status": "responder",
        "battery": 94,
        "timestamp": "2026-09-29T05:00:00Z",
    }
    raw = json.dumps(packet).encode("utf-8")
    disc._handle_incoming_packet(raw, "192.168.43.55")

    peers = disc.get_peers()
    assert len(peers) == 1
    peer = peers[0]
    assert peer["node_id"] == "volunteer-bravo"
    assert peer["ip"] == "192.168.43.55"
    assert peer["port"] == 8001
    assert peer["url"] == "http://192.168.43.55:8001"
    assert peer["role"] == "volunteer"
    assert peer["distance_m"] is not None
    assert 100 < peer["distance_m"] < 200
    assert peer["is_online"] is True

    # Ignore self packet
    self_packet = {
        "type": "rescue_beacon",
        "node_id": "node-alpha",
        "port": 8000,
    }
    disc._handle_incoming_packet(json.dumps(self_packet).encode("utf-8"), "127.0.0.1")
    assert len(disc.get_peers()) == 1


def test_discovery_api_endpoints(tmp_path):
    settings = Settings(
        "test-disc-node",
        "survivor",
        tmp_path / "node",
        MODEL_CACHE,
        "mesh-test",
        "responder-test",
        enable_discovery=False,  # don't bind UDP in unit tests
    )
    with TestClient(create_app(settings)) as client:
        # Check health
        health = client.get("/health").json()
        assert "discovery_enabled" in health
        assert health["discovery_enabled"] is False

        # Get peers (empty initially)
        peers_resp = client.get("/api/discovery/peers").json()
        assert peers_resp["peers"] == []
        assert peers_resp["count"] == 0
        assert peers_resp["node_id"] == "test-disc-node"

        # Update location
        loc_resp = client.post("/api/discovery/location", json={
            "lat": 28.7041,
            "lon": 77.1025,
            "status": "active",
            "battery": 90,
        })
        assert loc_resp.status_code == 200
        assert loc_resp.json()["updated"] is True
        assert loc_resp.json()["location"]["lat"] == 28.7041

        # Check that location is reflected in peers endpoint
        refreshed = client.get("/api/discovery/peers").json()
        assert refreshed["my_location"]["lat"] == 28.7041
        assert refreshed["my_location"]["battery"] == 90


def test_http_peer_cross_discovery(tmp_path):
    settings = Settings(
        "central-server",
        "central",
        tmp_path / "node",
        MODEL_CACHE,
        "mesh-test",
        "responder-test",
        enable_discovery=False,
    )
    with TestClient(create_app(settings)) as client:
        # Phone 1 registers location
        p1 = client.post("/api/discovery/location", json={
            "node_id": "phone-alpha",
            "device_name": "Phone Alpha (Host)",
            "role": "survivor",
            "lat": 28.7041,
            "lon": 77.1025,
            "battery": 92,
            "status": "active"
        })
        assert p1.status_code == 200
        assert p1.json()["registered_peer"]["node_id"] == "phone-alpha"
        assert client.get('/api/discovery/peers').json()['my_location']['battery'] is None

        # Phone 2 registers location (~135m away)
        p2 = client.post("/api/discovery/location", json={
            "node_id": "phone-bravo",
            "device_name": "Phone Bravo (Client)",
            "role": "survivor",
            "lat": 28.7050,
            "lon": 77.1035,
            "battery": 78,
            "status": "needs_help"
        })
        assert p2.status_code == 200

        # Phone 1 checks for peers (excludes self, returns Phone 2)
        p1_peers = client.get("/api/discovery/peers", params={
            "node_id": "phone-alpha",
            "lat": 28.7041,
            "lon": 77.1025,
        }).json()
        assert p1_peers["count"] == 1
        assert p1_peers["peers"][0]["node_id"] == "phone-bravo"
        assert p1_peers["peers"][0]["name"] == "Phone Bravo (Client)"
        assert p1_peers["peers"][0]["battery"] == 78
        assert p1_peers["peers"][0]["distance_m"] is not None
        assert 80 < p1_peers["peers"][0]["distance_m"] < 200

        # Phone 2 checks for peers (excludes self, returns Phone 1)
        p2_peers = client.get("/api/discovery/peers", params={
            "node_id": "phone-bravo",
            "lat": 28.7050,
            "lon": 77.1035,
        }).json()
        assert p2_peers["count"] == 1
        assert p2_peers["peers"][0]["node_id"] == "phone-alpha"
        assert p2_peers["peers"][0]["name"] == "Phone Alpha (Host)"
        assert p2_peers["peers"][0]["battery"] == 92

