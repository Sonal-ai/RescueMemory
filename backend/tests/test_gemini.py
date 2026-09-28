from __future__ import annotations

from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.gemini import grounded_answer
from backend.app.main import create_app


MODEL_CACHE = Path("data/model_cache")


def test_gemini_request_retries_transient_failure_and_cites_evidence(monkeypatch):
    calls = []

    def fake_post(url, *, headers, json, timeout):
        calls.append({"url": url, "headers": headers, "body": json, "timeout": timeout})
        request = httpx.Request("POST", url)
        if len(calls) == 1:
            return httpx.Response(503, request=request)
        return httpx.Response(200, request=request, json={"candidates": [
            {"content": {"parts": [{"text": "Use the north gate [G1]."}]}}
        ]})

    monkeypatch.setattr("backend.app.gemini.httpx.post", fake_post)
    monkeypatch.setattr("backend.app.gemini.time.sleep", lambda _: None)
    answer = grounded_answer("Where is shelter?", [{"title": "North gate",
        "summary": "The north gate shelter is open."}], [], "secret", "gemini-3.8-flash")
    assert answer == "Use the north gate [G1]."
    assert len(calls) == 2
    assert calls[0]["headers"] == {"x-goog-api-key": "secret"}
    assert '"label": "G1"' in calls[0]["body"]["contents"][0]["parts"][0]["text"]


def test_online_answer_uses_only_public_reports_and_local_fallback(tmp_path, monkeypatch):
    sent = []

    def fake_answer(question, cards, reports, api_key, model):
        sent.append({"question": question, "reports": reports, "key": api_key, "model": model})
        return "Water was reported at the north gate [R1]."

    monkeypatch.setattr("backend.app.service.grounded_answer", fake_answer)
    settings = Settings("node", "survivor", tmp_path / "node", MODEL_CACHE,
                        "mesh", "responders", gemini_api_key="test-gemini-key")
    with TestClient(create_app(settings)) as client:
        group = client.post("/api/groups", json={"name": "Camp"}).json()
        client.post("/api/reports", json={"kind": "resource", "text": "Water at north gate",
                                          "reporter_id": "p1"}).raise_for_status()
        client.post("/api/reports", headers={"X-Group-Token": group["token"]}, json={
            "kind": "resource", "text": "Private group water at north gate",
            "reporter_id": "p1", "visibility": "group", "group_id": group["group_id"],
        }).raise_for_status()
        result = client.post("/api/chat", headers={"X-Group-Token": group["token"]}, json={
            "text": "water north gate", "group_id": group["group_id"], "use_ai": True,
        })
        assert result.status_code == 200, result.text
        assert result.json()["ai_status"] == "answered"
        assert result.json()["ai_answer"].startswith("Water was reported")
        assert sent[0]["key"] == "test-gemini-key"
        assert sent[0]["model"] == "gemini-3.8-flash"
        assert all(report["visibility"] == "public" for report in sent[0]["reports"])
        assert all("Private group" not in report["text"] for report in sent[0]["reports"])
        local = client.post("/api/chat", json={"text": "water north gate"}).json()
        assert local["ai_status"] == "local_only"
        assert local["ai_answer"] is None
        no_evidence = client.post("/api/chat", json={"text": "I can't walk", "use_ai": True}).json()
        assert no_evidence["ai_status"] == "no_evidence"
        assert no_evidence["suggested_action"]["kind"] == "sos"
        assert len(sent) == 1


def test_gemini_failure_keeps_local_results(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.app.service.grounded_answer", lambda *args: None)
    settings = Settings("node", "survivor", tmp_path / "node", MODEL_CACHE,
                        "mesh", "responders", gemini_api_key="test-gemini-key")
    with TestClient(create_app(settings)) as client:
        result = client.post("/api/chat", json={"text": "How can I find safe water?", "use_ai": True})
        assert result.status_code == 200
        assert result.json()["ai_status"] == "unavailable"
        assert result.json()["ai_answer"] is None
        assert result.json()["cards"]


def test_offline_mobility_question_prepares_sos_without_saving(tmp_path):
    settings = Settings("node", "survivor", tmp_path / "node", MODEL_CACHE,
                        "mesh", "responders")
    with TestClient(create_app(settings)) as client:
        result = client.post("/api/chat", json={"text": "I can't walk and need help",
                                                 "use_ai": True})
        assert result.status_code == 200
        body = result.json()
        assert body["ai_status"] == "not_configured"
        assert body["suggested_action"]["kind"] == "sos"
        assert "Nothing was shared" in body["local_answer"]
        assert client.get("/health").json()["events"] == 0
