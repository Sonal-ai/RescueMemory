from pathlib import Path

from dotenv import dotenv_values

from backend.app import config
from backend.scripts.setup_responder_issuer import main as setup_issuer


def clean_settings_environment(monkeypatch):
    monkeypatch.setattr(config.os, "environ", dict(config.os.environ))
    for key in ["NODE_ID", "NODE_ROLE", "QDRANT_URL", "QDRANT_API_KEY",
                "GEMINI_API_KEY", "RESPONDER_ISSUER_KEY_PATH", "RESPONDER_ENROLLMENT_SECRET"]:
        monkeypatch.delenv(key, raising=False)


def test_only_root_env_is_loaded_and_legacy_fallbacks_are_ignored(monkeypatch, tmp_path):
    clean_settings_environment(monkeypatch)
    monkeypatch.setattr(config, "__file__", str(tmp_path / "backend/app/config.py"))
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".env").write_text("NODE_ROLE=central\nQDRANT_URL=https://root.invalid\nQDRANT_API_KEY=root-key\nGEMINI_API_KEY=root-gemini\n")
    (tmp_path / ".env.central").write_text("QDRANT_URL=https://legacy.invalid\nRESPONDER_ENROLLMENT_SECRET=legacy-central\n")
    (tmp_path / ".env.responder").write_text("RESPONDER_ENROLLMENT_SECRET=legacy-responder\n")
    settings = config.Settings.from_env()
    assert settings.role == "central"
    assert settings.qdrant_url == "https://root.invalid"
    assert settings.qdrant_api_key == "root-key"
    assert settings.gemini_api_key == "root-gemini"
    import os
    assert os.getenv("RESPONDER_ENROLLMENT_SECRET") is None


def test_render_environment_overrides_root_file_without_any_env_file_requirement(monkeypatch, tmp_path):
    clean_settings_environment(monkeypatch)
    monkeypatch.setattr(config, "__file__", str(tmp_path / "backend/app/config.py"))
    (tmp_path / ".env").write_text("NODE_ROLE=survivor\nQDRANT_URL=https://local.invalid\nQDRANT_API_KEY=local-key\n")
    monkeypatch.setenv("NODE_ROLE", "central")
    monkeypatch.setenv("QDRANT_URL", "https://render.invalid")
    monkeypatch.setenv("QDRANT_API_KEY", "render-key")
    for exists in [True, False]:
        if not exists:
            (tmp_path / ".env").unlink()
        settings = config.Settings.from_env()
        assert settings.role == "central"
        assert settings.qdrant_url == "https://render.invalid"
        assert settings.qdrant_api_key == "render-key"


def test_issuer_setup_keeps_existing_backend_settings_secret_and_apk_trust_root(tmp_path):
    (tmp_path / "frontend").mkdir()
    env = tmp_path / ".env"
    env.write_text("QDRANT_API_KEY=existing-cloud-key\nRESPONDER_ENROLLMENT_SECRET=existing-enrollment-secret\n")
    setup_issuer(tmp_path)
    first = dotenv_values(env)
    assert first["QDRANT_API_KEY"] == "existing-cloud-key"
    assert first["RESPONDER_ENROLLMENT_SECRET"] == "existing-enrollment-secret"
    key = Path(first["RESPONDER_ISSUER_KEY_PATH"])
    original_key = key.read_bytes()
    trust_root = (tmp_path / "frontend/.env.local").read_bytes()
    setup_issuer(tmp_path)
    assert dotenv_values(env) == first
    assert key.read_bytes() == original_key
    assert (tmp_path / "frontend/.env.local").read_bytes() == trust_root
    assert not (tmp_path / ".env.responder").exists()
    assert not (tmp_path / ".env.central").exists()
