# RescueMemory

**Offline disaster memory that moves between people and a central Qdrant Cloud memory.** Each local node runs the actual `qdrant-edge-py` library on disk. It can search and record observations without internet; any connected node can exchange permitted reports with a central gateway, which mirrors them to Qdrant Cloud. Approved guide updates move back to local nodes and can be relayed across a local hotspot.

The actual hackathon challenge is Qdrant's AI-powered edge memory and intelligence platform. The supplied PDFs and team chat informed the use case; they are not implementation requirements. [The implementation plan](docs/implementation-plan.md) describes the intended product and boundaries.

## What is implemented

- **Real Qdrant Edge:** persistent reference, event, group, and receipt shards; offline MiniLM dense search plus Edge BM25 and reciprocal-rank fusion; no Docker or network call during local retrieval.
- **Disaster reports:** public hazards/resources, group reports, responder-only SOS, opt-in survivor presence, nearby geo filtering, immutable event IDs, duplicate rejection, and a checkpoint conflict timeline.
- **Local relay:** bounded HTTP exchange over a reachable LAN/hotspot, authenticated by shared prototype keys; public/group/responder scopes; per-event transfer receipts for the Memory Ripple view.
- **Central loop:** any connected survivor or volunteer can sync allowed data to the central API. The central API exchanges separate public, group, and responder collections plus approved guides with Qdrant Cloud. Cloud credentials stay on the central process.
- **Guide updates:** command publishes a versioned, source-linked card. An HMAC authentication tag checked with `GUIDE_TRUST_KEY` prevents alteration in transit during the controlled demo. Nodes pull and relay signed cards. This is a shared-key prototype, not production device identity.
- **Palak frontend:** her activation/HUD design extended into a responsive survivor view, nearby grid map, volunteer board, group controls, and command/Memory Ripple inspector. All displayed counts and search results come from APIs.

The Android prototype is a **web interface** opened from a local node over Wi-Fi. Qdrant Edge runs on the node host, not inside the Android browser. The browser and host can operate without internet while their local connection remains available. Native phone-local Edge, Bluetooth discovery, and fully disconnected phone-to-phone transfer are future work. The schematic map uses no online tiles, and manual pin placement works without browser GPS permission.

## Install

Use Python 3.12+ and Node.js 20+. On Windows, from the repository root:

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

Set long, unique values in `.env` for `MESH_SHARED_KEY`, `RESPONDER_SHARED_KEY`, `NODE_ADMIN_KEY`, and `GUIDE_TRUST_KEY`. Use the same mesh/guide keys only among the demo nodes that should exchange data. Keep `.env` private. The model is provisioned once and then loaded with `local_files_only=True` on every node.

For Qdrant Cloud, copy `.env.central.example` to `.env.central` **on the central host only** and fill in the cluster HTTPS endpoint and **Database API key**. Both real environment files are Git ignored. A free Qdrant Cloud cluster works; Docker is not needed. Verify the read-only connection:

```powershell
.\.venv\Scripts\python.exe backend\scripts\check_cloud.py
```

## Run and test

Start one node. The built web interface and API share the same port:

```powershell
.\run_node.ps1 -NodeId survivor-a -Role survivor -Port 8001
```

Open `http://127.0.0.1:8001/` for the app or `/docs` for API documentation. For an Android browser on the same hotspot, add `-Lan` and open `http://<laptop-LAN-IP>:8001/`. Use a controlled demo network because the prototype API uses shared keys and local HTTP.

For a three-process manual demo, use separate terminals and data directories:

```powershell
.\run_node.ps1 -NodeId hq -Role central -Port 8000
.\run_node.ps1 -NodeId volunteer-b -Role volunteer -Port 8002 -CentralUrl http://127.0.0.1:8000
.\run_node.ps1 -NodeId survivor-a -Role survivor -Port 8001 -CentralUrl http://127.0.0.1:8000
```

