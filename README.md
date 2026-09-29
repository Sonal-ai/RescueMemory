# RescueMemory

**Offline disaster memory that moves between people and a central Qdrant Cloud memory.** Each local node runs the actual `qdrant-edge-py` library on disk. It can search and record observations without internet; any connected node can exchange permitted reports with a central gateway, which mirrors them to Qdrant Cloud. Approved guide updates move back to local nodes and can be relayed across a local hotspot.

The actual hackathon challenge is Qdrant's AI-powered edge memory and intelligence platform. The supplied PDFs and team chat informed the use case; they are not implementation requirements. [The implementation plan](docs/implementation-plan.md) describes the intended product and boundaries.

## What is implemented

- **Real Qdrant Edge:** Persistent reference, event, group, and receipt shards; offline MiniLM dense search plus Edge BM25 and reciprocal-rank fusion; no Docker or network call during local retrieval.
- **Negative Vector Safe Routing:** Vector arithmetic ($V_{safe} = V_{compromised\_shelter} - V_{flooded\_hazard}$) executed in Qdrant memory. When a checkpoint or shelter is compromised (e.g. entrance flooded or live wires), the engine automatically calculates and recommends an alternative safe facility.
- **Offline Wi-Fi Auto-Discovery (Zero-Conf Mesh):** Background UDP broadcast beacons running on the local subnet (port 8888). Devices on the same Wi-Fi or mobile hotspot automatically detect each other without needing internet or typing manual IP addresses.
- **Offline Satellite GPS & Location Sharing:** Operates 100% without internet. Hardware GPS acquires satellite lock offline via geometric trilateration; coordinates and device role/status are broadcasted over the local Wi-Fi beacon so nearby devices render real-time pins and distance vectors on the map.
- **Disaster reports:** Public hazards/resources, group reports, responder-only SOS, opt-in survivor presence, nearby geo filtering, immutable event IDs, duplicate rejection, and a checkpoint conflict timeline.
- **Local relay:** Bounded HTTP exchange over a reachable LAN/hotspot, authenticated by shared prototype keys; public/group/responder scopes; per-event transfer receipts for the Memory Ripple view.
- **Central loop:** Any connected survivor or volunteer can sync allowed data to the central API. The central API exchanges separate public, group, and responder collections plus approved guides with Qdrant Cloud. Cloud credentials stay on the central process.
- **Guide updates:** Command publishes a versioned, source-linked card. An HMAC authentication tag checked with `GUIDE_TRUST_KEY` prevents alteration in transit during the controlled demo. Nodes pull and relay signed cards.
- **Palak & Shivendra Unified Frontend:** High-contrast tactical HUD featuring responsive survivor view, nearby grid map with pulsing Wi-Fi mesh radar rings, volunteer board, group controls, and command/Memory Ripple inspector with live telemetry.
- **Offline question answering:** The compact local MiniLM embedding model and Edge BM25 retrieve evidence without internet. A short extractive answer and contextual action are built from matching local guides/reports. A mobility or rescue phrase prepares an SOS form for review; asking alone never creates a report.
- **Optional Gemini answer:** A server-side Gemini request can summarize a question and selected local guide/public-report evidence when online. Group and responder records are excluded. If the key or network is unavailable, the local answer remains.
- **Installable Offline PWA:** The frontend includes a Web App Manifest (`manifest.json`) and Service Worker (`sw.js`). Users can install it on Android/iOS via "Add to Home Screen" to load instantly even if the local hub disconnects.

---

## Technical Foundations: Offline Operations

### 1. How GPS Works Without Internet
A smartphone's hardware GPS chip is a purely passive radio listener. It receives atomic clock radio signals from 24–31 GPS/Galileo/GLONASS satellites ~20,000 km in space. By measuring the time-of-flight to $\ge 4$ satellites, the chip computes Latitude, Longitude, and Altitude with 3–5 meter accuracy via trilateration—**requiring zero cellular data or Wi-Fi**.

### 2. How Offline Wi-Fi LAN / Hotspot Works Without Internet
Wi-Fi is an ad-hoc local data transport. When one phone turns on a **Mobile Hotspot** (with mobile data turned **OFF**), it creates a Local Area Network (LAN). Connected devices can exchange high-speed HTTP, WebSockets, and UDP beacons completely offline.
- Every node broadcasts a `rescue_beacon` UDP packet every 3 seconds to the subnet broadcast address.
- Nearby survivor and responder nodes automatically discover each other and compute relative distance using the Haversine formula.
- No manual typing of peer IP addresses or ports is required.

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

