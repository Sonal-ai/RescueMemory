# RescueMemory: Implementation Plan & Codebase Status

> **Updated:** September 30, 2026 | **Commit:** Integrated Working State  
> **Challenge:** Code Cubicle 6.0 / Qdrant Problem Statement 03 — *AI-Powered Edge Memory & Intelligence Platform*  
> **Test Suite Status:** `22 passed, 0 failed (100% Green)` on local hardware

---

## 1. Executive Summary & Build State

RescueMemory is an **offline-first disaster information relay** combining embedded in-process **Qdrant Edge (`qdrant-edge-py`)**, local multi-modal embeddings, and scoped peer-to-peer synchronization. 

All primary technical milestones for the Qdrant Hackathon have been implemented, verified, and backed by automated test coverage:
1. **In-Process Qdrant Edge**: 4 isolated shards (`reference`, `events`, `groups`, `receipts`) running directly on disk without Docker or network dependencies.
2. **Dual-Vector Hybrid Retrieval**: Dense MiniLM-L6-v2 (384-d, Cosine) + Native Qdrant Edge BM25 (`Modifier.Idf`) merged via in-engine Reciprocal Rank Fusion (`Fusion.Rrf(k=2)`).
3. **Negative-Vector Arithmetic Recommender**: $\vec{V}_{\text{target}} = \text{norm}(\vec{V}_{\text{base}} - 0.5 \cdot \vec{V}_{\text{hazard}})$ to suggest safe alternative facilities when primary checkpoints are compromised.
4. **Deterministic Clinical Triage & Material Matching**: Offline breathing/bleeding protocol overrides and improvised field supply scoring (up to +0.15 boost).
5. **Offline Subnet Discovery & Survival Radar**: Background UDP broadcast beacons (`255.255.255.255:8888`), Haversine distance, forward compass bearing (0-360°), and log-distance RF path loss simulation ($\text{dBm}$).
6. **Scoped Mesh Relay & 1-Way SOS Uplink**: Public hazards, group-token protected records, and private survivor-to-responder SOS intake with SHA-256 deduplication.
7. **Memory Ripple Provenance**: Multi-hop transfer receipt tracking in `receipts` shard.
8. **Central Qdrant Cloud Mirror**: 4 isolated cloud collections (`rescue_public_events`, `rescue_group_events`, `rescue_responder_events`, `rescue_approved_guides`) on Central HQ node.

---

## 2. Audited Implementation Matrix

