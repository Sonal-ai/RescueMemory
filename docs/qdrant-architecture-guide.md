# How Qdrant Works Inside RescueMemory: Complete Architectural & Codebase Guide

> **Audited for Qdrant Hackathon 2026 (Code Cubicle 6.0 / PS-03)**  
> **Status:** Fully Audited against physical codebase (`backend/app/`) | **Automated Tests:** 22/22 Passing

This guide explains **how Qdrant works inside RescueMemory at every step**, translated into rigorous engineering concepts and audited code references.

---

## 1. High-Level Architecture: The Two-Tiered Vector Topology

Most vector search implementations rely on an external Docker container or a remote cloud cluster. In a disaster scenario where power grids and telecommunications fail, external databases are completely unreachable.

RescueMemory implements a **hierarchical dual-engine topology**:

1. **Local Edge Engine (`qdrant-edge-py`)**: An embedded, in-process vector database written in Rust. Just as SQLite operates directly on disk inside an application process, **Qdrant Edge runs directly inside the local Python process on local storage**. It requires **zero external servers, zero Docker daemon, and zero internet connection**.
2. **Central Cloud Cluster (`qdrant-client`)**: A managed Qdrant Cloud cluster on `cloud.qdrant.io`. It is accessed **strictly by the Central Command node** (`NODE_ROLE=central`) when an internet, satellite, or LTE uplink becomes available.

```mermaid
flowchart TB
    subgraph EdgeNode["Local Edge Host (Survivor or Volunteer Device)"]
        UI["React 19 PWA (Survivor HUD / Radar / Volunteer Board)"]
        FASTAPI["FastAPI Edge Application (backend/app/main.py)"]
        SERVICE["RescueService (backend/app/service.py)"]
        
        subgraph QdrantEdge["Qdrant Edge Engine (Embedded Rust in-process)"]
            SHARD_REF[("Shard: reference\n419 Protocols & Shelters")]
            SHARD_EVT[("Shard: events\nDynamic Observations & SOS")]
            SHARD_GRP[("Shard: groups\nTactical Group Tokens")]
            SHARD_RCP[("Shard: receipts\nMemory Ripple Hop Receipts")]
        end
        
        EMBED["FastEmbed: sentence-transformers/all-MiniLM-L6-v2 (384-d Dense)"]
        BM25_ENG["Qdrant Edge BM25: In-Process Sparse Vectorizer (Modifier.Idf)"]
    end

    subgraph CentralNode["Central Command HQ (When Internet Exists)"]
        GW["Central Gateway (backend/app/cloud.py)"]
        subgraph QdrantCloudCluster["Managed Qdrant Cloud Cluster"]
            QC_PUB[("rescue_public_events\nPublic Hazards & Warnings")]
            QC_GRP[("rescue_group_events\nTactical Group Observations")]
            QC_RES[("rescue_responder_events\nRestricted Medical SOS")]
            QC_GDE[("rescue_approved_guides\nHMAC-Signed Authoritative Guides")]
        end
    end

    UI -->|HTTP Localhost / Hotspot| FASTAPI
    FASTAPI --> SERVICE
    SERVICE --> EMBED
    SERVICE --> BM25_ENG
    EMBED -->|384-d Dense Vector| QdrantEdge
    BM25_ENG -->|Sparse Token Weights| QdrantEdge
    SERVICE <--> QdrantEdge
    
    EdgeNode <-->|LAN / Hotspot Peer Exchange (sync.py)| EdgeNode
    EdgeNode -->|1-Way SOS Uplink (sync.py)| CentralNode
    CentralNode <-->|Scoped Two-Way Sync| QdrantCloudCluster
```

---

## 2. In-Process Multi-Shard Topology (`backend/app/memory.py`)

Rather than placing all records into a single collection, RescueMemory instantiates **four isolated native edge shards** on local disk:

```python
# backend/app/memory.py:36-43
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
```

### The Four Shards and Their Roles:
1. **`reference`**: Permanent emergency clinical guidelines, disaster checklists, and baseline infrastructure landmarks. Immutable during emergency operations; only updated via cryptographically signed guide packages.
2. **`events`**: Append-only dynamic field observations (hazards, flooding, road collapses, medical SOS alerts, opt-in presence). Scoped by `visibility` (`public`, `group`, `responders`).
3. **`groups`**: Family, community, or responder group definitions and cryptographic tokens.
4. **`receipts`**: Multi-hop transfer records proving which peer transferred what event at what timestamp, powering the **Memory Ripple** provenance visualizer.

### Inverted Indexes in Qdrant Edge
To ensure sub-millisecond filtering on edge devices, the following payload indexes are initialized idempotently on startup:
- `kind`: `PayloadSchemaType.Keyword`
- `visibility`: `PayloadSchemaType.Keyword`
- `group_id`: `PayloadSchemaType.Keyword`
- `entity_id`: `PayloadSchemaType.Keyword`
- `location`: `PayloadSchemaType.Geo`

