import os
import logging
from typing import List, Dict, Any, Optional

from qdrant_client import QdrantClient

from backend.app.engine.embeddings import EdgeEmbedder
from backend.app.engine.collections import (
    REF_COLLECTION,
    MUTABLE_COLLECTION,
    VECTOR_DIM,
    init_collections as _init_collections,
)
from backend.app.engine.seeder import seed_reference_knowledge as _seed_reference_knowledge
from backend.app.engine.emergency_search import search_emergency_guidance as _search_emergency_guidance
from backend.app.engine.geo_discovery import (
    search_nearby_checkpoints as _search_nearby_checkpoints,
    recommend_alternative_shelter as _recommend_alternative_shelter,
)
from backend.app.engine.incident_manager import (
    record_local_incident as _record_local_incident,
    get_all_incidents as _get_all_incidents,
)

logger = logging.getLogger(__name__)


class QdrantEngine:
    """
    In-process, embedded Qdrant Edge engine running directly on the local file system.
    Strictly zero external server or Docker requirement.
    Acts as a modular facade over collections, seeder, emergency search, geo-discovery,
    and local incident management.
    """
    REF_COLLECTION = REF_COLLECTION
    MUTABLE_COLLECTION = MUTABLE_COLLECTION
    VECTOR_DIM = VECTOR_DIM

    def __init__(self, storage_path: str = "./data/qdrant_storage"):
        self.storage_path = os.path.abspath(storage_path)
        os.makedirs(self.storage_path, exist_ok=True)

        logger.info(f"Initializing Embedded Qdrant Edge at: {self.storage_path}")
        self.client = QdrantClient(path=self.storage_path)
        self.embedder = EdgeEmbedder()

    def init_collections(self) -> None:
        """Creates the dual-collection topology with Int8 Scalar Quantization in RAM."""
        _init_collections(self.client)

    def seed_reference_knowledge(self) -> int:
        """Ingests the 500+ disaster survival protocols and baseline checkpoints."""
        return _seed_reference_knowledge(self.client, self.embedder, self.REF_COLLECTION)

    def search_emergency_guidance(
        self,
        query_text: str,
        materials: Optional[List[str]] = None,
        breathing: bool = True,
        bleeding_type: str = "none",
        limit: int = 3
    ) -> Dict[str, Any]:
        """Retrieves life-saving survival procedures tailored to materials and vitals."""
        return _search_emergency_guidance(
            client=self.client,
            embedder=self.embedder,
            ref_collection=self.REF_COLLECTION,
            query_text=query_text,
            materials=materials,
            breathing=breathing,
            bleeding_type=bleeding_type,
            limit=limit
        )

    def search_nearby_checkpoints(
        self,
        lat: float,
        lon: float,
        radius_meters: float = 3000.0,
        required_facility: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Discovers nearby verified shelters with dynamic local hazard overlays."""
        return _search_nearby_checkpoints(
            client=self.client,
            ref_collection=self.REF_COLLECTION,
            mutable_collection=self.MUTABLE_COLLECTION,
            lat=lat,
            lon=lon,
            radius_meters=radius_meters,
            required_facility=required_facility
        )

    def recommend_alternative_shelter(
        self,
        compromised_checkpoint_id: str,
        avoid_hazard_text: str = "flooded entrance live wires"
    ) -> Dict[str, Any]:
        """Uses negative vector recommendation to find alternative safe shelter."""
        return _recommend_alternative_shelter(
            client=self.client,
            embedder=self.embedder,
            ref_collection=self.REF_COLLECTION,
            compromised_checkpoint_id=compromised_checkpoint_id,
            avoid_hazard_text=avoid_hazard_text
        )

    def record_local_incident(self, incident: Dict[str, Any]) -> Dict[str, Any]:
        """Persists a new casualty SOS report or localized hazard observation."""
        return _record_local_incident(
            client=self.client,
            embedder=self.embedder,
            mutable_collection=self.MUTABLE_COLLECTION,
            incident=incident
        )

    def get_all_incidents(self, synced_only: Optional[bool] = None, limit: int = 100) -> List[Dict[str, Any]]:
        """Retrieves recorded incidents from local_mutable."""
        return _get_all_incidents(
            client=self.client,
            mutable_collection=self.MUTABLE_COLLECTION,
            synced_only=synced_only,
            limit=limit
        )
