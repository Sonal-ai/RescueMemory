import os
import sys
import time
import shutil

# Ensure workspace root is in python path
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from backend.app.engine.qdrant_engine import QdrantEngine

def main():
    print("=================================================================")
    print("     RESCUEMEMORY: PHASE 1 QDRANT EDGE VERIFICATION TEST")
    print("=================================================================\n")

    test_storage = os.path.join(ROOT_DIR, "data", "test_node", "qdrant_storage")
    if os.path.exists(test_storage):
        shutil.rmtree(test_storage)
    os.makedirs(test_storage, exist_ok=True)

    # 1. Initialize Engine
    print("[TEST 1] Initializing in-process Qdrant Edge on disk...")
    t0 = time.time()
    engine = QdrantEngine(storage_path=test_storage)
    print(f"  --> Initialized in {round((time.time() - t0)*1000, 2)} ms. No Docker or external service required.")

    # 2. Seed Knowledge Base
    print("\n[TEST 2] Seeding Curated Disaster Knowledge Base into 'reference_immutable'...")
    seeded_count = engine.seed_reference_knowledge()
    print(f"  --> Successfully seeded {seeded_count} records (Survival Protocols + Baseline Checkpoints).")
    assert seeded_count > 0, "Seeding failed!"

    # 3. Test Natural Language Retrieval (Improvised Windlass Tourniquet)
    print("\n[TEST 3] Testing Natural Language Emergency Retrieval...")
    query = "My brother fell near gate, deep leg cut, blood pumping fast, only have a shirt and branch"
    materials = ["shirt", "stick"]
    print(f"  Survivor Input: '{query}'")
    print(f"  Available Materials: {materials}")
    
    res = engine.search_emergency_guidance(query_text=query, materials=materials, bleeding_type="spurting")
    top = res.get("top_match")
    print(f"  --> Top Retrieved Protocol: '{top['title']}' (Score: {top['score']})")
    print(f"  --> Required Materials: {top['materials_assessment']['required']}")
    print(f"  --> User Matched Materials: {top['materials_assessment']['matched']}")
    print(f"  --> Has All Needed Materials: {top['materials_assessment']['has_all_materials']}")
    print(f"  --> First Action Step: {top['steps'][0]}")
    print(f"  --> Critical Warning: {top['warnings'][0]}")
    print(f"  --> Latency Breakdown: Embed={res['telemetry']['embed_time_ms']}ms, Qdrant={res['telemetry']['qdrant_query_time_ms']}ms, Total={res['telemetry']['total_latency_ms']}ms")
    assert "windlass" in top["title"].lower() or "tourniquet" in top["title"].lower(), f"Expected tourniquet protocol, got {top['title']}"

    # 3b. Test CPR Priority Retrieval
    print("\n[TEST 3B] Testing Unresponsive Casualty (CPR Priority)...")
    cpr_res = engine.search_emergency_guidance(query_text="victim collapsed blue lips no pulse", breathing=False)
    cpr_top = cpr_res.get("top_match")
    print(f"  --> Top Retrieved Protocol: '{cpr_top['title']}' (Category: {cpr_top['category']})")
    assert cpr_top["category"] == "respiratory" or "cpr" in cpr_top["title"].lower(), "Expected CPR respiratory protocol!"

    # 3c. Test Water Purification Retrieval
    print("\n[TEST 3C] Testing Disaster Water Purification Retrieval...")
    water_res = engine.search_emergency_guidance(query_text="muddy river water need drinking water", materials=["plastic_bottle", "cloth"])
    water_top = water_res.get("top_match")
    print(f"  --> Top Retrieved Protocol: '{water_top['title']}' (Category: {water_top['category']})")
    assert water_top["category"] == "water_sanitation" or "water" in water_top["title"].lower(), "Expected Water Sanitation protocol!"

    # 4. Test Geo-Spatial Discovery (Checkpoints within walking distance)
    print("\n[TEST 4] Testing Filterable Geo-Spatial Shelter Discovery (1.5 km radius)...")
    survivor_lat, survivor_lon = 28.7495, 77.1182
    nearby = engine.search_nearby_checkpoints(lat=survivor_lat, lon=survivor_lon, radius_meters=1500.0)
    print(f"  Found {len(nearby)} checkpoint(s) within 1.5 km:")
    for cp in nearby:
        print(f"    - [{cp['checkpoint_id']}] {cp['name']} (~{cp['distance_meters']}m away) | Status: {cp['status']}")
    assert len(nearby) > 0, "No nearby checkpoints found!"
    assert nearby[0]["checkpoint_id"] == "cp_17", "Expected CP-17 to be closest!"

    # 5. Test Dynamic Observation Mutation & Contradiction Detection
    print("\n[TEST 5] Testing Real-Time Local Hazard Mutation & Conflict Detection...")
    hazard_report = {
        "title": "Flooded Entrance Hazard",
        "text": "The entrance is flooded. There are exposed wires near the gate.",
        "category": "hazard",
        "severity": "immediate_red",
        "location": {"lat": survivor_lat, "lon": survivor_lon},
        "checkpoint_id": "cp_17",
        "observed_at": "09:25",
        "origin_device": "survivor_node_A"
    }
    rec_res = engine.record_local_incident(hazard_report)
    print(f"  --> Recorded Hazard Incident: {rec_res['incident_id']} (Status: {rec_res['status']})")

    # Re-query checkpoints to inspect contradiction
    updated_nearby = engine.search_nearby_checkpoints(lat=survivor_lat, lon=survivor_lon, radius_meters=1500.0)
    cp17_updated = next(c for c in updated_nearby if c["checkpoint_id"] == "cp_17")
    print(f"  --> Updated CP-17 Status: {cp17_updated['status']}")
    print(f"  --> Live Warning: {cp17_updated['warning']}")
    print(f"  --> Contradiction Detected: {cp17_updated['contradiction_detected']}")
    assert cp17_updated["contradiction_detected"] is True, "Contradiction was not detected!"
    assert cp17_updated["status"] == "danger_warning", "Status was not updated to danger_warning!"

    # 6. Test Negative Vector Recommendation for Alternative Safe Shelter
    print("\n[TEST 6] Testing Qdrant Recommendation API (Negative Vector Avoidance)...")
    alt = engine.recommend_alternative_shelter(compromised_checkpoint_id="cp_17", avoid_hazard_text="flooded entrance live wires")
    print(f"  --> Recommended Alternative Safe Shelter: {alt.get('name')}")
    print(f"  --> Rationale: {alt.get('rationale')}")
    assert alt.get("recommended_checkpoint_id") in ["shelter_alpha", "clinic_beta"], "Expected alternative checkpoint recommendation!"

    # 7. Latency & p95 Benchmark
    print("\n[TEST 7] Running Warm Query Benchmark (20 iterations)...")
    latencies = []
    test_queries = [
        "cannot walk after fall, leg hurts",
        "how to purify flood water",
        "unresponsive person not breathing",
        "snake bite swelling",
        "drinking water shelter near me"
    ]
    for i in range(20):
        q = test_queries[i % len(test_queries)]
        st = time.time()
        # Warm search
        q_vec = engine.embedder.embed_text(q)
        qdrant_st = time.time()
        engine.client.query_points(
            collection_name=engine.REF_COLLECTION,
            query=q_vec,
            limit=3
        )
        latencies.append((time.time() - qdrant_st) * 1000)

    latencies.sort()
    p50 = round(latencies[len(latencies) // 2], 2)
    p95 = round(latencies[int(len(latencies) * 0.95)], 2)
    print(f"  --> Warm Qdrant Edge Query p50: {p50} ms")
    print(f"  --> Warm Qdrant Edge Query p95: {p95} ms")
    assert p95 < 50.0, f"Query latency too high: {p95} ms!"

    print("\n=================================================================")
    print("       ALL 7 PHASE 1 TESTS PASSED SUCCESSFULLY! ")
    print("=================================================================")

if __name__ == "__main__":
    main()
