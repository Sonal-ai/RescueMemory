from __future__ import annotations

import hashlib
import threading
from pathlib import Path

from fastembed import TextEmbedding
from qdrant_edge import (
    Bm25, Distance, EdgeConfig, EdgeShard, EdgeSparseVectorParams,
    EdgeVectorParams, FieldCondition, Filter, Fusion, GeoPoint, GeoRadius,
    MatchValue, Modifier, PayloadSchemaType, Point, Prefetch, Query,
    QueryRequest, ScrollRequest, UpdateOperation,
)


def point_id(value: str) -> int:
    # Edge accepts uint64 IDs; stable across nodes and process restarts.
    return int.from_bytes(hashlib.sha256(value.encode()).digest()[:8], "big") & ((1 << 63) - 1)


class Memory:
    def __init__(self, root: Path, model_cache: Path):
        root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.embedder = TextEmbedding(
            model_name="sentence-transformers/all-MiniLM-L6-v2",
            cache_dir=str(model_cache),
            local_files_only=True,
        )
        self.bm25 = Bm25()
        config = EdgeConfig(
            vectors={"dense": EdgeVectorParams(size=384, distance=Distance.Cosine)},
            sparse_vectors={"bm25": EdgeSparseVectorParams(modifier=Modifier.Idf)},
            on_disk_payload=True,
        )
        self.shards = {}
        for name in ("reference", "events", "groups", "receipts"):
            path = root / name
            if path.exists() and any(path.iterdir()):
                self.shards[name] = EdgeShard.load(str(path))
            else:
                path.mkdir(parents=True, exist_ok=True)
                self.shards[name] = EdgeShard.create(str(path), config)
        for field, schema in (
            ("kind", PayloadSchemaType.Keyword),
            ("visibility", PayloadSchemaType.Keyword),
            ("group_id", PayloadSchemaType.Keyword),
            ("entity_id", PayloadSchemaType.Keyword),
            ("location", PayloadSchemaType.Geo),
        ):
            # Existing indexes are harmless; creation is idempotent in Edge.
            for name in ("events", "reference"):
                try:
                    self.shards[name].update(UpdateOperation.create_field_index(field, schema))
                except Exception as exc:
                    if "already exists" not in str(exc).lower():
                        raise

    def close(self):
        for shard in self.shards.values():
            shard.close()

    def vectors(self, text: str):
        dense = next(self.embedder.embed([text])).tolist()
        return {"dense": dense, "bm25": self.bm25.embed_document(text)}

    def upsert(self, collection: str, key: str, payload: dict, text: str):
        with self.lock:
            self.shards[collection].update(UpdateOperation.upsert_points([
                Point(point_id(key), self.vectors(text), payload)
            ]))

    def get(self, collection: str, key: str) -> dict | None:
        with self.lock:
            results = self.shards[collection].retrieve([point_id(key)], with_payload=True, with_vector=False)
            return results[0].payload if results else None

    def delete(self, collection: str, keys: list[str]):
        if keys:
            with self.lock:
                self.shards[collection].update(UpdateOperation.delete_points([point_id(key) for key in keys]))

    def all(self, collection: str, filter_: Filter | None = None):
        offset = None
        while True:
            with self.lock:
                records, next_offset = self.shards[collection].scroll(ScrollRequest(
                    offset=offset, limit=128, filter=filter_, with_payload=True, with_vector=False
                ))
            for item in records:
                yield item.payload
            if next_offset is None:
                break
            offset = next_offset

    def search(self, collection: str, text: str, limit: int = 5, filter_: Filter | None = None):
        dense = next(self.embedder.embed([text])).tolist()
        sparse = self.bm25.embed_query(text)
        request = QueryRequest(
            limit=limit,
            prefetches=[
                Prefetch(limit=max(20, limit), query=Query.Nearest(dense, using="dense"), filter=filter_),
                Prefetch(limit=max(20, limit), query=Query.Nearest(sparse, using="bm25"), filter=filter_),
            ],
            query=Fusion.Rrf(k=2),
            with_payload=True,
        )
        with self.lock:
            return [{"score": hit.score, **hit.payload} for hit in self.shards[collection].query(request)]

    def nearby(self, location: dict, radius_m: float, limit: int = 200):
        geo = Filter(must=[FieldCondition(
            key="location", geo_radius=GeoRadius(
                center=GeoPoint(lon=location["lon"], lat=location["lat"]),
                radius=radius_m,
            ),
        )])
        return list(self.all("events", geo))[:limit]

    def seed(self, cards: list[dict]):
        for card in cards:
            if self.get("reference", card["id"]) != card:
                self.upsert("reference", card["id"], card, f"{card['title']} {card['keywords']} {card['summary']}")
