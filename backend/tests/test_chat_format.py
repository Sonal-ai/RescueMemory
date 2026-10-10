from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app


def client(tmp_path, key="test-server-secret"):
    return TestClient(create_app(Settings("node", "survivor", tmp_path, Path("data/model_cache"),
                                         "mesh", "responders", gemini_api_key=key)))


def test_formats_client_retrieved_evidence_without_retrieving_different_context(tmp_path, monkeypatch):
    calls = []

    def fake(question, cards, reports, key, model):
        calls.append((question, cards, reports, key))
        return "Use the supplied guidance [G1]."

    monkeypatch.setattr("backend.app.main.grounded_answer", fake)
    result = client(tmp_path).post("/api/chat/format", json={"text": "water question", "cards": [
        {"id": "native-hit", "title": "Actual native guide", "steps": ["Actual step"]}],
        "reports": [{"text": "Water reported at gate", "visibility": "public", "observed_at": "2026-10-10T01:00:00Z"}]})
    assert result.status_code == 200
    assert result.json()["ai_status"] == "answered"
    assert calls[0][1][0]["id"] == "native-hit"
    assert calls[0][2][0]["observed_at"] == "2026-10-10T01:00:00Z"
    assert "verified" not in calls[0][2][0]
    assert calls[0][3] == "test-server-secret"
    assert "test-server-secret" not in result.text


def test_missing_key_and_gemini_failure_are_explicit_fallbacks(tmp_path, monkeypatch):
    body = {"text": "water question", "cards": [{"id": "guide", "title": "Water"}]}
    assert client(tmp_path, "").post("/api/chat/format", json=body).json()["ai_status"] == "not_configured"
    monkeypatch.setattr("backend.app.main.grounded_answer", lambda *args: None)
    result = client(tmp_path).post("/api/chat/format", json=body).json()
    assert result == {"ai_answer": None, "ai_status": "unavailable"}


def test_private_reports_and_unbounded_evidence_are_rejected(tmp_path):
    c = client(tmp_path)
    assert c.post("/api/chat/format", json={"text": "help", "reports": [
        {"text": "private", "visibility": "responders"}]}).status_code == 422
    assert c.post("/api/chat/format", json={"text": "help", "cards": [
        {"id": str(i), "title": "Guide"} for i in range(6)]}).status_code == 422
    assert c.post("/api/chat/format", json={"text": "help", "reports": [
        {"text": "x" * 2001, "visibility": "public"}]}).status_code == 422
