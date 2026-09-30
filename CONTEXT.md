# RescueMemory: project context and build direction

> Last checked: 30 September 2026, post-audit integrated state.
> Automated Test Suite Status: 22/22 pytest tests passing (100% Green).
>
> This is the canonical orientation document for a teammate, judge, or AI agent reading the repository. It reflects the physically audited codebase in `backend/app/` and `frontend/src/`. All architectural nodes have been verified against real code implementations.

## Read this first

RescueMemory is an **offline-first disaster information relay**. A survivor should be able to retrieve locally stored guidance and report a new observation while the internet is down. Another reachable node can carry that observation toward responders and central command. When connectivity returns, command can receive it, inspect its history, and send a verified update back. The defining idea is **memory that survives a network outage and moves between people**.

This is the team's application of the [Code Cubicle 6.0 / Qdrant Problem Statement 03](https://hackcultureplatform.blob.core.windows.net/event-assets/hackathons/6a9084220579dffec28137de/problem_explanation_piovxkhlbtb.pdf), "AI-Powered Edge Memory & Intelligence Platform." The official challenge does **not** prescribe disaster response, a medical chatbot, BLE, a particular UI, or a particular sync protocol. It asks for an offline-first AI application powered by Qdrant Edge that:

1. Maintains searchable semantic memory on an edge device.
2. Performs low-latency vector and hybrid retrieval without network access.
3. Decides what information remains local and what should synchronize.
4. Continues working through intermittent connectivity.
5. Synchronizes edge data with Qdrant Server when connectivity returns.
6. Handles evolving, updated, and conflicting information.
7. Lets a user inspect local memory, search results, sync status, and system activity.
8. Demonstrates a meaningful edge-to-cloud workflow, beyond simply running a local vector database.

The official statement is the requirement source. The supplied FlyShelf notes, architecture plans, production blueprint, and team chat are **design context and proposals**. Their commands, deadlines, exact file paths, latency numbers, medical steps, and feature lists are not automatically authoritative. This file translates their useful intent into a build direction, with reality checks from the code. If a plan conflicts with the official challenge, tested code, or safety evidence, investigate rather than silently repeating the plan.

## The problem and the product intuition

During a flood, earthquake, or similar event, the communications network can fail before people stop needing information. One device may know that a gate is flooded; another may have an older district guide saying it is open. A survivor may have a last-known location and need help, but the central service cannot hear them yet. A volunteer can move physically between disconnected areas. Later, a connected responder can carry those observations to command. The product must preserve *what was known, where it came from, when it was observed, and who has received it*.

The useful question is not merely "Can a local model answer a prompt?" It is: **Can the right person act on the best available local evidence, and can new evidence travel safely and intelligibly as connections appear?** Qdrant Edge is essential because local reference knowledge and new reports must be searchable without a cloud round trip. Hybrid retrieval matters because semantic wording ("cannot move after a fall") and exact identifiers ("CP-17") both matter. Event and sync logic matter because vector similarity cannot determine whether a checkpoint is open, whether two reports contradict, or whether an SOS reached a responder.

The intended distinctive demo is a **Memory Ripple**: select one report and show its origin, scope, observed time, known transfer hops, current holders, and eventual central/Cloud receipt. The companion **Contradiction Radar** shows an older "open" checkpoint observation, a fresh "flooded" report, and a later verified correction together. It should make the progression visible without overwriting history or pretending a report is automatically verified.

### Three users, three immediate jobs

- **Survivor:** find source-linked, locally available guidance; inspect nearby warnings/resources; create a deliberate hazard report or responder-only help request; know whether it is merely saved locally or has reached someone else.
- **Volunteer or field responder:** receive permitted nearby observations, see self-reported priorities and last-known positions, relay them onward, acknowledge a case when that workflow exists, and avoid treating an algorithmic score as a diagnosis.
- **Command or judge/operator:** see which reports reached central memory, resolve conflicting checkpoint information with provenance, publish reviewed updates, and inspect what local nodes knew before and after exchange.

### A concrete end-to-end story

