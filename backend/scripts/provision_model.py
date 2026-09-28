"""Download the embedding model once, then verify it loads without network."""

from pathlib import Path

from fastembed import TextEmbedding


cache = Path("data/model_cache").resolve()
cache.mkdir(parents=True, exist_ok=True)
model = TextEmbedding(model_name="sentence-transformers/all-MiniLM-L6-v2", cache_dir=str(cache))
vector = next(model.embed(["emergency water and shelter"]))
assert len(vector) == 384
offline = TextEmbedding(model_name="sentence-transformers/all-MiniLM-L6-v2",
                        cache_dir=str(cache), local_files_only=True)
assert len(next(offline.embed(["offline test"]))) == 384
print(f"Offline embedding model ready: {cache}")
