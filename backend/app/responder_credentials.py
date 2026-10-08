"""Offline-verifiable responder enrollment. No client demo key grants this authority."""
from __future__ import annotations

import base64
import hmac
import json
import os
import secrets
import sqlite3
import time
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field


def encode(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def decode(data: str) -> bytes:
    return base64.b64decode(data, validate=True)


class DeviceEnrollment(BaseModel):
    node_id: str = Field(min_length=1, max_length=100)
    public_key: str = Field(max_length=1024)


class EnrollmentProof(BaseModel):
    challenge: str = Field(max_length=4096)
    signature: str = Field(max_length=256)


class RevokeCredential(BaseModel):
    serial: str = Field(min_length=1, max_length=100)


class CredentialIssuer:
    def __init__(self, private_key_path: Path, state_path: Path):
        self.key = serialization.load_pem_private_key(private_key_path.read_bytes(), password=None)
        if not isinstance(self.key, ec.EllipticCurvePrivateKey) or not isinstance(self.key.curve, ec.SECP256R1):
            raise ValueError("Responder issuer must use P-256")
        state_path.parent.mkdir(parents=True, exist_ok=True)
        self.state_path = state_path
        with self.database() as db:
            db.execute("CREATE TABLE IF NOT EXISTS challenges (token TEXT PRIMARY KEY, expires INTEGER, body TEXT)")
            db.execute("CREATE TABLE IF NOT EXISTS revoked (serial TEXT PRIMARY KEY)")

    def database(self):
        return sqlite3.connect(self.state_path)

    def sign(self, claims: dict) -> dict:
        payload = json.dumps(claims, sort_keys=True, separators=(",", ":")).encode()
        return {"payload": encode(payload), "signature": encode(self.key.sign(payload, ec.ECDSA(hashes.SHA256())))}

    def challenge(self, device: DeviceEnrollment) -> dict:
        public = serialization.load_der_public_key(decode(device.public_key))
        if not isinstance(public, ec.EllipticCurvePublicKey) or not isinstance(public.curve, ec.SECP256R1):
            raise ValueError("Device key must use P-256")
        token = secrets.token_urlsafe(32)
        claims = {"node_id": device.node_id, "public_key": device.public_key,
                  "nonce": token, "expires": int(time.time()) + 300}
        body = json.dumps(claims, sort_keys=True, separators=(",", ":"))
        with self.database() as db:
            db.execute("DELETE FROM challenges WHERE expires < ?", (int(time.time()),))
            db.execute("INSERT INTO challenges VALUES (?, ?, ?)", (token, claims["expires"], body))
        return {"challenge": encode(body.encode())}

    def enroll(self, proof: EnrollmentProof) -> dict:
        raw = decode(proof.challenge)
        claims = json.loads(raw)
        with self.database() as db:
            db.execute("BEGIN IMMEDIATE")
            saved = db.execute("SELECT expires, body FROM challenges WHERE token = ?", (claims.get("nonce"),)).fetchone()
            if not saved or saved[0] < time.time() or saved[1].encode() != raw:
                raise ValueError("Enrollment challenge expired or already used")
            key = serialization.load_der_public_key(decode(claims["public_key"]))
            key.verify(decode(proof.signature), raw, ec.ECDSA(hashes.SHA256()))
            now = int(time.time())
            certificate = self.sign({"version": 1, "node_id": claims["node_id"], "public_key": claims["public_key"],
                                     "role": "responder", "issuer": "rescuememory-command", "serial": secrets.token_hex(16),
                                     "not_before": now, "expires": now + 30 * 86400})
            db.execute("DELETE FROM challenges WHERE token = ?", (claims["nonce"],))
        return {"certificate": certificate}

    def revocations(self) -> dict:
        with self.database() as db:
            serials = [row[0] for row in db.execute("SELECT serial FROM revoked ORDER BY serial")]
        return self.sign({"version": 1, "issued_at": int(time.time()), "serials": serials})


def credential_router(state_dir: Path) -> APIRouter:
    router = APIRouter(prefix="/api/responder-credentials", tags=["Responder credentials"])
    issuer = None

    def configured() -> CredentialIssuer:
        nonlocal issuer
        key_path = os.getenv("RESPONDER_ISSUER_KEY_PATH")
        if not key_path:
            raise HTTPException(503, "Responder issuer is not configured on this backend")
        if issuer is None:
            try:
                issuer = CredentialIssuer(Path(key_path), state_dir / "responder-enrollment.sqlite3")
            except (ValueError, OSError):
                raise HTTPException(503, "Responder issuer configuration is invalid") from None
        return issuer

    def admin(secret: str | None):
        expected = os.getenv("RESPONDER_ENROLLMENT_SECRET", "")
        if not expected or not secret or not hmac.compare_digest(expected, secret):
            raise HTTPException(403, "Dedicated responder enrollment secret required")

    @router.post("/challenge")
    def challenge(device: DeviceEnrollment, x_credential_admin_key: str | None = Header(default=None)):
        admin(x_credential_admin_key)
        try:
            return configured().challenge(device)
        except (ValueError, TypeError):
            raise HTTPException(422, "Invalid device public key") from None

    @router.post("/enroll")
    def enroll(proof: EnrollmentProof, x_credential_admin_key: str | None = Header(default=None)):
        admin(x_credential_admin_key)
        try:
            return configured().enroll(proof)
        except (ValueError, KeyError, TypeError, InvalidSignature):
            raise HTTPException(422, "Invalid, expired, or replayed enrollment proof") from None

    @router.get("/revocations")
    def revocations():
        return configured().revocations()

    @router.post("/revoke")
    def revoke(request: RevokeCredential, x_credential_admin_key: str | None = Header(default=None)):
        admin(x_credential_admin_key)
        authority = configured()
        with authority.database() as db:
            db.execute("INSERT OR IGNORE INTO revoked VALUES (?)", (request.serial,))
        return {"revoked": request.serial}

    return router