In each browser tab, open **Node settings** and enter that node's admin key before manual sync actions. The volunteer's responder key enables private map/SOS views. A nearby node URL (for example `http://127.0.0.1:8002`) enables peer exchange. Groups use an ID and token shared privately with members. For ongoing retry, run the loop for each local API URL:

```powershell
.\.venv\Scripts\python.exe -m backend.scripts.sync_loop --url http://127.0.0.1:8001
```

On the central node the loop calls the Cloud mirror every 30 seconds; on other nodes it calls the central exchange. Start the loop separately for each URL as needed. You can also use the buttons in the volunteer and command views.

Automated checks:

```powershell
.\.venv\Scripts\python.exe -m pytest -q backend\tests
.\.venv\Scripts\python.exe backend\scripts\demo_flow.py
cd frontend
npm run build
npm run lint
```

`demo_flow.py` launches temporary survivor, volunteer, and central nodes. It checks the round trip **survivor → volunteer → command → volunteer → survivor**, public/group/SOS isolation, guide propagation, conflict resolution, provenance, and repeat-sync deduplication. The temporary central node in that demo is local; the Cloud test below verifies the real remote adapter.

To test your Cloud cluster with one **synthetic** public event and guide, then remove only those test records:

```powershell
.\.venv\Scripts\python.exe -m backend.scripts.cloud_smoke
```

The live smoke test was run successfully against a Qdrant Cloud cluster on 28 September 2026. The test left the four empty demo collections ready for use. It does not mean a Cloud connection will always be available during the disaster demo.

## Suggested live demo

1. Start survivor A, volunteer B, and command. Load each browser view. Disconnect internet while keeping the local LAN/hotspot alive.
2. Ask A about safe water; confirm the card comes from local Edge. Report “Gate 3 flooded” on A and verify it appears locally before syncing.
3. Exchange A with B. B sees one copy; repeat the exchange and confirm no duplicate marker. Inspect the A → B receipt.
4. Create a group report and an SOS. Confirm an unjoined/public node cannot see the group report or private SOS; a responder key reveals the SOS on B.
5. Reconnect B or A to command, sync centrally, then run command's Cloud exchange. Check the distinct public/group/responder Cloud collections through the Qdrant console.
6. At command, publish a reviewed guide and a verified Gate 3 update. Sync B with command and A with B. A should retrieve the new guide locally and show the checkpoint's full timeline.
7. Open Memory Ripple at command to inspect known hops. Turn internet off again and repeat an offline search.

## Important boundaries

- The four bundled medical cards are **source-based prototype content**, not a clinically approved manual. The generated 515-record draft on the `sonal` branch was not imported because it lacks per-record validation and contains inconsistencies. Review every card before real use; do not treat search results as diagnosis.
- Peer keys and HMAC guide authentication are suitable only for a controlled prototype. Production needs device identity, asymmetric publisher signatures, encrypted transport, responder authorization, abuse controls, and retention/consent audits.
- Public survivor presence is rounded to about a kilometer and expires after two hours. Exact coordinates remain within group or responder scope. Chat text is not copied into presence records.
- A browser UI on Android cannot execute `qdrant-edge-py` itself. Native Android embedding and Bluetooth/Wi-Fi Direct transport remain unimplemented.
- Cloud collections are not opened directly to web clients. The central FastAPI gateway enforces scopes; the Cloud API key must stay off local/Android nodes.

## References

[Qdrant Edge](https://qdrant.tech/documentation/edge/), [Edge BM25](https://qdrant.tech/documentation/edge/edge-bm25/), [Edge synchronization](https://qdrant.tech/documentation/edge/edge-synchronization-guide/), [Qdrant Cloud setup](https://qdrant.tech/documentation/cloud-quickstart/), [Red Cross first aid](https://www.redcross.org/take-a-class/resources/learn-first-aid), [CDC emergency water](https://www.cdc.gov/water-emergency/safety/index.html).
