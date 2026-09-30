# RescueMemory Web Interface (PWA)

> **React 19 + Vite + Tailwind CSS + Lucide Icons**  
> **Integrated PWA Frontend for RescueMemory Edge API**

The RescueMemory frontend is a responsive, installable Progressive Web Application (PWA) designed for high-contrast visibility and offline resilience during natural disaster operations.

---

## 1. Core Views & Architecture

The user interface is role-tailored to three distinct operational personas:

### 1. `SurvivorHUD.jsx` (`/`, `/crisis`, `/chat`)
- **1-Tap Emergency SOS**: Immediate priority broadcast for life-threatening emergencies or mobility limitations.
- **Offline RAG Guidance**: Extractive semantic cards retrieved via local Qdrant Edge hybrid search with source citations (`G1`, `G2`, etc.).
- **Interactive Triage Input**: Gathers casualty vitals (breathing status, arterial bleeding, available field items) to trigger resource-adaptive protocol reranking.
- **Tactical Coordinate Pin**: Automatic browser geolocation with an instant manual pin-drop fallback when satellite GPS context is unavailable.
- **Alternative Facility Cards**: Renders candidate safe shelters calculated via Qdrant vector arithmetic when primary checkpoints are blocked.

### 2. `SurvivalRadar.jsx` / `UnifiedRadarMap.jsx` (`/radar`, `/find`)
- **360° Cardinal Compass**: Computes real-time forward bearing ($0^\circ - 360^\circ$) and cardinal direction (e.g. `NNE`, `SSW`) to nearby resources and casualties.
- **Concentric Triage Rings**: Visualizes immediate proximity using Haversine distance calculations and walking time estimates (75 m/min).
- **Multi-Source Fusion**: Aggregates dynamic local events from Qdrant Edge, static reference shelters, and nearby nodes discovered via UDP broadcast beacons.

### 3. `VolunteerBoard.jsx` (`/volunteer`)
- **Tactical Nearby Feed**: Color-coded casualty and hazard alerts (Red = Immediate, Yellow = Delayed, Green = Operational Resource).
- **1-Tap Peer Sync Scanner**: Triggers local Wi-Fi / Hotspot peer exchange (`POST /api/sync/peer`) and asymmetric SOS intake (`POST /api/sync/sos-intake`).
- **Transfer Receipt Telemetry**: Shows live counts of imported, exported, and deduplicated records.

### 4. `CommandInspector.jsx` (`/command`, `/hq`)
- **Memory Ripple Visualizer**: Interactive hop-by-hop provenance tracer showing how a disaster observation traveled from survivor to volunteer to central command.
- **Contradiction Resolution Timeline**: Chronological observation viewer showing hazard reports, baseline states, and active danger overrides.
- **Authoritative Guide Publisher**: Issues new versioned protocols signed with an HMAC-SHA256 authority tag (`GUIDE_TRUST_KEY`).
- **Qdrant Cloud Mirroring Dashboard**: Live connection health monitor (`GET /api/sync/cloud-status`) and manual/automated vector mirroring trigger across 4 scoped cloud collections.

---

## 2. Technical Stack & Offline Features

- **Framework**: React 19 with Vite bundler.
- **Styling**: Tailwind CSS with custom semantic theme variables (`--background`, `--card`, `--border`, `--foreground`, `--primary`).
- **Offline Service Worker (`sw.js`)**: Caches application shell, HTML, scripts, and tactical icon assets so the interface loads instantly even if the local server process restarts.
- **Web App Manifest (`manifest.json`)**: Configured for mobile "Add to Home Screen" installation across Android and iOS devices.
- **Icons**: Lucide React.

---

## 3. Build & Development

From the `frontend/` directory:

```bash
# Install dependencies
npm ci

# Start local Vite development server (port 5173)
npm run dev

# Compile production bundle to frontend/dist/
npm run build

# Run linter
npm run lint
```

When running in production, the FastAPI backend automatically serves `frontend/dist/` at the root path (`/`) on the same host and port.
