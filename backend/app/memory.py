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
        model_cache.mkdir(parents=True, exist_ok=True)
        try:
            self.embedder = TextEmbedding(
                model_name="sentence-transformers/all-MiniLM-L6-v2",
                cache_dir=str(model_cache),
                local_files_only=True,
            )
        except Exception:
            # Fallback for cloud deployment (e.g. Render) to download model into cache
            self.embedder = TextEmbedding(
                model_name="sentence-transformers/all-MiniLM-L6-v2",
                cache_dir=str(model_cache),
                local_files_only=False,
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

    def clear(self, collection: str) -> int:
        deleted = 0
        with self.lock:
            offset = None
            while True:
                records, next_offset = self.shards[collection].scroll(ScrollRequest(
                    offset=offset, limit=128, with_payload=False, with_vector=False
                ))
                if records:
                    ids = [r.id for r in records]
                    self.shards[collection].update(UpdateOperation.delete_points(ids))
                    deleted += len(ids)
                if next_offset is None or not records:
                    break
                offset = next_offset
        return deleted

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

    def seed(self, cards: list[dict], stop_event: threading.Event | None = None):
        to_seed = [card for card in cards if self.get("reference", card["id"]) != card]
        if not to_seed:
            return
        batch_size = 16
        for i in range(0, len(to_seed), batch_size):
            if stop_event and stop_event.is_set():
                break
            chunk = to_seed[i:i + batch_size]
            texts = [f"{c['title']} {c.get('keywords', '')} {c.get('summary', '')}" for c in chunk]
            dense_vectors = [v.tolist() for v in self.embedder.embed(texts, batch_size=batch_size)]
            sparse_vectors = [self.bm25.embed_document(t) for t in texts]
            points = [
                Point(point_id(c["id"]), {"dense": d, "bm25": s}, c)
                for c, d, s in zip(chunk, dense_vectors, sparse_vectors)
            ]
            if stop_event and stop_event.is_set():
                break
            with self.lock:
                if not any(s.is_closed for s in self.shards.values() if hasattr(s, 'is_closed')):
                    try:
                        self.shards["reference"].update(UpdateOperation.upsert_points(points))
                    except Exception:
                        if stop_event and stop_event.is_set():
                            break
                        raise

    def recommend_alternative(
        self,
        compromised_id: str,
        avoid_hazard_text: str = "flooded entrance live wires",
        limit: int = 1
    ) -> dict | None:
        """
        Calculates an alternative safe checkpoint or facility using vector arithmetic:
        V_rec = normalize(V_compromised - 0.5 * V_hazard)
        Excludes the compromised location and retrieves the closest matching safe facility.
        """
        base_item = self.get("reference", compromised_id) or self.get("events", compromised_id)
        if not base_item:
            for item in self.all("reference"):
                if item.get("id") == compromised_id or item.get("entity_id") == compromised_id:
                    base_item = item
                    break
        if not base_item:
            for item in self.all("events"):
                if item.get("id") == compromised_id or item.get("entity_id") == compromised_id:
                    base_item = item
                    break

        base_text = (
            f"{base_item.get('title', '')} {base_item.get('summary', '')} {' '.join(base_item.get('facilities', []))}"
            if base_item
            else f"{compromised_id} emergency shelter medical facility clean water"
        )
        base_vec = next(self.embedder.embed([base_text])).tolist()
        hazard_vec = next(self.embedder.embed([avoid_hazard_text])).tolist()

        target_vec = [b - 0.5 * h for b, h in zip(base_vec, hazard_vec)]
        norm = (sum(x * x for x in target_vec)) ** 0.5 or 1.0
        target_vec = [x / norm for x in target_vec]

        request = QueryRequest(
            limit=10,
            query=Query.Nearest(target_vec, using="dense"),
            with_payload=True
        )
        with self.lock:
            hits = self.shards["reference"].query(request)

        candidates = []
        for hit in hits:
            p = hit.payload
            cid = p.get("id") or p.get("entity_id")
            if cid == compromised_id or p.get("entity_id") == compromised_id:
                continue
            if p.get("kind") == "protocol":
                continue
            is_checkpoint = (
                p.get("kind") == "checkpoint"
                or "shelter" in cid.lower()
                or "clinic" in cid.lower()
                or "cp_" in cid.lower()
                or "water_" in cid.lower()
            )
            if is_checkpoint:
                candidates.append({
                    "recommended_id": cid,
                    "name": p.get("title") or p.get("name"),
                    "location": p.get("location"),
                    "facilities": p.get("facilities", []),
                    "base_capacity": p.get("base_capacity"),
                    "score": round(hit.score, 4),
                    "rationale": f"Alternative safe facility matching resources of {compromised_id} while avoiding hazards related to '{avoid_hazard_text}'."
                })

        return candidates[0] if candidates else None


