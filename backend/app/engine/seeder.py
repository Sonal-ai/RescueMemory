import os
import json
import uuid
import logging
from typing import List, Tuple, Dict, Any
from qdrant_client import QdrantClient
from qdrant_client.http import models

from backend.app.engine.collections import REF_COLLECTION, init_collections
from backend.app.engine.embeddings import EdgeEmbedder

logger = logging.getLogger(__name__)


def seed_reference_knowledge(
    client: QdrantClient,
    embedder: EdgeEmbedder,
    ref_collection: str = REF_COLLECTION
) -> int:
    """
    Ingests the curated 500+ disaster survival protocols and baseline checkpoints
    into the immutable reference collection.
    """
    init_collections(client)

    # Check if already seeded
    count = client.count(collection_name=ref_collection).count
    if count > 0:
        logger.info(f"'{ref_collection}' already seeded with {count} points.")
        return count

    data_dir = os.path.join(os.path.dirname(__file__), "data")
    encyclopedia_file = os.path.join(data_dir, "survival_encyclopedia_500.json")
    checkpoints_file = os.path.join(data_dir, "checkpoints.json")

    # 1. Load Survival Protocols
    protocols: List[Dict[str, Any]] = []
    if os.path.exists(encyclopedia_file):
        try:
            with open(encyclopedia_file, "r", encoding="utf-8") as f:
                protocols = json.load(f)
            logger.info(f"Loaded {len(protocols)} protocols from {encyclopedia_file}")
        except Exception as e:
            logger.error(f"Error loading {encyclopedia_file}: {e}")
    else:
        logger.warning(f"File not found: {encyclopedia_file}")

    # 2. Load Baseline Checkpoints
    checkpoints: List[Dict[str, Any]] = []
    if os.path.exists(checkpoints_file):
        try:
            with open(checkpoints_file, "r", encoding="utf-8") as f:
                checkpoints = json.load(f)
            logger.info(f"Loaded {len(checkpoints)} checkpoints from {checkpoints_file}")
        except Exception as e:
            logger.error(f"Error loading {checkpoints_file}: {e}")
    else:
        logger.warning(f"File not found: {checkpoints_file}")

    anchor_texts: List[str] = []
    payload_meta: List[Tuple[str, Dict[str, Any]]] = []

    # Prepare Survival Protocols
    for proto in protocols:
        symptoms_str = ", ".join(proto.get("trigger_symptoms", []))
        anchor_text = f"{proto.get('title', '')}. Category: {proto.get('category', '')}. Symptoms: {symptoms_str}. {proto.get('summary', '')}"
        anchor_texts.append(anchor_text)
        point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, proto["id"]))
        payload = {
            "record_type": "survival_protocol",
            "protocol_id": proto["id"],
            "title": proto["title"],
            "category": proto.get("category", "first_aid"),
            "trigger_symptoms": proto.get("trigger_symptoms", []),
            "required_materials": proto.get("required_materials", []),
            "steps": proto.get("steps", []),
            "warnings": proto.get("warnings", []),
            "cpr_cadence_required": proto.get("cpr_cadence_required", False),
            "priority": proto.get("priority", "urgent"),
            "summary": proto.get("summary", ""),
            "anchor_text": anchor_text
        }
        payload_meta.append((point_id, payload))

    # Prepare Baseline Checkpoints
    for cp in checkpoints:
        facilities_str = ", ".join(cp.get("facilities", []))
        anchor_text = f"{cp.get('name', '')}. Facilities: {facilities_str}. Operational capacity: {cp.get('base_capacity', 0)}."
        anchor_texts.append(anchor_text)
        point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, cp["id"]))
        payload = {
            "record_type": "checkpoint",
            "checkpoint_id": cp["id"],
            "name": cp["name"],
            "location": cp["location"],
            "base_capacity": cp.get("base_capacity", 100),
            "facilities": cp.get("facilities", []),
            "status": cp.get("operational_status", "operational"),
            "warning": cp.get("warning"),
            "last_verified": cp.get("last_verified", "00:00"),
            "anchor_text": anchor_text
        }
        payload_meta.append((point_id, payload))

    if not anchor_texts:
        logger.warning("No data found to seed into reference collection.")
        return 0

    # Batch embed all items efficiently
    logger.info(f"Computing embeddings for {len(anchor_texts)} total points...")
    vectors = embedder.embed_batch(anchor_texts)

    # Build Qdrant points
    points = []
    for i, (point_id, payload) in enumerate(payload_meta):
        points.append(models.PointStruct(id=point_id, vector=vectors[i], payload=payload))

    # Upsert in batches of 100
    batch_size = 100
    for i in range(0, len(points), batch_size):
        chunk = points[i:i + batch_size]
        client.upsert(collection_name=ref_collection, points=chunk)

    logger.info(f"Successfully seeded {len(points)} records into '{ref_collection}'.")
    return len(points)
