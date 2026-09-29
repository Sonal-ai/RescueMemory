from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    node_id: str
    role: str
    data_dir: Path
    model_cache: Path
    mesh_key: str
    responder_key: str
    central_url: str | None = None
    qdrant_url: str | None = None
    qdrant_api_key: str | None = None
    node_admin_key: str = ""
    guide_trust_key: str = ""
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.8-flash"
    discovery_port: int = 8888
    enable_discovery: bool = False

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv(override=False)
        node_id = os.getenv("NODE_ID", "survivor-a")
        role = os.getenv("NODE_ROLE", "survivor")
        if role not in {"survivor", "volunteer", "central"}:
            raise ValueError("NODE_ROLE must be survivor, volunteer or central")
        if role == "central":
            load_dotenv(".env.central", override=False)
        return cls(
            node_id=node_id,
            role=role,
            data_dir=Path(os.getenv("DATA_DIR", f"data/{node_id}")),
            model_cache=Path(os.getenv("MODEL_CACHE", "data/model_cache")),
            mesh_key=os.getenv("MESH_SHARED_KEY", ""),
            responder_key=os.getenv("RESPONDER_SHARED_KEY", ""),
            central_url=os.getenv("CENTRAL_URL"),
            qdrant_url=os.getenv("QDRANT_URL") if role == "central" else None,
            qdrant_api_key=os.getenv("QDRANT_API_KEY") if role == "central" else None,
            node_admin_key=os.getenv("NODE_ADMIN_KEY", ""),
            guide_trust_key=os.getenv("GUIDE_TRUST_KEY", ""),
            gemini_api_key=os.getenv("GEMINI_API_KEY", ""),
            gemini_model=os.getenv("GEMINI_MODEL", "gemini-3.8-flash"),
            discovery_port=int(os.getenv("DISCOVERY_PORT", "8888")),
            enable_discovery=os.getenv("ENABLE_DISCOVERY", "true").lower() in {"1", "true", "yes"},
        )