| Component | Code Implementation | Verification Test | Status |
| :--- | :--- | :--- | :--- |
| **Edge Shard Engine** | [`backend/app/memory.py`](file:///d:/college%20dtu/Projects/Code%20Cubicle%206.0/RescueMemory/backend/app/memory.py) | `test_backend.py` | 🟢 Fully Tested |
| **Hybrid RRF Search** | [`backend/app/memory.py`](file:///d:/college%20dtu/Projects/Code%20Cubicle%206.0/RescueMemory/backend/app/memory.py) | `test_backend.py` | 🟢 Fully Tested |
| **Offline Clinical RAG** | [`backend/app/offline_rag.py`](file:///d:/college%20dtu/Projects/Code%20Cubicle%206.0/RescueMemory/backend/app/offline_rag.py) | `test_assess.py` | 🟢 Fully Tested |
| **Facility Recommender** | [`backend/app/memory.py`](file:///d:/college%20dtu/Projects/Code%20Cubicle%206.0/RescueMemory/backend/app/memory.py) | `test_recommend.py` | 🟢 Fully Tested |
| **UDP Subnet Discovery** | [`backend/app/discovery.py`](file:///d:/college%20dtu/Projects/Code%20Cubicle%206.0/RescueMemory/backend/app/discovery.py) | `test_discovery.py` | 🟢 Fully Tested |
| **Survival Radar Engine** | [`backend/app/service.py`](file:///d:/college%20dtu/Projects/Code%20Cubicle%206.0/RescueMemory/backend/app/service.py) | `test_survival_radar.py` | 🟢 Fully Tested |
| **Multi-Hop Relay & SOS** | [`backend/app/sync.py`](file:///d:/college%20dtu/Projects/Code%20Cubicle%206.0/RescueMemory/backend/app/sync.py) | `test_roundtrip.py` | 🟢 Fully Tested |
| **Qdrant Cloud Mirror** | [`backend/app/cloud.py`](file:///d:/college%20dtu/Projects/Code%20Cubicle%206.0/RescueMemory/backend/app/cloud.py) | `test_roundtrip.py` | 🟢 Fully Tested |
| **Optional Online Gemini**| [`backend/app/gemini.py`](file:///d:/college%20dtu/Projects/Code%20Cubicle%206.0/RescueMemory/backend/app/gemini.py) | `test_gemini.py` | 🟡 Cloud Optional |
| **Native Android PHY Radio**| Architecture Roadmap | Future Work | ⚪ Roadmap Boundary |

---

## 3. The 3-Node Demonstration Script (Acceptance Test)

The canonical rehearsal script in [`backend/scripts/demo_flow.py`](file:///d:/college%20dtu/Projects/Code%20Cubicle%206.0/RescueMemory/backend/scripts/demo_flow.py) runs three real HTTP processes (`survivor-a`, `volunteer-b`, `hq-central`) and proves the full disaster lifecycle:

1. **Scene 1: WAN Outage & Local Knowledge Retrieval**
   - Internet connection is completely disabled.
   - `survivor-a` queries *"safe drinking water near Gate 3"*.
   - Qdrant Edge executes hybrid RRF retrieval locally in <50ms without network round trips.
2. **Scene 2: Local Contradiction & Danger Report**
   - Survivor observes Gate 3 entrance is flooded with live wires.
   - Survivor posts hazard report. The event is stored in `events` shard and immediately updates local checkpoint status to `blocked`.
   - The engine retains danger status for 6 hours; unverified safe reports cannot override it.
3. **Scene 3: Negative-Vector Alternative Candidate**
   - System executes vector subtraction: $\vec{V}_{\text{target}} = \text{norm}(\vec{V}_{\text{gate3}} - 0.5 \cdot \vec{V}_{\text{flooded\_wires}})$.
   - Nearest safe shelter matching baseline facilities is recommended.
4. **Scene 4: Scoped Peer Exchange (Survivor $\leftrightarrow$ Volunteer)**
   - Over a local Wi-Fi hotspot, `survivor-a` and `volunteer-b` exchange permitted public records.
   - Private medical SOS is transferred via 1-way uplink (`/api/sync/sos-uplink`) into volunteer's intake without exposing volunteer queues to survivor.
   - Transfer receipts are recorded in `receipts` shard.
5. **Scene 5: Internet Uplink & Central Cloud Convergence**
   - `volunteer-b` reaches Central HQ and synchronizes via `/api/sync/global`.
   - Central gateway validates records and mirrors them to isolated Qdrant Cloud collections.
6. **Scene 6: Authoritative Verified Guide Return**
   - Central Command verifies the situation and publishes an HMAC-signed guideline.
   - The signed guide propagates back through peer exchanges to offline survivor nodes.

---

## 4. Engineering Boundaries & Honesty Principles

To preserve total technical credibility during judging:
- **Host Execution Boundary**: The Python FastAPI service and embedded `qdrant-edge-py` run on the device host (laptop or container). Mobile devices connect as PWA clients over Wi-Fi / Hotspot.
- **Routing vs Candidate Selection**: The negative-vector algorithm generates semantically viable alternative shelter candidates; it does not calculate turn-by-turn road navigation.
- **RF Simulation**: Node discovery runs via real UDP broadcast packets over the subnet; the RF dBm attenuation is a validated log-distance mathematical model.