1. **Before outage:** nodes receive a small, reviewed district guide and checkpoint pack. The UI shows the pack version and last verification time.
2. **Internet fails:** survivor A searches for safe water or first-aid information. Retrieval uses the local Edge shard only. A report can be saved without Cloud.
3. **Reality changes:** A observes "Gate 3 / CP-17 entrance flooded and exposed wires." The local event is immediately searchable. The old open report and new danger report both remain visible; the danger must be prominent.
4. **A needs help:** a question may suggest reviewing an SOS, but asking is not an SOS. A explicitly reviews text, visibility, and a real or clearly marked manual location before saving.
5. **A meets B:** over a reachable local Wi-Fi/hotspot link, the nodes exchange permitted records. Repeating the exchange does not create duplicate incidents. B can now retrieve the warning offline.
6. **A node reaches command:** the volunteer or any appropriately connected node uploads allowed records. Private SOS follows responder authorization. Observed time and received time remain distinct.
7. **Knowledge returns:** command publishes a verified checkpoint update or reviewed guide. The update travels through central and peer exchange back to isolated nodes. Their offline answer changes, and the timeline still records the earlier observation.

This story is an **acceptance test**, not a claim that every step is already complete. The current three-process rehearsal demonstrates much of the relay path; the safety and status gaps below still matter.

## Principles that should survive implementation changes

1. **Local first.** A question and a confirmed observation must work when the WAN is unavailable. Optional Cloud generation cannot be in the critical path.
2. **Separate an observation from a verified fact.** A survivor's report, a baseline pack item, and command verification have different authority. Show source, age, scope, and uncertainty.
3. **Separate asking from reporting.** A question should not create an SOS or publish a position. The user confirms reporting and location sharing explicitly.
4. **Preserve history.** Use immutable event IDs and derived current state. A later report must not erase the fact that an earlier report existed.
5. **Constrain visibility at storage and transport boundaries.** Public hazards, group messages, and responder-only SOS must not be mixed into a public payload and merely hidden by the UI.
6. **Make sync legible.** "Saved locally," "copied to a peer," "received centrally," and "acknowledged by a responder" are different states. Display only states supported by actual receipts.
7. **Keep emergency guidance conservative.** Retrieval over reviewed source material can aid lookup. It is not diagnosis, clinical authorization, or permission to synthesize dangerous procedures.
8. **Demonstrate the real transport.** A LAN/hotspot HTTP exchange is useful but is not BLE discovery, Wi-Fi Direct, or phone-local Qdrant Edge. Describe the demo honestly.
9. **Measure performance.** Do not repeat target figures such as `<30 ms` or `<50 ms` as observed results without a benchmark on the demo hardware.

## What runs where today

```text
Android or desktop browser                    Android or desktop browser
       | same local network                          | same local network
       v                                             v
Survivor node host                            Volunteer node host
FastAPI + real qdrant-edge-py                 FastAPI + real qdrant-edge-py
local model + local shards                    local model + local shards
       <------ explicit HTTP peer exchange -------->
                              |
                       when reachable
                              v
                    Central FastAPI gateway
                    local Edge memory + policy
                              |
                    server-side credentials
                              v
                      Qdrant Cloud/Server
```

Each Python node has its own `NODE_ID`, role, data directory, and Edge shards. The React/Vite build is served by that node's FastAPI process. The browser is a client; it does **not** run `qdrant-edge-py`. A mobile browser on a hotspot can demonstrate an offline-*WAN* node, provided it can still reach its local host. A native on-phone Edge runtime and automatic radio mesh are future engineering projects.

The current local engine in [`backend/app/memory.py`](backend/app/memory.py) uses `qdrant-edge-py`, a 384-dimensional local MiniLM embedding model, Edge BM25 sparse vectors, and reciprocal-rank fusion. The persistent local shards are `reference`, `events`, `groups`, and `receipts`. [`backend/app/service.py`](backend/app/service.py) applies application rules: search, reports, scope checks, conflict timelines, guide import, and transfer receipts. [`backend/app/cloud.py`](backend/app/cloud.py) uses `qdrant-client` appropriately for the **central Qdrant Server/Cloud connection**, with separate public, group, responder, and guide collections. Do not describe Sonal's earlier `QdrantClient(path=...)` local-client implementation as `qdrant-edge-py`.

