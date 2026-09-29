from __future__ import annotations

from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.discovery import calculate_bearing, calculate_cardinal
from backend.app.main import create_app
from backend.app.schemas import ReportRequest, SurvivalRadarRequest
from backend.app.service import RescueService

MODEL_CACHE = Path("data/model_cache")


def test_bearing_and_cardinal_calculations():
    # Due North: lat increases, lon constant
    bearing_n = calculate_bearing(28.0, 77.0, 28.1, 77.0)
    assert 355 <= bearing_n <= 360 or 0 <= bearing_n <= 5
    assert calculate_cardinal(bearing_n) == "N"

    # Due East: lat constant, lon increases
    bearing_e = calculate_bearing(28.0, 77.0, 28.0, 77.1)
    assert 85 <= bearing_e <= 95
    assert calculate_cardinal(bearing_e) == "E"

    # Due South: lat decreases, lon constant
    bearing_s = calculate_bearing(28.0, 77.0, 27.9, 77.0)
    assert 175 <= bearing_s <= 185
    assert calculate_cardinal(bearing_s) == "S"

    # Due West: lat constant, lon decreases
    bearing_w = calculate_bearing(28.0, 77.0, 28.0, 76.9)
    assert 265 <= bearing_w <= 275
    assert calculate_cardinal(bearing_w) == "W"


def test_survival_radar_service(tmp_path):
    settings = Settings(
        "test_node_radar",
        "volunteer",
        tmp_path / "radar_node",
        MODEL_CACHE,
        "mesh-test",
        "resp-test-key",
    )
    svc = RescueService(settings)

    # 1. Ingest an urgent casualty incident into Qdrant memory (responders-visible)
    casualty_report = ReportRequest(
        reporter_id="rescuer_alpha",
        text="Survivor trapped under collapsed beam, cannot walk, severe arterial leg bleeding",
        location={"lat": 28.7050, "lon": 77.1030},
        visibility="responders",
        entity_id="victim_alpha",
        kind="incident",
        severity="red",
        status="active",
    )
    svc.report(casualty_report)

    # 2. Ingest a public hazard
    hazard_report = ReportRequest(
        reporter_id="rescuer_beta",
        text="Dangerous high voltage power line sparking into flood pool",
        location={"lat": 28.7048, "lon": 77.1028},
        visibility="public",
        entity_id="hazard_delta",
        kind="hazard",
        severity="red",
        status="active",
    )
    svc.report(hazard_report)

    # 3. Simulate discovered Wi-Fi peers
    peers = [
        {
            "node_id": "survivor_phone_01",
            "role": "survivor",
            "lat": 28.7042,
            "lon": 77.1027,
            "ip": "192.168.1.105",
            "port": 8888,
            "is_online": True,
        }
    ]

    # Run Radar centered near user (CP-17 at 28.7041, 77.1025)
    req = SurvivalRadarRequest(
        lat=28.7041,
        lon=77.1025,
        radius_m=2000.0,
        filter_category="all",
        include_responders=True,
    )
    radar_res = svc.survival_radar(req, peers=peers)

    assert radar_res["total_found"] > 0
    items = radar_res["radar_items"]

    # Verify items are sorted by distance
    distances = [i["distance_m"] for i in items]
    assert distances == sorted(distances)

    # Find the urgent casualty in radar items
    casualty_items = [i for i in items if i["category"] == "casualty"]
    assert len(casualty_items) >= 1
    c = casualty_items[0]
    assert c["triage_level"] == "immediate_red"
    assert c["distance_m"] > 0
    assert 0 <= c["bearing_deg"] <= 360
    assert c["cardinal"] in ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    assert c["walk_time_min"] >= 1

    # Verify baseline checkpoints are loaded
    shelters = [i for i in items if i["category"] == "shelter"]
    assert len(shelters) >= 1
    assert any("Shelter Alpha" in s["name"] or "Clinic Beta" in s["name"] for s in shelters)

    # Verify Wi-Fi / Bluetooth peer is mapped with RSSI
    peer_items = [i for i in items if i["category"] == "peer"]
    assert len(peer_items) == 1
    p = peer_items[0]
    assert p["signal_source"] == "wifi_direct"
    assert "signal_dbm" in p
    assert p["signal_dbm"] < 0
    assert p["signal_quality"] in ["strong", "moderate", "weak"]

    # Test filtering by category: casualties only
    req_cas = SurvivalRadarRequest(
        lat=28.7041,
        lon=77.1025,
        radius_m=2000.0,
        filter_category="casualties",
        include_responders=True,
    )
    res_cas = svc.survival_radar(req_cas, peers=peers)
    for it in res_cas["radar_items"]:
        assert it["category"] == "casualty"

    svc.close()


def test_survival_radar_endpoints(tmp_path):
    settings = Settings(
        "test_api_radar",
        "volunteer",
        tmp_path / "radar_api_node",
        MODEL_CACHE,
        "mesh-test",
        "resp-pass",
    )
    app = create_app(settings)
    with TestClient(app) as client:
        # Post a responder-scoped casualty report
        post_resp = client.post(
            "/api/reports",
            headers={"X-Responder-Key": "resp-pass"},
            json={
                "reporter_id": "field_medic_1",
                "text": "Elderly survivor injured in basement, cannot walk",
                "location": {"lat": 28.7055, "lon": 77.1035},
                "visibility": "responders",
                "kind": "incident",
                "severity": "red",
            },
        )
        assert post_resp.status_code == 200, post_resp.text

        # 1. Test POST /api/survival-finder/radar with responder key
        resp = client.post(
            "/api/survival-finder/radar",
            headers={"X-Responder-Key": "resp-pass"},
            json={
                "lat": 28.7041,
                "lon": 77.1025,
                "radius_m": 3000.0,
                "filter_category": "all",
                "include_responders": True,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "radar_items" in data
        assert "summary" in data
        assert data["total_found"] > 0
        assert data["summary"]["total_casualties"] >= 1

        # 2. Test GET /api/survival-finder/radar with query params
        resp_get = client.get(
            "/api/survival-finder/radar?lat=28.7041&lon=77.1025&radius_m=2500",
            headers={"X-Responder-Key": "resp-pass"},
        )
        assert resp_get.status_code == 200
        data_get = resp_get.json()
        assert data_get["total_found"] > 0
        assert data_get["radius_m"] == 2500