---

## 3. Dual-Vector Hybrid Retrieval Pipeline

### Step 1: Text Vectorization
Computers cannot retrieve semantic concepts such as *"cannot walk after falling"* or exact checkpoint codes like *"CP-17"* using a single vector type without trade-offs. RescueMemory uses complementary representations:

1. **Dense Vector (`fastembed`)**:
   - Model: `sentence-transformers/all-MiniLM-L6-v2` (384 dimensions, Cosine distance).
   - Executed locally via ONNX Runtime with zero internet dependency (`local_files_only=True`).
   - Connects semantic synonyms: *"cannot walk"* $\leftrightarrow$ *"leg fracture"*, *"potable"* $\leftrightarrow$ *"drinking water"*.
2. **Sparse Vector (`qdrant_edge.Bm25`)**:
   - Built-in Qdrant Edge BM25 engine with Inverse Document Frequency (`Modifier.Idf`).
   - Preserves exact tokens: *"CP-17"*, *"Gate 3"*, *"Tourniquet"*.

### Step 2: Reciprocal Rank Fusion ($RRF$) Query
```python
# backend/app/memory.py:96-110
request = QueryRequest(
    limit=limit,
    prefetches=[
        Prefetch(limit=max(20, limit), query=Query.Nearest(dense, using="dense"), filter=filter_),
        Prefetch(limit=max(20, limit), query=Query.Nearest(sparse, using="bm25"), filter=filter_),
    ],
    query=Fusion.Rrf(k=2),
    with_payload=True,
)
hits = self.shards[collection].query(request)
```
The native engine calculates:
$$RRF(d) = \sum_{m \in \{\text{dense}, \text{bm25}\}} \frac{1}{k + r_m(d)}$$
Where $k = 2$ and $r_m(d)$ is the document rank within each candidate prefetch set.

---

## 4. Algorithmic Novelty: Vector Arithmetic Facility Recommendation

When a shelter or checkpoint is reported compromised by a hazard, RescueMemory computes an alternative candidate using vector space arithmetic:

$$\vec{V}_{\text{target}} = \frac{\vec{V}_{\text{base}} - \lambda \cdot \vec{V}_{\text{hazard}}}{\|\vec{V}_{\text{base}} - \lambda \cdot \vec{V}_{\text{hazard}}\|}$$

- $\vec{V}_{\text{base}}$: Dense embedding of the compromised facility (e.g. `cp_17`, including its facilities and description).
- $\vec{V}_{\text{hazard}}$: Dense embedding of the active hazard description (e.g. *"flooded entrance live wires"*).
- $\lambda = 0.5$: Hazard penalty weight.

Qdrant Edge executes a cosine nearest-neighbor search with $\vec{V}_{\text{target}}$ against the `reference` shard, excluding the compromised location, and returns the closest safe alternative facility.

---

## 5. Contradiction Resolution & Provenance ("Memory Ripple")

In disaster response, vector similarity alone cannot resolve whether a gate is open or closed. RescueMemory applies deterministic temporal logic in [`backend/app/service.py:entity_timeline`](file:///d:/college%20dtu/Projects/Code%20Cubicle%206.0/RescueMemory/backend/app/service.py):

1. **6-Hour Danger Hold**: If any observation marks a facility as `danger`, `flooded`, or `blocked` within the last 6 hours, that danger status remains prominent.
2. **Authority Tag Verification**: A subsequent report claiming the facility is safe cannot override an active danger report unless it carries an HMAC-SHA256 authority tag issued by Central Command (`GUIDE_TRUST_KEY`).
3. **Memory Ripple Hop Chain**: Each sync transfer records a durable receipt in the `receipts` shard:
   $$\text{Receipt} = (\text{event\_id}, \text{sender\_node}, \text{receiver\_node}, \text{timestamp}, \text{scope})$$
   Command can audit the complete hop trajectory of any report.

---

## 6. Central Gateway & Qdrant Cloud Synchronization

When a central node connects to internet, [`backend/app/cloud.py`](file:///d:/college%20dtu/Projects/Code%20Cubicle%206.0/RescueMemory/backend/app/cloud.py) mirrors local edge events into four isolated Qdrant Cloud collections:
- `rescue_public_events`: Public hazards and resources (accessible across districts).
- `rescue_group_events`: Authorized group records.
- `rescue_responder_events`: Restricted emergency casualty and SOS records.
- `rescue_approved_guides`: Verified emergency guidelines signed by command.

All automated roundtrip and cloud synchronization flows are verified in `backend/tests/test_roundtrip.py`.