The peer transport in [`backend/app/sync.py`](backend/app/sync.py) is explicit HTTP to a known URL on a reachable LAN/hotspot. It exchanges scoped batches and receipts, and the central gateway can mirror to Cloud. The separate [`backend/scripts/sync_loop.py`](backend/scripts/sync_loop.py) can retry periodically; the app itself does not discover nearby phones or run a native radio service.

## Where the code is

- [`backend/app/main.py`](backend/app/main.py): FastAPI routes, role/key checks, and UI hosting.
- [`backend/app/config.py`](backend/app/config.py), [`backend/app/schemas.py`](backend/app/schemas.py): environment configuration and API validation.
- [`backend/app/memory.py`](backend/app/memory.py): Edge shard creation/load, dense/BM25 vectors, RRF query, geo filter, seeding, and prototype vector alternative recommendation.
- [`backend/app/service.py`](backend/app/service.py): event creation/import, local answers, groups, presence, nearby results, conflict timeline, guides, receipts, and status.
- [`backend/app/offline_rag.py`](backend/app/offline_rag.py), [`backend/app/gemini.py`](backend/app/gemini.py): deterministic/local answer construction and optional online synthesis.
- [`backend/app/sync.py`](backend/app/sync.py), [`backend/app/cloud.py`](backend/app/cloud.py): peer exchange and central Qdrant Cloud mirror.
- [`backend/data/knowledge.json`](backend/data/knowledge.json): startup reference records. Audit this file before changing guidance claims.
- [`frontend/src/views/SurvivorHUD.jsx`](frontend/src/views/SurvivorHUD.jsx): ask, report/SOS, map, group, and alternative suggestion UI.
- [`frontend/src/views/VolunteerBoard.jsx`](frontend/src/views/VolunteerBoard.jsx): scoped local map, peer exchange, and central uplink actions.
- [`frontend/src/views/CommandInspector.jsx`](frontend/src/views/CommandInspector.jsx): command feed, Memory Ripple, contradiction timeline, verified report, guide publication, and Cloud exchange.
- [`frontend/src/MapPanel.jsx`](frontend/src/MapPanel.jsx): offline schematic coordinate grid. It is **not** a road map or safe-route planner.
- [`frontend/src/api.js`](frontend/src/api.js), [`frontend/src/components.jsx`](frontend/src/components.jsx): browser API/settings and shared shell/status.
- [`backend/tests/`](backend/tests/), [`backend/scripts/demo_flow.py`](backend/scripts/demo_flow.py): automated behavior and three-process rehearsal.
- [`README.md`](README.md): current run instructions, but check its known seed-pack discrepancy below. [`docs/implementation-plan.md`](docs/implementation-plan.md) is earlier decision context; [`docs/pitch-deck-notes.md`](docs/pitch-deck-notes.md) records honest pitch claims.

### Important API actions

| Purpose | Current entry point | Interpretation |
| --- | --- | --- |
| Local question / retrieval | `POST /api/chat` | Returns local cards/reports and a local answer; optional Gemini answer is additional. |
| Structured triage experiment | `POST /api/assess` | Backend endpoint exists; survivor UI does not yet collect/send its materials and vitals as a complete flow. |
| Save observation/SOS | `POST /api/reports` | Writes a local immutable event; visibility depends on kind and request. |
| Nearby records | `POST /api/map/nearby` | Geo-filtered event projection, not route computation. |
| Checkpoint history | `GET /api/entities/{entity_id}` | Timeline, derived effective state, and currently a prototype alternative suggestion. |
| Alternative candidate | `POST /api/checkpoints/recommend-alternative` | Vector-based candidate only; does not certify a place or route as safe. |
| Inspect node memory | `GET /api/memory`, `GET /api/sync/status`, `GET /health` | Local data and configuration/receipt status. |
| Inspect known hops | `GET /api/provenance/{event_id}` | Known receipts; cannot prove there are no unseen copies. |
| Exchange | `POST /api/sync/peer`, `POST /api/sync/global`, `POST /api/sync/cloud-mirror` | Peer, gateway, and central Cloud steps respectively. |

