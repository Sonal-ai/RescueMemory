# RescueMemory: AI-Powered Edge Memory & Disaster Information Relay

> **Code Cubicle 6.0 / Qdrant Hackathon 2026 — Problem Statement 03**  
> **Team Rubix:** Sonal Verma, Palak Jain, Shivendra Prasad (Delhi Technological University)  
> **Automated Test Suite Status:** `22 passed, 0 failed (100% Green)` on live hardware

RescueMemory is an **offline-first disaster intelligence platform** powered by in-process **Qdrant Edge (`qdrant-edge-py`)**, local multi-modal embeddings, and scoped peer-to-peer synchronization. When power grids and telecommunications collapse, RescueMemory allows survivors to retrieve source-linked guidance, enables field volunteers to carry localized observations over Wi-Fi hotspots, and provides command teams with an authoritative, contradiction-aware common operational picture backed by **Qdrant Cloud**.

---

## 1. System Architecture Diagram

```mermaid
flowchart TD
    classDef ready fill:#10b981,stroke:#047857,stroke-width:2px,color:#ffffff;
    classDef demo fill:#f59e0b,stroke:#d97706,stroke-width:2px,color:#ffffff;
    classDef algo fill:#3b82f6,stroke:#1d4ed8,stroke-width:2px,color:#ffffff;
    classDef roadmap fill:#6b7280,stroke:#4b5563,stroke-width:2px,stroke-dasharray: 4 4,color:#ffffff;
    classDef storage fill:#8b5cf6,stroke:#6d28d9,stroke-width:2px,color:#ffffff;
    classDef cloud fill:#0ea5e9,stroke:#0284c7,stroke-width:2px,color:#ffffff;

    subgraph INGESTION ["1. MULTI-MODAL INGESTION & CLINICAL TRIAGE LAYER"]
        INPUT["Disaster Event Input<br/>• Natural Lang Prompt<br/>• Geo Location (Lat/Lon)<br/>• Vitals: Breathing, Bleeding<br/>• Available Field Materials"]:::ready
        INTENT["Deterministic Intent Classifier<br/>• detect_intent() & tokenize()<br/>• Intent: mobility_sos, life_sos,<br/>shelter_search, hazard_report"]:::ready
        TRIAGE["Clinical Triage & Material Engine<br/>• Breathing Failure Override (CPR)<br/>• Arterial Bleed Tourniquet Boost<br/>• Material Matching (+0.15 Score)"]:::ready
    end

    subgraph EMBEDDING ["2. HYBRID VECTORIZATION & RETRIEVAL PIPELINE"]
        DENSE_ENC["FastEmbed MiniLM-L6-v2<br/>• 384-Dimensional Dense Vector<br/>• Cosine Distance Metric<br/>• Local ONNX Runtime"]:::ready
        SPARSE_ENC["Qdrant Edge BM25 Engine<br/>• In-Process Sparse Vectorizer<br/>• Modifier: IDF-Weighted<br/>• Exact Keyword & Entity Matching"]:::ready
        RRF["Reciprocal Rank Fusion (RRF)<br/>• Fusion.Rrf(k=2)<br/>• Prefetch(limit=20, dense)<br/>• Prefetch(limit=20, sparse)"]:::ready
    end

    subgraph EDGE_STORAGE ["3. IN-PROCESS QDRANT EDGE MULTI-SHARD ENGINE (qdrant-edge-py)"]
        direction TB
        subgraph SHARDS ["Native In-Process Shards (4 Distinct Data Stores)"]
            SHARD_REF[("reference Shard<br/>• Emergency Protocol Cards<br/>• Seeded Baseline Checkpoints<br/>• Verified Guides")]:::storage
            SHARD_EVT[("events Shard<br/>• Dynamic Field Observations<br/>• Scoped: public / group / resp<br/>• Canonical SHA-256 Hashed")]:::storage
            SHARD_GRP[("groups Shard<br/>• Tactical Group Tokens<br/>• HMAC SHA-256 Hashes<br/>• Access Boundaries")]:::storage
            SHARD_RCP[("receipts Shard<br/>• Transfer Hop Audit Records<br/>• Timestamps & Direction<br/>• Memory Ripple Provenance")]:::storage
        end
        PAYLOAD_IDX["Payload & Geo Inverted Indexes<br/>• kind, visibility, group_id, entity_id (Keyword)<br/>• location (GeoPoint / GeoRadius Search)"]:::ready
        VEC_ARITH["Vector Arithmetic Recommender<br/>• V_rec = normalize(V_base - 0.5 * V_hazard)<br/>• Nearest Neighbor Facility Candidate"]:::algo
        CONTRADICTION["Contradiction Resolution Radar<br/>• 6-Hour Unverified Danger Retention<br/>• HMAC Command Authority Verification<br/>• Multi-Report Provenance Timeline"]:::ready
    end

    subgraph DISCOVERY_RELAY ["4. OFFLINE PEER DISCOVERY & SCOPED TRANSPORT MESH"]
        UDP_DISC["UDP Beacon Discovery (Port 8888)<br/>• Subnet Broadcast every 3.0s<br/>• Payload: ID, Role, Battery, GPS<br/>• Bearing (0-360°) & Haversine Distance"]:::ready
        PATH_LOSS["Path-Loss Signal Attenuation<br/>• dBm = -(42 + 20*log10(dist))<br/>• RSSI Quality: Strong/Mod/Weak"]:::algo
        PEER_SYNC["Scoped HTTP Peer Exchange<br/>• Public Hazard Sharing<br/>• Group-Key Enforced Sync<br/>• Deduplication via Canonical Hash"]:::ready
        SOS_UPLINK["1-Way SOS Emergency Uplink<br/>• Survivor-to-Responder Only<br/>• Zero Downstream Responder Exposure"]:::ready
        BLE_RADIO["Hardware-Native BLE/Direct Mesh<br/>• Future Android NDK / PHY Layer"]:::roadmap
    end

    subgraph CLOUD_CORE ["5. CENTRAL GATEWAY & QDRANT CLOUD MIRROR"]
        CENTRAL_GW["Central FastAPI Gateway<br/>• Role: central<br/>• HMAC Authority Signing<br/>• Guide Publisher & Validator"]:::ready
        subgraph CLOUD_COLLECTIONS ["Qdrant Cloud / Server (4 Scoped Collections)"]
            QC_PUB[("rescue_public_events<br/>Public Hazards & Warnings")]:::cloud
            QC_GRP[("rescue_group_events<br/>Authorized Group Feeds")]:::cloud
            QC_RES[("rescue_responder_events<br/>Restricted Casualty & SOS")]:::cloud
            QC_GDE[("rescue_approved_guides<br/>Authoritative Signed Guides")]:::cloud
        end
        OPT_GEMINI["Optional Gemini LLM<br/>• Grounded Synthesis via RAG<br/>• Cloud-Only Enrichment"]:::demo
    end

    subgraph CLIENT_APPS ["6. ROLE-BASED PROGRESSIVE WEB APPS (React 19 + Vite)"]
        UI_SURV["Survivor HUD<br/>• 1-Tap Offline SOS<br/>• Clinical Guidance Cards<br/>• Manual Pin Fallback"]:::ready
        UI_VOL["Volunteer Board<br/>• Tactical Nearby Triage<br/>• UDP Peer Sync Trigger<br/>• Scoped Envelope Relay"]:::ready
        UI_HQ["Command Inspector<br/>• Memory Ripple Hop Viewer<br/>• Contradiction Resolution<br/>• Qdrant Cloud Sync Dashboard"]:::ready
        UI_RADAR["Unified Survival Radar<br/>• 360° Compass Bearing<br/>• Color-Coded Triage Rings"]:::ready
    end

    %% Flow Connections
    INPUT --> INTENT
    INPUT --> TRIAGE
    INTENT --> DENSE_ENC
    INTENT --> SPARSE_ENC
    TRIAGE --> RRF

    DENSE_ENC --> RRF
    SPARSE_ENC --> RRF

    RRF --> SHARD_REF
    RRF --> SHARD_EVT

    SHARD_EVT <--> CONTRADICTION
    SHARD_REF <--> VEC_ARITH
    CONTRADICTION --> VEC_ARITH

    SHARD_EVT --> PEER_SYNC
    SHARD_GRP --> PEER_SYNC
    SHARD_EVT --> SOS_UPLINK
    PEER_SYNC --> SHARD_RCP
    SOS_UPLINK --> SHARD_RCP

    UDP_DISC --> PATH_LOSS
    PATH_LOSS --> UI_RADAR

    PEER_SYNC --> CENTRAL_GW
    SOS_UPLINK --> CENTRAL_GW
    CENTRAL_GW <--> CLOUD_COLLECTIONS
    CENTRAL_GW -.-> OPT_GEMINI

    SHARD_REF & SHARD_EVT & CONTRADICTION --> UI_SURV
    SHARD_EVT & UDP_DISC --> UI_VOL
    SHARD_RCP & CLOUD_COLLECTIONS --> UI_HQ
    SHARD_REF & SHARD_EVT & UDP_DISC --> UI_RADAR
```

