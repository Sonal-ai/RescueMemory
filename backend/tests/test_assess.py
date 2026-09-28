"""Tests for clinical and resource-adaptive triage in /api/assess and /api/chat."""

from pathlib import Path
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app


MODEL_CACHE = Path("data/model_cache")


def test_clinical_triage_unresponsive_cpr_override(tmp_path):
    settings = Settings("node-cpr", "survivor", tmp_path / "node", MODEL_CACHE,
                        "mesh-test", "responder-test")
    with TestClient(create_app(settings)) as client:
        # Query with unconscious/not breathing casualty
        resp = client.post("/api/assess", json={
            "query": "unresponsive casualty not breathing in rubble",
            "materials": [],
            "breathing": False,
            "bleeding_type": "none",
            "limit": 3
        })
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["triage_level"] == "critical_cpr"
        assert data["urgency"] == "immediate_red"
        assert data["breathing"] is False
        assert "CPR" in data["action_guidance"][0]
        # Top match should be CPR protocol
        top = data["top_match"]
        assert "cpr" in top["title"].lower() or "cpr" in top.get("category", "").lower() or "cpr" in top["id"].lower()
        assert top["clinical_boost"] > 0


def test_resource_adaptive_windlass_tourniquet_scoring(tmp_path):
    settings = Settings("node-tourniquet", "survivor", tmp_path / "node", MODEL_CACHE,
                        "mesh-test", "responder-test")
    with TestClient(create_app(settings)) as client:
        # Case A: Casualty with arterial bleed and matching stick + cloth
        resp_with_mats = client.post("/api/assess", json={
            "query": "spurting arterial bleed from thigh",
            "materials": ["stick", "cloth", "shirt"],
            "breathing": True,
            "bleeding_type": "spurting",
            "limit": 3
        })
        assert resp_with_mats.status_code == 200
        data_a = resp_with_mats.json()
        assert data_a["triage_level"] == "massive_hemorrhage"
        assert data_a["urgency"] == "immediate_red"
        top_a = data_a["top_match"]
        assert top_a is not None
        assert "tourniquet" in top_a["title"].lower() or "bleeding" in top_a["title"].lower()
        ass_a = top_a["materials_assessment"]
        assert "stick" in ass_a["matched"] or "cloth" in ass_a["matched"]
        assert top_a["material_boost"] > 0
        assert top_a["clinical_boost"] > 0

        # Case B: Chat endpoint incorporates resource match into answer
        chat_resp = client.post("/api/chat", json={
            "text": "I have a stick and a shirt, leg is spurting blood",
            "materials": ["stick", "shirt", "cloth"],
            "bleeding_type": "spurting",
            "use_ai": False
        })
        assert chat_resp.status_code == 200
        chat_data = chat_resp.json()
        assert chat_data["ai_status"] == "local_only"
        assert "Resource Match" in chat_data["local_answer"] or "guide" in chat_data["local_answer"].lower()
        assert chat_data["suggested_action"]["kind"] == "sos"