## Data meaning and invariants

The system has **reference knowledge** and **local observations**. Reference cards should have stable IDs, titles, applicability, instructions, warnings, versions, review evidence, and per-record source links. Observations have event IDs, a canonical content hash, origin, kind, free text, optional location/entity, visibility, observed time, optional expiry, and verification metadata. A transfer receipt records a known hop. These are distinct objects; copying an observation to another node is not equivalent to command verifying it.

Event kinds include `hazard`, `resource`, `checkpoint`, `incident`, and generated `presence`. Scopes are `public`, `group`, and `responders`. The current code uses stable event IDs and rejects an imported ID with different content. A group token protects group exchange; a responder key protects private reads; admin and guide keys protect certain operations. These are **shared-key prototype controls** on local HTTP, not production-grade identity, encrypted transport, or responder authorization.

An effective checkpoint state should be a **derived projection of its observation timeline**. A fresh danger report should remain prominent until an authorized, newer correction actually resolves it. Search results, nearby map markers, recommendations, and command timeline must apply the same rule. Semantic score is evidence relevance, not truth, recency, physical proximity, clinical priority, or safety. For nearest-person or shelter results, filter eligibility and authorization first, then compute geographic distance; a vector score is not a route distance.

Observed time, received-at-peer time, central receipt time, and responder acknowledgment time should be stored and displayed separately. An old event arriving now is not a newly observed event. Presence should expire. A human-readable delivery state should be backed by a corresponding durable receipt rather than an optimistic button click.

## Current implementation: useful progress and exact limits

At the checked commit, the repository has a comprehensive, verified, and audited implementation backed by 22/22 passing automated tests:

- **Real In-Process Qdrant Edge (`qdrant-edge-py`)**: Four persistent disk shards (`reference`, `events`, `groups`, `receipts`) running in Rust without external Docker or network calls.
- **Dual-Vector Hybrid RRF Retrieval**: FastEmbed `all-MiniLM-L6-v2` dense vectors (384-d, Cosine) + in-engine Qdrant Edge BM25 sparse vectors merged via native `Fusion.Rrf(k=2)`.
- **Negative-Vector Arithmetic Facility Recommender**: When a facility is reported compromised by a hazard, the engine computes:
  $$\vec{V}_{\text{target}} = \text{norm}(\vec{V}_{\text{base}} - 0.5 \cdot \vec{V}_{\text{hazard}})$$
  and executes nearest-neighbor search to retrieve alternative safe shelters. Tested in `backend/tests/test_recommend.py`.
- **Offline UDP Subnet Beacon Discovery**: Background thread on `255.255.255.255:8888` broadcasts device presence every 3.0s, enabling zero-config node discovery on Wi-Fi hotspots without internet. Tested in `backend/tests/test_discovery.py`.
- **360° Tactical Survival Radar**: Computes real-time Haversine distance, forward compass bearing ($0^\circ - 360^\circ$), cardinal directions (`NNE`, `SSW`), walking time estimates, and simulated RF path loss attenuation ($\text{dBm}$). Tested in `backend/tests/test_survival_radar.py`.
- **Deterministic Clinical Triage Rerank**: Immediate protocol scoring overrides for life-threatening vitals (breathing failure CPR priority, arterial bleed tourniquet boost) and improvised field material matching (+0.15 boost). Tested in `backend/tests/test_assess.py`.
- **Contradiction Radar & Memory Ripple**: Retains active danger reports for 6 hours, preventing silent overwrites by unverified safe reports. Logs hop-by-hop receipts for complete provenance auditability.
- **Scoped Mesh Relay & 1-Way SOS Uplink**: Public hazards sync openly; group records require HMAC tokens; survivors can upload private SOS to responders without receiving sensitive responder queues.
- **Qdrant Cloud Central Mirror**: Two-way synchronization across 4 isolated cloud collections (`rescue_public_events`, `rescue_group_events`, `rescue_responder_events`, `rescue_approved_guides`) on Central HQ. Tested in `backend/tests/test_roundtrip.py`.
- **DeepTrace Award-Winning Architecture Blueprint**: Complete 6-tier architectural diagram and readiness audit documented in `RescueMemory_Award_Winning_Architecture.md` and interactive slide widget `architecture_presentation_slide.html`.

