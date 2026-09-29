import time
import uuid
import logging
from typing import Dict, Any, List, Optional
from qdrant_client import QdrantClient
from qdrant_client.http import models

from backend.app.engine.embeddings import EdgeEmbedder

logger = logging.getLogger(__name__)


def record_local_incident(
    client: QdrantClient,
    embedder: EdgeEmbedder,
    mutable_collection: str,
    incident: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Persists a new casualty SOS report or localized hazard observation directly into local_mutable.
    Automatically marks synced=False for peer-to-peer mesh synchronization.
    """
    incident_id = incident.get("id") or incident.get("incident_id") or f"inc_{uuid.uuid4().hex[:8]}"
    text = incident.get("text", "")
    vector = embedder.embed_text(text)

    payload = {
        "record_type": "incident",
        "incident_id": incident_id,
        "title": incident.get("title", "Field Observation"),
        "text": text,
        "category": incident.get("category", "injury"),
        "severity": incident.get("severity", "immediate_red"),
        "location": incident.get("location", {"lat": 28.7495, "lon": 77.1182}),
        "checkpoint_id": incident.get("checkpoint_id"),
        "observed_at": incident.get("observed_at", time.strftime("%H:%M")),
        "origin_device": incident.get("origin_device", "node_local"),
        "synced": False
    }

    client.upsert(
        collection_name=mutable_collection,
        points=[models.PointStruct(id=str(uuid.uuid4()), vector=vector, payload=payload)]
    )

    return {
        "incident_id": incident_id,
        "status": "saved_locally",
        "synced": False,
        "observed_at": payload["observed_at"]
    }


def get_all_incidents(
    client: QdrantClient,
    mutable_collection: str,
    synced_only: Optional[bool] = None,
    limit: int = 100
) -> List[Dict[str, Any]]:
    """
    Retrieves recorded incidents from local_mutable, optionally filtered by sync status.
    """
    filter_must = [models.FieldCondition(key="record_type", match=models.MatchValue(value="incident"))]
    if synced_only is not None:
        filter_must.append(models.FieldCondition(key="synced", match=models.MatchValue(value=synced_only)))

    records = client.scroll(
        collection_name=mutable_collection,
        scroll_filter=models.Filter(must=filter_must),
        limit=limit,
        with_payload=True
    )[0]

    return [r.payload for r in records]