---

## 2. Core Implemented Capabilities & Audited Readiness

- **🟢 Real In-Process Qdrant Edge (`qdrant-edge-py`)**: Four persistent disk shards (`reference`, `events`, `groups`, `receipts`) running in Rust without external Docker or network calls.
- **🟢 Dual-Vector Hybrid RRF Retrieval**: FastEmbed `all-MiniLM-L6-v2` dense vectors (384-d, Cosine) + in-engine Qdrant Edge BM25 sparse vectors merged via native `Fusion.Rrf(k=2)`.
- **🔵 Negative-Vector Arithmetic Facility Recommender**: When a facility is reported compromised by a hazard, the engine computes:
  $$\vec{V}_{\text{target}} = \frac{\vec{V}_{\text{base}} - 0.5 \cdot \vec{V}_{\text{hazard}}}{\|\vec{V}_{\text{base}} - 0.5 \cdot \vec{V}_{\text{hazard}}\|}$$
  and executes nearest-neighbor search to retrieve alternative safe shelters.
- **🟢 Offline UDP Subnet Beacon Discovery**: Background thread on `255.255.255.255:8888` broadcasts device presence every 3.0s, enabling zero-config node discovery on Wi-Fi hotspots without internet.
- **🔵 360° Tactical Survival Radar**: Computes real-time Haversine distance, forward compass bearing ($0^\circ - 360^\circ$), cardinal directions (`NNE`, `SSW`), walking time estimates, and simulated RF path loss attenuation ($\text{dBm}$).
- **🟢 Deterministic Clinical Triage Rerank**: Immediate protocol scoring overrides for life-threatening vitals (breathing failure CPR priority, arterial bleed tourniquet boost) and improvised field material matching (+0.15 boost).
- **🟢 Contradiction Radar & Memory Ripple**: Retains active danger reports for 6 hours, preventing silent overwrites by unverified safe reports. Logs hop-by-hop receipts for complete provenance auditability.
- **🟢 Scoped Mesh Relay & 1-Way SOS Uplink**: Public hazards sync openly; group records require HMAC tokens; survivors can upload private SOS to responders without receiving sensitive responder queues.
- **🟢 Qdrant Cloud Central Mirror**: Two-way synchronization across 4 isolated cloud collections (`rescue_public_events`, `rescue_group_events`, `rescue_responder_events`, `rescue_approved_guides`) on Central HQ.
- **🟡 Optional Online Gemini Synthesis**: Grounded cloud RAG available as an enrichment when internet is active; completely decoupled from the critical offline path.
- **⚪ Hardware Roadmap Boundary**: Native C++/Rust compilation on Android NDK and physical Bluetooth Low Energy PHY mesh.

