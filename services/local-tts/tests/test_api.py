"""Deterministic unit tests for Local Egyptian TTS Service."""
import os
import pytest
from fastapi.testclient import TestClient
from app.main import app

os.environ["ABUD_LOCAL_TTS_ASSUME_READY"] = "1"
os.environ["ABUD_LOCAL_TTS_MOCK"] = "1"

client = TestClient(app)

def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["status"] == "healthy"
    assert "hardware" in data
    assert "cpu_count" in data["hardware"]
    assert "kemetone" not in data["models_ready"]

def test_capabilities_endpoint():
    response = client.get("/capabilities")
    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "abud-shorts-local-tts"
    assert "voicetut" in data["supported_models"]
    assert "kemetone" in data["supported_models"]

def test_list_models_endpoint():
    response = client.get("/models")
    assert response.status_code == 200
    data = response.json()
    models = {m["id"]: m for m in data["models"]}
    assert "voicetut" in models
    assert "kemetone" in models
    assert models["voicetut"]["speakers_count"] == 17
    assert models["kemetone"]["speakers_count"] == 1
    assert models["kemetone"]["state"] in ("not_installed", "not_live_qualified")

def test_list_voices_voicetut():
    response = client.get("/voices?model=voicetut")
    assert response.status_code == 200
    data = response.json()
    assert data["model"] == "voicetut"
    assert len(data["voices"]) == 17
    names = [v["name"] for v in data["voices"]]
    assert "Mohamed" in names
    assert "Sarah" in names

def test_list_voices_kemetone():
    response = client.get("/voices?model=kemetone")
    assert response.status_code == 200
    data = response.json()
    assert data["model"] == "kemetone"
    assert len(data["voices"]) == 1

def test_synthesize_voicetut():
    payload = {
        "model": "voicetut",
        "text": "لو عندك بيزنس ولسه موقعك شكله قديم، موقع سريع وشكله احترافي هيفرق معاك.",
        "speakerId": "Mohamed",
        "speed": 1.0,
    }
    response = client.post("/synthesize", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["model"] == "voicetut"
    assert data["speakerId"] == "Mohamed"
    assert data["durationSeconds"] > 0
    assert data["sampleRate"] == 24000
    assert data["audioBase64"].startswith("data:audio/wav;base64,")

def test_synthesize_kemetone():
    payload = {
        "model": "kemetone",
        "text": "أهلاً بيكم في خدمة تصميم المواقع السريعة.",
        "speakerId": "kemetone",
        "speed": 1.0,
    }
    response = client.post("/synthesize", json=payload)
    assert response.status_code == 409
    assert "not installed" in response.json()["detail"]

def test_token_authentication(monkeypatch):
    monkeypatch.setattr("app.main.INTERNAL_SERVICE_TOKEN", "secret-test-token")
    
    # Missing token -> 401
    resp_unauth = client.get("/capabilities")
    assert resp_unauth.status_code == 401

    # Valid token -> 200
    resp_auth = client.get("/capabilities", headers={"x-internal-token": "secret-test-token"})
    assert resp_auth.status_code == 200
