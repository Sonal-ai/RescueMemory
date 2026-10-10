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

    svc.report(ReportRequest(kind="checkpoint", text="Operator entered hall (Shelter)",
        reporter_id="operator", entity_id="entered-hall", status="operational", severity="green",
        location={"lat": 28.7042, "lon": 77.1026}, visibility="public"))

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
    assert c["walk_time_min"] is None

    # Only operator-entered destinations appear; reference examples stay hidden.
    shelters = [i for i in items if i["category"] == "shelter"]
    assert len(shelters) >= 1
    assert shelters[0]["name"] == "Operator entered hall"

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


def test_central_to_local_sync_and_nearest_survivor_compass(tmp_path):
    """
    Simulates the exact user workflow:
    1. A survivor uploads an emergency SOS report to Central server.
    2. Central syncs the report down into the local edge node's Qdrant memory.
    3. The local node retrieves the nearest survivor position from local memory.
    4. Survival radar calculates bearing azimuth, distance, and heading for the compass needle.
    """
    # Setup Central Node
    central_settings = Settings(
        "central_hq",
        "central",
        tmp_path / "central_data",
        MODEL_CACHE,
        "mesh-secret-key",
        "resp-secret-key",
    )
    central_svc = RescueService(central_settings)

    # Setup Local Rescuer Edge Node
    local_settings = Settings(
        "local_rescuer_node",
        "volunteer",
        tmp_path / "local_data",
        MODEL_CACHE,
        "mesh-secret-key",
        "resp-secret-key",
    )
    local_svc = RescueService(local_settings)

    # 1. Survivor report uploaded to Central
    survivor_report = ReportRequest(
        reporter_id="survivor_phone_99",
        text="Survivor trapped under collapsed ceiling, cannot walk, severe leg bleeding",
        location={"lat": 28.7060, "lon": 77.1040},
        visibility="responders",
        entity_id="survivor_john_doe",
        kind="incident",
        severity="red",
        status="active",
    )
    central_outcome = central_svc.report(survivor_report)
    assert not central_outcome["duplicate"]

    # 2. Sync from Central to Local Node Memory (export from central, import into local)
    central_events = central_svc.scoped_events("responders")
    assert len(central_events) >= 1
    import_result = local_svc.import_events(central_events)
    assert import_result["imported"] >= 1

    # 3. Local node executes RAG spatial retrieval & polar compass calculation
    # Rescuer is located at Checkpoint CP-17 (28.7041, 77.1025)
    rescuer_loc = {"lat": 28.7041, "lon": 77.1025}
    radar_req = SurvivalRadarRequest(
        lat=rescuer_loc["lat"],
        lon=rescuer_loc["lon"],
        radius_m=3500.0,
        filter_category="all",
        include_responders=True,
    )
    radar_res = local_svc.survival_radar(radar_req)

    # 4. Verify nearest survivor is retrieved from local memory
    summary = radar_res["summary"]
    assert summary["total_casualties"] >= 1
    nearest = summary["nearest_casualty"]
    assert nearest is not None
    assert nearest["id"] == "survivor_john_doe" or "survivor_john_doe" in str(nearest)
    assert nearest["triage_level"] == "immediate_red"

    # 5. Verify polar coordinates for compass needle pointing
    assert 200 <= nearest["distance_m"] <= 400
    # Expected bearing from (28.7041, 77.1025) to (28.7060, 77.1040) is ~30° to 45° (North-Northeast)
    assert 20 <= nearest["bearing_deg"] <= 50
    assert nearest["cardinal"] in ["NNE", "NE"]
    assert nearest["walk_time_min"] is None

    # Verify origin and local memory signal source
    assert nearest["signal_source"] == "qdrant_memory"

    central_svc.close()
    local_svc.close()

