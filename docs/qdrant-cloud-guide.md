# RescueMemory: Qdrant Cloud Architecture, Implementation & Audit Guide

This guide covers everything about **Qdrant Cloud** in RescueMemory: how it works, how to configure it from scratch, how to visualize and inspect it (Console UI, Web App, CLI), and the security/resilience audit findings and fixes applied.

---

## 1. High-Level Architecture: Why Qdrant Cloud?

RescueMemory uses a **Hierarchical Hybrid Vector Architecture**:

```
+-------------------------------------------------------------------------+
|                              SURVIVOR & FIRST RESPONDER DEVICES        |
|  - Phone / Tablet / Edge Node                                           |
|  - Runs in-process `qdrant-edge-py` directly on local flash storage      |
|  - 100% OFFLINE: Zero internet needed                                    |
|  - Embeds on-device using local FastEmbed mini-model                     |
+-------------------------------------------------------------------------+
                                   ▲
                                   │ Peer-to-Peer Wi-Fi / Mesh Sync
                                   ▼
+-------------------------------------------------------------------------+
|                              CENTRAL RELAY / BASE COMMAND NODE          |
|  - Central coordination laptop / field server (`NODE_ROLE=central`)     |
|  - Holds aggregated local edge memory                                  |
|  - Connects to internet when satellite / LTE link is available           |
|  - Contains central credentials: `QDRANT_URL` and `QDRANT_API_KEY`      |
+-------------------------------------------------------------------------+
                                   ▲
                                   │ HTTPS REST / gRPC Uplink
                                   ▼
+-------------------------------------------------------------------------+
|                              QDRANT CLOUD (Managed Cluster)             |
|  - Disaster Command HQ / Regional Vector Warehouse                      |
|  - Managed cluster on `cloud.qdrant.io`                                 |
|  - Cross-district disaster telemetry aggregation                        |
+-------------------------------------------------------------------------+
```

### Key Architectural Principles
1. **Survivors Never Connect Directly to Qdrant Cloud**:
   - In disaster zones, internet infrastructure is down or throttled.
   - Survivor devices run **`qdrant-edge-py`** embedded locally.
   - This prevents battery drain, network latency, and credential exposure.
2. **Central Node Acts as the Security & Authorization Boundary**:
   - Only a node designated with `NODE_ROLE=central` has outbound network access to Qdrant Cloud.
   - Requires `NODE_ADMIN_KEY` to trigger cloud uploads/downloads.
3. **Four Isolated Scoped Collections**:
   - Data is never dumped into one monolithic bucket. Separate collections isolate sensitive data:
     - `rescue_public_events`: Hazard alerts, public resources, open checkpoints.
     - `rescue_group_events`: Private family/camp coordinate beacons.
     - `rescue_responder_events`: Responder triage states, medical SOS records.
     - `rescue_approved_guides`: Authenticated, signed triage and medical procedures.

---

## 2. Step-by-Step Implementation Guide

Setting up Qdrant Cloud for RescueMemory takes less than 5 minutes.

