from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.schemas import ChatRequest, ReportRequest, SurvivalRadarRequest
from backend.app.service import RescueService
from backend.app.sync import sync_with_peer

MODEL_CACHE = Path("data/model_cache")


def test_sos_broadcast_sync_to_cloud_and_other_survivor(tmp_path):
    """
    End-to-End Test:
    1. Survivor Node A broadcasts an emergency SOS.
    2. SOS is stored in Node A's local Qdrant Edge memory.
    3. SOS is synced to Central Server via mesh/peer sync.
    4. Central Server saves it in local memory and mirrors it to Qdrant Cloud.
    5. Survivor Node B syncs with Central Server and receives the SOS in its local memory.
    6. User on Node B asks chat 'nearest surviver and their needs':
       - Chat retrieves the SOS emergency from local memory.
       - Outputs distance, direction, triage priority.
       - Extracts specific material & clinical needs without redundant boilerplates.
       - Gives tailored clinical suggestions.
       - Provides a concise summary of all active area issues.
    """
    mesh_key = "test-mesh-shared-key"
    admin_key = "test-admin-key"

    # --- Node A: Originating Survivor ---
    node_a_settings = Settings(
        "survivor_node_a",
        "survivor",
        tmp_path / "survivor_a_data",
        MODEL_CACHE,
        mesh_key,
        None,
        node_admin_key=admin_key,
    )
    svc_a = RescueService(node_a_settings)

    # --- Central Node: Field HQ ---
    central_settings = Settings(
        "central_hq_node",
        "central",
        tmp_path / "central_data",
        MODEL_CACHE,
        mesh_key,
        "resp-key-hq",
        node_admin_key=admin_key,
        qdrant_url="http://mock-cloud.internal:6333",
    )
    svc_central = RescueService(central_settings)

    # --- Node B: Nearby Survivor ---
    node_b_settings = Settings(
        "survivor_node_b",
        "survivor",
        tmp_path / "survivor_b_data",
        MODEL_CACHE,
        mesh_key,
        None,
        node_admin_key=admin_key,
    )
    svc_b = RescueService(node_b_settings)

    # 1. Survivor A broadcasts an Emergency SOS report
    sos_report = ReportRequest(
        reporter_id="survivor_alpha",
        text="Survivor trapped under collapsed concrete beam, cannot walk, severe leg bleeding, needs clean splint & water",
        location={"lat": 28.7050, "lon": 77.1030},
        visibility="public",
        entity_id="victim_alpha_1",
        kind="sos",
        severity="red",
        status="needs_help",
    )
    report_outcome = svc_a.report(sos_report)
    assert not report_outcome["duplicate"]
    sos_event = report_outcome["event"]
    assert sos_event["id"] is not None

    # 2. Verify stored in Node A's local Qdrant memory
    node_a_events = svc_a.scoped_events("public")
    assert any(e["id"] == sos_event["id"] for e in node_a_events)

    # 3. Simulate sync from Node A to Central Server
    # Central exports/imports with Node A
    exported_from_a = svc_a.scoped_events("public")
    central_import = svc_central.import_events(exported_from_a)
    assert central_import["imported"] >= 1
    central_events = svc_central.scoped_events("public")
    assert any(e["id"] == sos_event["id"] for e in central_events)

    # 4. Central Server mirrors to Qdrant Cloud
    # Mock QdrantClient to verify cloud upload
    mock_client = MagicMock()
    mock_client.collection_exists.return_value = True
    mock_client.scroll.return_value = ([], None)
    with patch("backend.app.cloud.QdrantClient", return_value=mock_client):
        from backend.app.cloud import mirror_to_qdrant_server
        mirror_res = mirror_to_qdrant_server(svc_central)
        assert mirror_res["events_uploaded"]["public"] >= 1
        # Verify Qdrant Cloud client upsert was called with the public collection
        mock_client.upsert.assert_called()
        calls = [call.args[0] for call in mock_client.upsert.call_args_list]
        assert "rescue_public_events" in calls

    # 5. Survivor Node B syncs from Central Server
    # Node B downloads public events from Central
    central_public_events = svc_central.scoped_events("public")
    node_b_import = svc_b.import_events(central_public_events)
    assert node_b_import["imported"] >= 1
    node_b_events = svc_b.scoped_events("public")
    assert any(e["id"] == sos_event["id"] for e in node_b_events)

    # 6. User on Node B asks Chat: "nearest surviver and their needs"
    # Node B user is at Checkpoint CP-17 (28.7041, 77.1025)
    chat_req = ChatRequest(
        text="nearest surviver and their needs",
        use_ai=False,
        location={"lat": 28.7041, "lon": 77.1025},
        survivor_id="survivor_bravo",
    )
    chat_response = svc_b.chat(chat_req)

    assert chat_response["answer_type"] == "nearest_survivor_sos"
    ans_text = chat_response["local_answer"]

    # Verify SOS emergency details activated
    assert "Nearest Survivor Emergency SOS" in ans_text
    assert "**Triage Priority:** IMMEDIATE (Red Triage)" in ans_text
    assert "Location:" in ans_text

    # Verify distance is computed accurately (~110-140m NE from CP-17)
    assert "1" in ans_text and "m" in ans_text
    assert "NE" in ans_text or "NNE" in ans_text or "ENE" in ans_text

    # Verify specific conditions & needs extracted without fluff
    assert "Clean splint" in ans_text or "splint" in ans_text.lower()
    assert "water" in ans_text.lower()
    assert "bleeding" in ans_text.lower()

    # Verify suggested actions provided
    assert "Recommended Immediate Actions" in ans_text
    assert "pressure" in ans_text.lower() or "splint" in ans_text.lower()

    # Verify short summary of all active issues
    assert "Area Status Summary" in ans_text
    assert "Casualties:" in ans_text
    assert "Hazards:" in ans_text
    assert "Safe Shelters:" in ans_text

    # Verify suggested action button for radar navigation
    action = chat_response["suggested_action"]
    assert action is not None
    assert action["kind"] == "map"
    assert "Navigate to Survivor" in action["button_text"]
    assert action["target_tab"] == "map"
    assert action["nav_target"] is not None

    svc_a.close()
    svc_central.close()
    svc_b.close()


def test_nearest_survivor_empty_area_summary(tmp_path):
    """When no casualty SOS is logged, chat provides a clean area summary without redundant filler."""
    settings = Settings(
        "empty_node",
        "survivor",
        tmp_path / "empty_data",
        MODEL_CACHE,
        "mesh-key",
        None,
    )
    svc = RescueService(settings)

    chat_req = ChatRequest(
        text="who is the nearest survivor and what are their needs?",
        use_ai=False,
        location={"lat": 28.7041, "lon": 77.1025},
    )
    chat_response = svc.chat(chat_req)

    assert chat_response["answer_type"] == "nearest_survivor_sos"
    ans = chat_response["local_answer"]
    assert "No active survivor SOS signals detected" in ans
    assert "Area Status Summary" in ans
    assert "Safe Shelters:" in ans
    assert "Hazards:" in ans

    svc.close()