For optional online answers, put `GEMINI_API_KEY` in the ignored local `.env` and keep `GEMINI_MODEL=gemini-3.8-flash` or another available model. Restart each node after changing its environment. The browser never receives the key. In the survivor Ask view, select **Add an AI answer when connected** to send the question and selected public evidence; local search and its extractive answer run either way. Google documents the [Gemini model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) and [API key header](https://ai.google.dev/api).

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

## Mobile PWA & Teammate Testing Guide

### Option 1: Mobile Browser PWA (Easiest & Fastest for Teammates)

1. **Start the Hub on Laptop with LAN access:**
   ```powershell
   .\run_node.ps1 -NodeId survivor-a -Role survivor -Port 8001 -Lan
   ```
2. **Connect Phone to Same Wi-Fi / Mobile Hotspot:**
   - Turn on Mobile Hotspot on one phone (mobile data can be turned **OFF** to prove total offline capability).
   - Connect the laptop and other phones to this hotspot.
3. **Find Laptop IP:**
   - Run `ipconfig` on the laptop (look for IPv4, e.g., `192.168.43.50`).
4. **Open in Mobile Browser:**
   - On the phone, open Chrome or Safari and navigate to:
     `http://192.168.43.50:8001/`
5. **Install PWA (Zero-Download Web APK):**
   - In Chrome: Tap the three dots `⋮` → **"Add to Home screen"** or **"Install app"**.
   - In Safari (iOS): Tap the Share button → **"Add to Home Screen"**.
   - The app installs as a standalone app with the official RescueMemory icon.
6. **Test Offline Wi-Fi Mesh Radar:**
   - Tap **"GPS"** on the map to acquire coordinates.
   - Any second phone or laptop on the same hotspot will immediately pop up in the **Wi-Fi Mesh Radar** card with real-time distance in meters!
   - Tap **"Sync"** to exchange reports with 1 click without typing IP addresses.

---

### Option 2: Running Node Directly on Android (via Termux)

For total laptop independence where the phone itself acts as the edge node:

1. Install **Termux** from [F-Droid](https://f-droid.org/en/packages/com.termux/).
2. Run in Termux:
   ```bash
   pkg update && pkg install python git build-essential clang
   git clone https://github.com/Sonal-ai/RescueMemory.git
   cd RescueMemory
   pip install -r requirements.txt
   python backend/scripts/provision_model.py
   python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
   ```
3. Open `http://localhost:8000` in the phone's browser. The entire edge AI memory and UDP discovery beacon now runs natively on Android.

---

## Suggested live demo

1. Start survivor A, volunteer B, and command. Load each browser view. Disconnect internet while keeping the local LAN/hotspot alive.
2. Ask A about safe water; confirm the card comes from local Edge. Report “Gate 3 flooded” on A and verify it appears locally before syncing.
3. Exchange A with B. B sees one copy; repeat the exchange and confirm no duplicate marker. Inspect the A → B receipt.
4. Test negative vector rerouting: Report a hazard on `cp_17` (e.g. entrance flooded with live wires) and verify that Qdrant automatically computes $V_{safe} = V_{shelter} - V_{hazard}$ and recommends an alternative safe facility.
5. Check the **Wi-Fi Mesh Radar**: See both nodes dynamically plotted on the offline coordinate map with live distance without manual IP entry.
6. Create a group report and an SOS. Confirm an unjoined/public node cannot see the group report or private SOS; a responder key reveals the SOS on B.
7. Reconnect B or A to command, sync centrally, then run command's Cloud exchange. Check the distinct public/group/responder Cloud collections through the Qdrant console.
8. At command, publish a reviewed guide and a verified Gate 3 update. Sync B with command and A with B. A should retrieve the new guide locally and show the checkpoint's full timeline.
9. Open Memory Ripple at command to inspect known hops. Turn internet off again and repeat an offline search.
10. In the survivor Ask view, type “I can't walk.” Check the offline answer and select **Review a responder SOS**. Review the text and selected location before saving. In the Nearby view, check the local people count and its 30-second refresh. Switch between light and dark mode in the header.

## Important boundaries

- The four bundled medical cards are **source-based prototype content**, not a clinically approved manual. The generated 515-record draft on the `sonal` branch was not imported because it lacks per-record validation and contains inconsistencies. Review every card before real use; do not treat search results as diagnosis.
- Peer keys and HMAC guide authentication are suitable only for a controlled prototype. Production needs device identity, asymmetric publisher signatures, encrypted transport, responder authorization, abuse controls, and retention/consent audits.
- Public survivor presence is rounded to about a kilometer and expires after two hours. Exact coordinates remain within group or responder scope. Chat text is not copied into presence records.
- A browser UI on Android cannot execute `qdrant-edge-py` itself. Native Android embedding and Bluetooth/Wi-Fi Direct transport remain unimplemented.
- Cloud collections are not opened directly to web clients. The central FastAPI gateway enforces scopes; the Cloud API key must stay off local/Android nodes.
- Gemini generation is optional and may be temporarily unavailable due to provider capacity or connectivity. The API key's authentication was checked, but an initial live generation request received HTTP 503. The app shows its local answer and sources in that case. AI text is a summary of retrieved evidence, not an emergency dispatch or medical diagnosis.

## References

[Qdrant Edge](https://qdrant.tech/documentation/edge/), [Edge BM25](https://qdrant.tech/documentation/edge/edge-bm25/), [Edge synchronization](https://qdrant.tech/documentation/edge/edge-synchronization-guide/), [Qdrant Cloud setup](https://qdrant.tech/documentation/cloud-quickstart/), [Red Cross first aid](https://www.redcross.org/take-a-class/resources/learn-first-aid), [CDC emergency water](https://www.cdc.gov/water-emergency/safety/index.html).