### Step 2.1: Create a Free Qdrant Cloud Cluster
1. Visit [Qdrant Cloud](https://cloud.qdrant.io/) and create a free account (or log in).
2. Click **Create Cluster**.
3. Choose the **Free 1GB Cluster** (Permanent Free Tier, 0.5 vCPU, 1 GB RAM).
4. Select your preferred cloud provider and closest region (e.g. AWS Frankfurt, GCP US-East, etc.).
5. Give the cluster a name, e.g. `rescuememory-central`.
6. Click **Create Cluster**. Provisioning completes in ~60 seconds.

### Step 2.2: Obtain Cluster URL and API Key
1. Once the cluster is active:
   - Copy the **Cluster URL** (e.g. `https://xxx-yyy-zzz.us-east4-0.gcp.cloud.qdrant.io:6333`).
2. Navigate to the **Data Access Control / API Keys** tab on the left sidebar:
   - Click **Create API Key**.
   - Select Full Access (Read/Write) for this cluster.
   - Copy the generated API key.

### Step 2.3: Configure the Central Node
On your Central Command laptop / server:
1. Open the project's existing `.env`. For Render, use the service's existing **Environment Variables** instead. No separate `.env.central` file is required, and existing Render variables take precedence over local files.
2. Set the following environment variables:

```bash
# Node Role
NODE_ROLE=central
NODE_ID=central_HQ_delhi

# Local Edge & Admin Security
NODE_ADMIN_KEY=your-secure-command-admin-pass
MESH_SHARED_KEY=field-mesh-key-999
RESPONDER_SHARED_KEY=responder-medical-key-123
GUIDE_TRUST_KEY=signed-medical-bulletin-authority

# Qdrant Cloud Uplink Configuration
QDRANT_URL=https://xxx-yyy-zzz.us-east4-0.gcp.cloud.qdrant.io:6333
QDRANT_API_KEY=your_actual_qdrant_cloud_api_key_here
```

### Step 2.4: Launch the Central Node
Start the backend server on the central node:
```powershell
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```
The backend reads `QDRANT_URL` and `QDRANT_API_KEY` from the environment, including Render's service variables or the root `.env`. A legacy `.env.central` file is optional; you do not need to move your working settings into it.

If the inspector says **Offline: cloud counts cannot be verified**, enable **Online** in the app's top bar, then refresh the cloud records. This message means the app has disabled online requests; it does not establish that Render or your credentials failed. Deployment logs ending with **Application startup complete** and **Your service is live** show a successful startup. A first-start model-cache miss followed by a successful download is recoverable.

---

## 3. How to See & Verify Qdrant Cloud in Action

You can see and verify Qdrant Cloud working through **3 different methods**:

### Method 1: Web UI (Command Inspector)
1. Open `http://localhost:5173/command` (or `/central`) in your browser.
2. In the settings drawer, make sure your **Central Admin Key** is saved.
3. Scroll down to the **Qdrant Cloud Uplink** card:
   - **Click "Test Connection"**: This performs a live, non-destructive health probe (`GET /api/sync/cloud-status`). It instantly displays:
     - `Status: ONLINE`
     - Collection count and cluster URL.
   - **Click "Mirror to Cloud"**: Mirrors local verified observations and guides to Qdrant Cloud. A JSON receipt will display:
     ```json
     {
       "events_uploaded": { "public": 1, "group": 0, "responders": 0 },
       "events_downloaded": { "public": 0, "group": 0, "responders": 0 },
       "guides_uploaded": 1,
       "guides_downloaded": 0
     }
     ```

### Method 2: CLI Health Check & Smoke Test
RescueMemory includes two dedicated verification scripts in `backend/scripts/`:

1. **Lightweight Connection Check**:
   ```powershell
   python -m backend.scripts.check_cloud
   ```
   **Output:**
   ```text
   Connected to Qdrant Cloud; 4 collection(s) visible
   ```

2. **Full End-to-End Upload/Download Smoke Loop**:
   ```powershell
   python -m backend.scripts.cloud_smoke
   ```
   **What it does:**
   - Creates a synthetic test event and signed guide.
   - Uploads them to your Qdrant Cloud cluster.
   - Spawns a brand-new secondary node and pulls the records down from Cloud.
   - Verifies vector consistency and cleans up the synthetic record.
   - Prints: `PASS: public event and authenticated guide uploaded to Cloud and restored to fresh Edge`.

### Method 3: Qdrant Cloud Web Console
1. Log in to [cloud.qdrant.io](https://cloud.qdrant.io/).
2. Click on your cluster name and select **Collections**:
   - You will see the collections created automatically by RescueMemory:
     - `rescue_public_events`
     - `rescue_group_events`
     - `rescue_responder_events`
     - `rescue_approved_guides`
3. Click on any collection (e.g. `rescue_public_events`) -> **Points**:
   - See the points with their 384-dimensional dense vectors.
   - Click on any point to inspect the payload JSON:
     - `kind`: `"hazard"` | `"resource"` | `"incident"` | `"checkpoint"`
     - `text`: Observation details
     - `location`: Geo-coordinates `{ lat: ..., lon: ... }`
     - `content_hash`: Cryptographic SHA-256 hash for deduplication
     - `visibility`: `"public"`

---

## 4. Audit Findings & Gaps Fixed

During the comprehensive security and stability audit of `backend/app/cloud.py` and `backend/app/main.py`, four gaps were discovered and resolved:

### Gap 1: Null/Malformed Payload Crash Risk
- **Issue**: In `_cloud_payloads()`, if a point in Qdrant Cloud lacked a payload or was malformed, `point.payload.get("visibility")` raised an unhandled `AttributeError: 'NoneType' object has no attribute 'get'`.
- **Fix**: Added strict type checks `if not isinstance(point.payload, dict): continue` across all event and guide cloud sync loops.

### Gap 2: Offset-Naive vs Offset-Aware Datetime Comparison
- **Issue**: In `cloud.py`, `expiry = event.get("expires_at")` was parsed with `datetime.fromisoformat(expiry)`. If an incoming ISO string was timezone-naive (e.g. `"2026-09-30T12:00:00"`), comparing it with `datetime.now(timezone.utc)` caused Python to throw:
  `TypeError: can't compare offset-naive and offset-aware datetimes`.
- **Fix**: Normalised naive datetimes:
  ```python
  dt = datetime.fromisoformat(expiry)
  if dt.tzinfo is None:
      dt = dt.replace(tzinfo=timezone.utc)
  ```
  Also wrapped in `try...except (ValueError, TypeError)` so malformed expiry tags cannot abort sync.

### Gap 3: Raw HTTP 500 Unhandled Exceptions on Cloud Mirror
- **Issue**: If Qdrant Cloud was temporarily unreachable, DNS failed, or an invalid API key was supplied, `/api/sync/cloud-mirror` threw unhandled exceptions resulting in raw HTTP 500 stack traces.
- **Fix**: Wrapped mirror execution in `try...except` in `main.py`, returning clean `HTTP 502 Bad Gateway` with descriptive error messages or `HTTP 400 Bad Request` for configuration issues.

### Gap 4: Missing Read-Only Connection Ping & UI Status Check
- **Issue**: Operators had no way to verify cloud connectivity without triggering a full two-way vector mirror.
- **Fix**:
  1. Added `check_cloud_connection(service: RescueService) -> dict` in `backend/app/cloud.py`.
  2. Exposed `GET /api/sync/cloud-status` in `backend/app/main.py`.
  3. Added "Test Connection" button and live status badge to `CommandInspector.jsx`.
  4. Added automated test assertion in `backend/tests/test_roundtrip.py`.
