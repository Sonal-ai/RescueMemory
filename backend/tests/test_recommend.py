from pathlib import Path
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app


MODEL_CACHE = Path("data/model_cache")


def test_negative_vector_alternative_recommendation(tmp_path):
    settings = Settings("test-node-rec", "survivor", tmp_path / "node", MODEL_CACHE,
                        "mesh-test", "responder-test")
    with TestClient(create_app(settings)) as client:
        # 1. Test direct recommendation endpoint for compromised CP-17
        resp = client.post("/api/checkpoints/recommend-alternative", json={
            "compromised_id": "cp_17",
            "avoid_hazard": "flooded entrance live wires"
        })
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["compromised_id"] == "cp_17"
        rec = data["recommended"]
        assert rec is not None, "Expected an alternative shelter recommendation"
        assert rec["recommended_id"] in ["clinic_beta", "shelter_alpha"], f"Unexpected recommendation: {rec}"
        assert "score" in rec
        assert "rationale" in rec
        assert "flooded entrance live wires" in rec["rationale"]


def test_entity_timeline_includes_alternative_on_danger(tmp_path):
    settings = Settings("test-node-timeline", "survivor", tmp_path / "node", MODEL_CACHE,
                        "mesh-test", "responder-test")
    with TestClient(create_app(settings)) as client:
        # Report hazard on cp_17
        client.post("/api/reports", json={
            "kind": "hazard",
            "entity_id": "cp_17",
            "text": "Entrance is completely flooded with exposed downed power lines.",
            "status": "danger",
            "severity": "red",
            "visibility": "public",
            "reporter_id": "survivor-1"
        })

        # Query entity timeline
        timeline_resp = client.get("/api/entities/cp_17")
        assert timeline_resp.status_code == 200
        tl_data = timeline_resp.json()
        assert tl_data["entity_id"] == "cp_17"
        assert tl_data["effective"]["status"] == "danger"
        # Should automatically include alternative recommendation powered by negative vectors
        alt = tl_data.get("alternative_recommendation")
        assert alt is not None, "Expected automatic alternative recommendation on danger"
        assert alt["recommended_id"] in ["clinic_beta", "shelter_alpha"]
