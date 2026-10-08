import base64
import json
import time

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.responder_credentials import CredentialIssuer, DeviceEnrollment, EnrollmentProof, credential_router


@pytest.fixture
def authority(tmp_path):
    key = ec.generate_private_key(ec.SECP256R1())
    path = tmp_path / "issuer.pem"
    path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    return CredentialIssuer(path, tmp_path / "state.sqlite3"), path


def device():
    key = ec.generate_private_key(ec.SECP256R1())
    public = base64.b64encode(key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)).decode()
    return key, DeviceEnrollment(node_id="phone-one", public_key=public)


def proof_for(issuer, key, enrollment):
    challenge = issuer.challenge(enrollment)["challenge"]
    signature = key.sign(base64.b64decode(challenge), ec.ECDSA(hashes.SHA256()))
    return EnrollmentProof(challenge=challenge, signature=base64.b64encode(signature).decode())


def test_enrollment_is_signed_and_bound_to_device(authority):
    issuer, _ = authority
    key, enrollment = device()
    proof = proof_for(issuer, key, enrollment)
    certificate = issuer.enroll(proof)["certificate"]
    raw = base64.b64decode(certificate["payload"])
    issuer.key.public_key().verify(base64.b64decode(certificate["signature"]), raw, ec.ECDSA(hashes.SHA256()))
    claims = json.loads(raw)
    assert claims["node_id"] == enrollment.node_id
    assert claims["public_key"] == enrollment.public_key
    assert claims["role"] == "responder"
    assert claims["expires"] - claims["not_before"] == 30 * 86400
    with pytest.raises(ValueError):
        issuer.enroll(proof)


def test_wrong_key_cannot_enroll(authority):
    issuer, _ = authority
    _, enrollment = device()
    wrong_key, _ = device()
    with pytest.raises(Exception):
        issuer.enroll(proof_for(issuer, wrong_key, enrollment))


def test_expired_challenge(authority):
    issuer, _ = authority
    key, enrollment = device()
    proof = proof_for(issuer, key, enrollment)
    with issuer.database() as db:
        db.execute("UPDATE challenges SET expires = ?", (int(time.time()) - 1,))
    with pytest.raises(ValueError):
        issuer.enroll(proof)


def test_enrollment_routes_require_dedicated_secret(authority, monkeypatch, tmp_path):
    _, path = authority
    monkeypatch.setenv("RESPONDER_ISSUER_KEY_PATH", str(path))
    monkeypatch.setenv("RESPONDER_ENROLLMENT_SECRET", "operator-only-secret")
    app = FastAPI()
    app.include_router(credential_router(tmp_path))
    client = TestClient(app)
    key, enrollment = device()
    for secret in [None, "rescue-admin-key-2026", "rescue-responder-shared-key-2026"]:
        headers = {"X-Credential-Admin-Key": secret} if secret else {}
        assert client.post("/api/responder-credentials/challenge", json=enrollment.model_dump(), headers=headers).status_code == 403
    headers = {"X-Credential-Admin-Key": "operator-only-secret"}
    challenge = client.post("/api/responder-credentials/challenge", json=enrollment.model_dump(), headers=headers).json()["challenge"]
    proof = {"challenge": challenge, "signature": base64.b64encode(key.sign(base64.b64decode(challenge), ec.ECDSA(hashes.SHA256()))).decode()}
    response = client.post("/api/responder-credentials/enroll", json=proof, headers=headers)
    assert response.status_code == 200
    assert client.post("/api/responder-credentials/enroll", json=proof, headers=headers).status_code == 422
    serial = json.loads(base64.b64decode(response.json()["certificate"]["payload"]))["serial"]
    assert client.post("/api/responder-credentials/revoke", json={"serial": serial}, headers=headers).status_code == 200
    revoked = client.get("/api/responder-credentials/revocations").json()
    assert serial in json.loads(base64.b64decode(revoked["payload"]))["serials"]


def test_unconfigured_issuer_fails_closed(monkeypatch, tmp_path):
    monkeypatch.delenv("RESPONDER_ISSUER_KEY_PATH", raising=False)
    monkeypatch.setenv("RESPONDER_ENROLLMENT_SECRET", "operator-only-secret")
    app = FastAPI(); app.include_router(credential_router(tmp_path))
    client = TestClient(app)
    assert client.get("/api/responder-credentials/revocations").status_code == 503