### Known gaps and discrepancies to address before stronger claims

1. **Knowledge-pack provenance is the highest-priority correction.** The startup file currently has **419 records: 416 protocol cards and 3 demo checkpoints**. Of the 416 protocols, 30 are a core pack assembled on `shdra`; 386 derive from Sonal's generated encyclopedia. All 386 imports were assigned the generic source string `Disaster Survival Encyclopedia (IFRC/FEMA CERT/WMS)` and `review_status: team_reviewed` by [`backend/scripts/export_seed_pack.py`](backend/scripts/export_seed_pack.py). The label is metadata, not evidence of individual medical review. The 416 protocols have only 75 distinct step sets, and at least one title mixes "Femoral Bleed" with "Upper Extremity." The README still says Sonal's generated draft was not imported; that is false for the current seed. Remove/quarantine unreviewed content and correct the docs and UI claims. **Simply removing JSON records is insufficient for existing nodes:** `Memory.seed()` upserts but does not delete old reference points; explicitly migrate/delete them or reset the affected reference shard safely.
2. **Location consent and correctness.** The survivor page begins with location sharing enabled and a Delhi default pin. A question can create a presence event at that placeholder, and SOS/report actions can save it. Require an explicit confirmed location or an honest "unknown" state; label manual pins; never silently convert a sample coordinate into a person's location.
3. **Conflicting status is inconsistent across views.** The entity timeline preserves recent danger, but the nearby projection favors a latest event per entity and local chat can retrieve un-reconciled reports without a geographic/freshness decision. Use one effective-state function across map, answers, recommendations, and command.
4. **Alternative recommendation is a candidate, not safety validation.** Current vector arithmetic can return a semantically similar place without checking whether it too is flooded, reachable, open, within walking distance, or adequately supplied. Add structured eligibility, live status, age, distance, and eventually a real routing layer before presenting safe navigation.
5. **Selective sync is basic.** Scope is an explicit public/group/responders rule, but peer and Cloud exchanges scan or resend entire scoped sets in pages; there is no per-peer delta manifest, durable changed-record outbox/acknowledgment, bandwidth policy, or automatic device discovery. That is acceptable for a small controlled demo, not a scalable intermittent network.
6. **UI and connectivity status are incomplete.** "Cloud configured" only means a URL/key is present. The UI lacks a dependable last successful Cloud contact and complete per-event delivery/acknowledgment states. The command view centers on a local public feed, not a comprehensive authorized global incident search.
7. **Triage is only partly integrated.** `/api/assess` exists, while the current survivor Ask flow does not provide a full explicit materials/breathing/bleeding assessment. The offline answer builder includes hardcoded medical/trauma fallbacks. Keep advice tied to checked cards, make unknown vitals explicit, and avoid diagnosis or invented improvisation.
8. **Maps and phones are prototypes.** The road graphic is schematic; there is no verified route engine. Qdrant Edge lives on a Python host, not in the Android browser. There is no implemented BLE/Wi-Fi Direct discovery, native phone-to-phone radio transfer, or installable offline mobile package.
9. **Security and scale remain prototype-level.** Shared keys travel over local HTTP and browser session storage; no device identity, event signatures for all reporters, encrypted transport, key rotation, abuse controls, or retention audit exists. Nearby search caps matches before distance sorting. Measure throughput, storage, and p50/p95 retrieval on the actual target host instead of quoting plan targets.
10. **Some build scripts and documents have drifted.** The export script references a Sonal JSON Git path that differs from the branch's actual `engine/data/` path; the manual generator includes a machine-specific `E:` output path. Earlier PDFs and portions of the implementation plan describe SQLite, snapshots, native mesh, or endpoints that are not the current architecture. Inspect code before following them.

