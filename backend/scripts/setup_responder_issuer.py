"""Create a local command issuer and configure the matching APK trust root.

Run from the repository root. Keys/secrets stay in ignored local files. Copy the
issuer securely to the command backend before using this APK with that backend.
"""
from pathlib import Path
import base64
import secrets

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def main():
    root = Path(__file__).resolve().parents[2]
    directory = root / "data" / "credentials"
    directory.mkdir(parents=True, exist_ok=True)
    key_path = directory / "responder-issuer.pem"
    if not key_path.exists():
        key = ec.generate_private_key(ec.SECP256R1())
        with key_path.open("xb") as handle:
            handle.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                           serialization.NoEncryption()))
    key = serialization.load_pem_private_key(key_path.read_bytes(), password=None)
    public = base64.b64encode(key.public_key().public_bytes(serialization.Encoding.DER,
                                                          serialization.PublicFormat.SubjectPublicKeyInfo)).decode()
    config = root / ".env.responder"
    if not config.exists():
        config.write_text(f'RESPONDER_ISSUER_KEY_PATH="{key_path.as_posix()}"\n'
                          f'RESPONDER_ENROLLMENT_SECRET={secrets.token_urlsafe(48)}\n', encoding="utf-8")
    frontend_config = root / "frontend" / ".env.local"
    lines = frontend_config.read_text(encoding="utf-8").splitlines() if frontend_config.exists() else []
    existing = [line.split("=", 1)[1] for line in lines if line.startswith("VITE_RESPONDER_ISSUER_PUBLIC_KEY=")]
    if existing and existing != [public]:
        raise SystemExit("A different APK trust root is already configured. Preserve it; resolve the issuer configuration manually.")
    if not existing:
        with frontend_config.open("a", encoding="utf-8") as handle:
            handle.write(f"\nVITE_RESPONDER_ISSUER_PUBLIC_KEY={public}\n")
    print("Local issuer configured. Enrollment secret is stored in .env.responder (not printed).")
    print("The APK trust root is configured in frontend/.env.local. Rebuild after changing issuers.")


if __name__ == "__main__":
    main()