---

## 3. Quickstart & Installation

### Prerequisites
- Python 3.11 or 3.12
- Node.js 20+

### Setup Commands
```powershell
# 1. Create and activate virtual environment
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

# 2. Provision local embedding model (runs once)
.\.venv\Scripts\python.exe backend\scripts\provision_model.py

# 3. Build frontend PWA
cd frontend
npm ci
npm run build
cd ..

# 4. Configure local environment
Copy-Item .env.example .env
```

Set unique keys in `.env` for `MESH_SHARED_KEY`, `RESPONDER_SHARED_KEY`, `NODE_ADMIN_KEY`, and `GUIDE_TRUST_KEY`.

---

## 4. Running the 3-Node Demonstration

Open three separate terminals to launch the survivor, volunteer, and central command nodes:

```powershell
# Terminal 1: Central Command HQ (Port 8000)
.\run_node.ps1 -NodeId hq -Role central -Port 8000

# Terminal 2: Field Volunteer Node (Port 8002)
.\run_node.ps1 -NodeId volunteer-b -Role volunteer -Port 8002 -CentralUrl http://127.0.0.1:8000

# Terminal 3: Survivor Node (Port 8001)
.\run_node.ps1 -NodeId survivor-a -Role survivor -Port 8001 -CentralUrl http://127.0.0.1:8000
```

- **Survivor HUD**: Open `http://127.0.0.1:8001/`
- **Volunteer Board**: Open `http://127.0.0.1:8002/volunteer`
- **Command Inspector**: Open `http://127.0.0.1:8000/command`
- **Survival Radar**: Open `http://127.0.0.1:8001/radar`

To test on physical mobile phones over a hotspot, add the `-Lan` flag:
```powershell
.\run_node.ps1 -NodeId survivor-a -Role survivor -Port 8001 -Lan
```
Open `http://<laptop-LAN-IP>:8001/` on the phone's browser.

---

## 5. Automated Verification & Testing

Every single component in RescueMemory is covered by automated regression tests:

```powershell
# Run the complete test suite
$env:PYTHONPATH="."
python -m pytest -q backend\tests
```

**Results:**
```
22 passed, 2 warnings in 583.82s (100% Green)
```

Run the end-to-end 3-process rehearsal:
```powershell
python backend\scripts\demo_flow.py
```
This automatically verifies survivor hazard creation, peer sync to volunteer, uplink to central command, Qdrant Cloud collection isolation, and verified guide return.

To run a synthetic live check against your configured Qdrant Cloud cluster:
```powershell
python -m backend.scripts.cloud_smoke
```

---

## 6. Comprehensive Documentation Index

- [Qdrant Architecture Deep Dive](docs/qdrant-architecture-guide.md): In-depth guide explaining how Qdrant Edge, BM25, and RRF operate under the hood.
- [Qdrant Cloud & Deployment Guide](docs/qdrant-cloud-guide.md): Step-by-step instructions for Qdrant Cloud clusters, isolated collections, and security audits.
- [Pitch Deck & Presentation Notes](docs/pitch-deck-notes.md): Slide-by-slide narrative and talk track modeled on the award-winning DeepTrace presentation.
- [Frontend PWA Architecture](frontend/README.md): Detailed documentation of the React 19 interface, views, and service worker caching.
- [Orientation & Context Blueprint](CONTEXT.md): Team context, project invariants, and architectural decisions.