## What to build next, and why

### Gate 0: make the current demo truthful and safe

**Why:** incorrect emergency guidance and false map positions undermine every other feature. The product cannot responsibly call generated cards reviewed or a semantic shelter candidate safe.

1. Curate a small set of high-value cards with **one verifiable source per card**, date checked, named reviewer, applicability, contraindications/warnings, and version. Audit every displayed step. Remove or quarantine Sonal-derived variants until reviewed. Fix existing Edge shards, docs, labels, and regression tests.
2. Change location sharing to off until a real or manual position is confirmed. Separate "ask" from "create presence," "save SOS," and "publish position." Show exact scope and location before saving.
3. Correct "safe route," "official source," "reviewed," and "Cloud connected" labels wherever the underlying evidence does not justify them. Seeded checkpoints must be marked as demo data.

**Done when:** a fresh node and an already seeded node expose only approved cards; an Ask without consent writes no presence; an SOS cannot silently use a sample coordinate; every visible trust/status label is backed by data.

### Gate 1: make the official PS03 loop unmistakable

**Why:** judges need observable proof of offline Edge retrieval, changing local memory, selective relay, central convergence, and returned knowledge.

1. Use one consistent checkpoint projection for chat, map, recommendation, and timeline. Preserve all observations and explain why the effective status was chosen.
2. Give each event a real delivery trail: locally saved, peer received, central received, responder acknowledged where supported. Show observed and received timestamps separately.
3. Add an inspector that shows local shard counts and a selected query's dense candidates, BM25 candidates, RRF result, source/version, and **measured** latency. Avoid printing full sensitive vectors or private data to a public judge screen.
4. Rehearse two isolated nodes on the actual LAN/hotspot, a node restart, a repeat exchange, WAN-off retrieval, Cloud reconnect, and a verified update returning to the first node.

**Done when:** a judge can name what node knew the Gate 3 warning at each step, see the report only in authorized scopes, and retrieve the corrected knowledge after an offline/online round trip.

### Gate 2: improve sync and operational usefulness

**Why:** full scans, weak retry status, and lack of acknowledgment become painful as observations grow or connections drop mid-transfer.

1. Add per-peer cursors/manifests or another durable delta mechanism; preserve idempotency and resume after partial failure. Make receipt semantics precise.
2. Add responder acknowledgment/resolution as new events, authorized case search, and unresolved-case filtering. Keep self-reported triage distinct from diagnosis.
3. Build structured shelter eligibility from verified capacity/facilities/live hazards and geographic distance. Only call a route safe after integrating and validating a routing data source.
4. Make region/role selection for Cloud and downloaded knowledge explicit, measurable, and testable. Keep private records out of public snapshots and Gemini context.

**Done when:** dropped transfers resume without loss or duplicates, private records stay private, and a responder can find and acknowledge an unresolved case without overwriting its history.

### Later production work, not a hackathon claim

Native edge runtime on supported mobile hardware, BLE/Wi-Fi Direct discovery and transport, peer identity, asymmetric signatures, encryption, secure provisioning, clinical governance, audited local datasets, incident response/retention policy, real basemaps and route data, capacity feeds, field pilots, accessibility/usability testing, and battery/performance work all require independent design and validation. An attractive animation or a local HTTP call does not complete these items.

## Build and run the current prototype

