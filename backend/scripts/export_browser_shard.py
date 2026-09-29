"""
Export edge knowledge and pre-computed FastEmbed vector embeddings
into lightweight JSON shards for 100% offline browser PWA execution.
"""
import json
import os
import sys
from pathlib import Path

# Add project root to sys.path
root_dir = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(root_dir))

from fastembed import TextEmbedding

def main():
    knowledge_path = root_dir / "backend" / "data" / "knowledge.json"
    output_dir = root_dir / "frontend" / "public" / "data"
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Reading knowledge from {knowledge_path}...")
    with open(knowledge_path, "r", encoding="utf-8") as f:
        cards = json.load(f)

    print(f"Found {len(cards)} knowledge records.")

    # Model cache
    cache_dir = root_dir / "data" / "model_cache"
    print(f"Initializing FastEmbed from {cache_dir}...")
    embedder = TextEmbedding(
        model_name="BAAI/bge-small-en-v1.5",
        cache_dir=str(cache_dir),
    )

    # Texts to embed for each card
    texts = [f"{c['title']} {c.get('keywords', '')} {c.get('summary', '')}" for c in cards]
    print(f"Generating 384-d dense vectors for {len(texts)} cards...")
    vectors = [v.tolist() for v in embedder.embed(texts)]

    # Map card ID -> vector (rounded to 5 decimal places for compact JSON)
    vector_map = {}
    for card, vec in zip(cards, vectors):
        cid = card["id"]
        vector_map[cid] = [round(x, 5) for x in vec]

    # Pre-embed standard hazard profiles for instant client-side vector subtraction
    hazard_profiles = {
        "__hazard_flood__": "flooded entrance submerged access live wires water hazard",
        "__hazard_fire__": "active fire dense smoke toxic fumes explosion risk",
        "__hazard_collapse__": "structural collapse blocked debris falling masonry",
        "__hazard_contamination__": "chemical spill toxic biological contamination hazard",
    }
    hazard_texts = list(hazard_profiles.values())
    hazard_keys = list(hazard_profiles.keys())
    hazard_vectors = [v.tolist() for v in embedder.embed(hazard_texts)]
    for hkey, hvec in zip(hazard_keys, hazard_vectors):
        vector_map[hkey] = [round(x, 5) for x in hvec]

    # Write vectors
    vector_output = output_dir / "knowledge_vectors.json"
    print(f"Writing vector shard to {vector_output}...")
    with open(vector_output, "w", encoding="utf-8") as f:
        json.dump(vector_map, f)

    # Write compact cards
    compact_cards = []
    for c in cards:
        compact_cards.append({
            "id": c.get("id"),
            "entity_id": c.get("entity_id", c.get("id")),
            "title": c.get("title", ""),
            "kind": c.get("kind", "protocol"),
            "summary": c.get("summary", ""),
            "instructions": c.get("instructions", []),
            "warnings": c.get("warnings", []),
            "applicability": c.get("applicability", ""),
            "source": c.get("source", ""),
            "facilities": c.get("facilities", []),
            "location": c.get("location"),
            "operational_status": c.get("operational_status", "operational"),
        })

    cards_output = output_dir / "knowledge_cards.json"
    print(f"Writing cards shard to {cards_output}...")
    with open(cards_output, "w", encoding="utf-8") as f:
        json.dump(compact_cards, f, ensure_ascii=False)

    vec_size_kb = os.path.getsize(vector_output) / 1024
    card_size_kb = os.path.getsize(cards_output) / 1024
    print(f"Done! Vector shard: {vec_size_kb:.1f} KB | Cards shard: {card_size_kb:.1f} KB")

if __name__ == "__main__":
    main()
