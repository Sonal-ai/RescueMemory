import time
import logging
from typing import List, Dict, Any, Optional
from qdrant_client import QdrantClient
from qdrant_client.http import models

from backend.app.engine.embeddings import EdgeEmbedder

logger = logging.getLogger(__name__)


def search_emergency_guidance(
    client: QdrantClient,
    embedder: EdgeEmbedder,
    ref_collection: str,
    query_text: str,
    materials: Optional[List[str]] = None,
    breathing: bool = True,
    bleeding_type: str = "none",
    limit: int = 3
) -> Dict[str, Any]:
    """
    Retrieves life-saving survival procedures matching the survivor's natural language input,
    tailored to available materials and verified triage vitals.
    """
    start_time = time.time()
    materials = materials or []

    # Emergency override: if casualty is NOT breathing, prioritize CPR immediately
    if not breathing:
        query_text = f"unresponsive casualty not breathing cardiac arrest hands-only cpr. {query_text}"

    query_vector = embedder.embed_text(query_text)
    embed_time_ms = round((time.time() - start_time) * 1000, 2)

    search_start = time.time()
    # Clinical category filter inside the query based on triage vitals
    filter_must = [models.FieldCondition(key="record_type", match=models.MatchValue(value="survival_protocol"))]
    if not breathing:
        filter_must.append(models.FieldCondition(key="category", match=models.MatchValue(value="respiratory")))
    elif bleeding_type in ["spurting", "arterial"]:
        filter_must.append(models.FieldCondition(key="category", match=models.MatchValue(value="hemorrhage")))

    query_response = client.query_points(
        collection_name=ref_collection,
        query=query_vector,
        query_filter=models.Filter(must=filter_must),
        limit=15,
        with_payload=True
    )
    search_results = query_response.points
    search_time_ms = round((time.time() - search_start) * 1000, 2)
    total_time_ms = round((time.time() - start_time) * 1000, 2)

    matched_protocols = []
    for hit in search_results:
        p = hit.payload
        req_mats = set(p.get("required_materials", []))
        user_mats = set(materials)
        has_all_materials = req_mats.issubset(user_mats) if req_mats else True
        matched_mats = list(req_mats.intersection(user_mats))
        missing_mats = list(req_mats.difference(user_mats))

        # Resource-Adaptive Scoring:
        # Base vector semantic similarity + material readiness boost + clinical urgency boost
        base_score = float(hit.score)
        material_boost = 0.0
        if req_mats:
            material_boost = (len(matched_mats) / len(req_mats)) * 0.15

        clinical_boost = 0.0
        if bleeding_type in ["spurting", "arterial"] and p.get("category") == "hemorrhage":
            clinical_boost = 0.20
            if "tourniquet" in p.get("title", "").lower() or "arterial" in p.get("title", "").lower():
                clinical_boost += 0.25
            if any(m in user_mats for m in ["stick", "branch", "rod"]):
                clinical_boost += 0.10
        elif not breathing and (p.get("category") == "respiratory" or "cpr" in p.get("title", "").lower()):
            clinical_boost = 0.30

        final_score = round(base_score + material_boost + clinical_boost, 4)

        matched_protocols.append({
            "score": final_score,
            "base_vector_score": round(base_score, 4),
            "protocol_id": p.get("protocol_id"),
            "title": p.get("title"),
            "category": p.get("category"),
            "steps": p.get("steps", []),
            "warnings": p.get("warnings", []),
            "cpr_cadence_required": p.get("cpr_cadence_required", False),
            "priority": p.get("priority", "urgent"),
            "summary": p.get("summary"),
            "materials_assessment": {
                "required": list(req_mats),
                "matched": matched_mats,
                "missing": missing_mats,
                "has_all_materials": has_all_materials
            }
        })

    # Rank candidates by final resource-adaptive score
    matched_protocols.sort(key=lambda x: x["score"], reverse=True)
    top_candidates = matched_protocols[:limit]

    return {
        "query": query_text,
        "results_count": len(matched_protocols),
        "top_match": matched_protocols[0] if matched_protocols else None,
        "candidates": top_candidates,
        "telemetry": {
            "embed_time_ms": embed_time_ms,
            "qdrant_query_time_ms": search_time_ms,
            "total_latency_ms": total_time_ms
        }
    }