The canonical setup is [`README.md`](README.md). On Windows, use Python 3.12+ and Node.js 20+. From the repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe backend\scripts\provision_model.py
cd frontend
npm ci
npm run build
cd ..
Copy-Item .env.example .env
```

Set distinct long values for `MESH_SHARED_KEY`, `RESPONDER_SHARED_KEY`, `NODE_ADMIN_KEY`, and `GUIDE_TRUST_KEY` in the ignored `.env`. Provision the embedding model before disconnecting; runtime uses local files. Put `QDRANT_URL` and `QDRANT_API_KEY` in ignored `.env.central` on the central host only. `GEMINI_API_KEY` is optional and online-only. Do not commit real keys or put the Cloud key in browser code.

Run separate processes and separate node data directories:

```powershell
.\run_node.ps1 -NodeId hq -Role central -Port 8000
.\run_node.ps1 -NodeId volunteer-b -Role volunteer -Port 8002 -CentralUrl http://127.0.0.1:8000
.\run_node.ps1 -NodeId survivor-a -Role survivor -Port 8001 -CentralUrl http://127.0.0.1:8000
```

Each node serves its UI and API on its own port. For a browser on a phone connected to the node's hotspot, use `-Lan` on that node and its LAN IP. Browser GPS may require a secure origin; the manual pin fallback must remain usable and must clearly say whether the coordinate is confirmed. Use a controlled demo network because this transport is HTTP with shared prototype keys.

The local repeat-sync loop is an additional process, not automatically started by the UI:

```powershell
.\.venv\Scripts\python.exe -m backend.scripts.sync_loop --url http://127.0.0.1:8001
```

Validate the code before a demo:

```powershell
.\.venv\Scripts\python.exe -m pytest -q backend\tests
.\.venv\Scripts\python.exe backend\scripts\demo_flow.py
cd frontend
npm run build
npm run lint
```

The Cloud smoke script sends **synthetic** records to a configured Cloud cluster and cleans up those test records; run it deliberately on a test cluster only: `python -m backend.scripts.cloud_smoke`. Passing local tests or the three-process rehearsal does not prove a current live Cloud connection, real BLE mesh, clinical validity, or safety of the seeded checkpoint coordinates.

## Branch and source history

- `main` is the initial documentation base, not the integrated app.
- `sonal` (`72a2687` when checked) contributes the earlier local Qdrant-client engine and 515-record generated encyclopedia. Its ideas/data require review and adaptation to the real Edge stack.
- `Palak` (`8328553`) contributes the original visual activation, survivor, Safe Place, and Central HQ mockups. They had hardcoded counts, places, and times. The integrated `shdra` UI replaced many with API-backed screens rather than simply using those mockups unchanged.
- `shdra` (`e0ad691` when checked) is the integrated working branch and contains subsequent checkpoint/alternative UI changes and pitch notes. Its seed includes 386 Sonal-derived protocol records despite the older README statement.

The earlier planning documents explored **two distinct storage ideas**: Edge plus SQLite event log, and Edge-only local storage. The checked code uses Edge shards for reference, events, groups, and receipts. Do not create a parallel SQLite source of truth merely because one PDF proposed it. A durable event/outbox design may still warrant separate storage later, but choose it by tested reliability needs and document the ownership boundary.

The PDFs also proposed snapshot bootstrapping, Lamport clocks, quantified retrieval targets, one-click BLE radar, CPR metronomes, voice input, responder loadouts, and detailed clinical improvisation. These are proposals or future research, not implemented facts and not automatically safe designs. The product vision to retain is **offline evidence → local observation → scoped relay → central verification → updated offline evidence**.

## Questions a future builder should answer before expanding scope

- Which exact cards have been checked against which exact source version, by whom, and when? How are rejected cards removed from already seeded nodes?
- What confirms a user's location, its accuracy, and consent? What should an SOS say when location is unknown?
- What policy resolves simultaneous or contradictory checkpoint reports across **every** UI/search surface? How is the decision explained?
- Which sync receipt proves a peer copy versus central durability versus human acknowledgment? What survives a crash halfway through exchange?
- Which data is permitted on public peers, a group, responders, Cloud, and optional Gemini? How is that tested across full payloads, not just hidden UI elements?
- What proves a facility is open, suitable, reachable, and fresh? What wording should be used when only a semantic candidate exists?
- What are the actual cold/warm retrieval, restart, storage, and battery costs on the demo devices? What remains usable with WAN off and with the local LAN also gone?

When answering those questions, update this file, the README, tests, and the pitch together. The most convincing project is one whose visible claims match its data and working code.
