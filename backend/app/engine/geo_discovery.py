import logging
from typing import List, Dict, Any, Optional
from qdrant_client import QdrantClient
from qdrant_client.http import models

from backend.app.engine.embeddings import EdgeEmbedder

logger = logging.getLogger(__name__)


def search_nearby_checkpoints(
    client: QdrantClient,
    ref_collection: str,
    mutable_collection: str,
    lat: float,
    lon: float,
    radius_meters: float = 3000.0,
    required_facility: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Discovers nearby verified shelters using Qdrant's filterable geo_radius HNSW graph,
    and automatically cross-references local_mutable for real-time hazard status overlays.
    """
    filter_conditions = [
        models.FieldCondition(key="record_type", match=models.MatchValue(value="checkpoint")),
        models.FieldCondition(
            key="location",
            geo_radius=models.GeoRadius(
                center=models.GeoPoint(lat=lat, lon=lon),
                radius=radius_meters
            )
        )
    ]

    if required_facility:
        filter_conditions.append(
            models.FieldCondition(key="facilities", match=models.MatchValue(value=required_facility))
        )

    # 1. Fetch baseline checkpoints
    results = client.scroll(
        collection_name=ref_collection,
        scroll_filter=models.Filter(must=filter_conditions),
        limit=20,
        with_payload=True
    )[0]

    checkpoints = []
    for point in results:
        p = point.payload
        cp_id = p.get("checkpoint_id")

        # Approximate distance calculation in meters
        d_lat = (p["location"]["lat"] - lat) * 111000
        d_lon = (p["location"]["lon"] - lon) * 111000 * 0.88
        distance_m = round((d_lat**2 + d_lon**2)**0.5, 0)

        # Check if there is an active local danger observation in local_mutable
        local_alerts = client.scroll(
            collection_name=mutable_collection,
            scroll_filter=models.Filter(
                must=[
                    models.FieldCondition(key="checkpoint_id", match=models.MatchValue(value=cp_id)),
                    models.FieldCondition(key="category", match=models.MatchValue(value="hazard"))
                ]
            ),
            limit=1,
            with_payload=True
        )[0]

        live_status = p.get("status", "operational")
        live_warning = p.get("warning")
        contradiction_detected = False

        if local_alerts:
            alert_payload = local_alerts[0].payload
            live_status = "danger_warning"
            live_warning = f"LOCAL ALERT ({alert_payload.get('observed_at')}): {alert_payload.get('text')}"
            contradiction_detected = True

        checkpoints.append({
            "checkpoint_id": cp_id,
            "name": p.get("name"),
            "location": p.get("location"),
            "distance_meters": distance_m,
            "status": live_status,
            "warning": live_warning,
            "contradiction_detected": contradiction_detected,
            "facilities": p.get("facilities", []),
            "base_capacity": p.get("base_capacity"),
            "last_verified": p.get("last_verified")
        })

    # Sort by distance ascending
    checkpoints.sort(key=lambda x: x["distance_meters"])
    return checkpoints


def recommend_alternative_shelter(
    client: QdrantClient,
    embedder: EdgeEmbedder,
    ref_collection: str,
    compromised_checkpoint_id: str,
    avoid_hazard_text: str = "flooded entrance live wires"
) -> Dict[str, Any]:
    """
    Uses Qdrant's native recommendation API (positive checkpoint + negative hazard vector)
    to find an optimal alternative safe shelter.
    """
    # Find the point id for the compromised checkpoint
    cp_point = client.scroll(
        collection_name=ref_collection,
        scroll_filter=models.Filter(
            must=[models.FieldCondition(key="checkpoint_id", match=models.MatchValue(value=compromised_checkpoint_id))]
        ),
        limit=1
    )[0]

    if not cp_point:
        return {"error": f"Checkpoint {compromised_checkpoint_id} not found"}

    positive_id = cp_point[0].id
    negative_vector = embedder.embed_text(avoid_hazard_text)

    # Query recommendation via modern query_points API
    rec_response = client.query_points(
        collection_name=ref_collection,
        query=models.RecommendQuery(
            recommend=models.RecommendInput(
                positive=[positive_id],
                negative=[negative_vector]
            )
        ),
        query_filter=models.Filter(
            must=[models.FieldCondition(key="record_type", match=models.MatchValue(value="checkpoint"))],
            must_not=[models.FieldCondition(key="checkpoint_id", match=models.MatchValue(value=compromised_checkpoint_id))]
        ),
        limit=1,
        with_payload=True
    )
    rec_results = rec_response.points

    if rec_results:
        best = rec_results[0].payload
        return {
            "recommended_checkpoint_id": best.get("checkpoint_id"),
            "name": best.get("name"),
            "facilities": best.get("facilities"),
            "score": round(rec_results[0].score, 4),
            "rationale": f"Matches facilities of {compromised_checkpoint_id} while avoiding hazards related to '{avoid_hazard_text}'."
        }
    return {"error": "No alternative shelter found"}
