# RescueMemory: Cloud Deployment Guide (Zero Docker — Render & Vercel)

This guide explains how to deploy **RescueMemory** to public URLs for judges and mentors on both **Web** and **Android APK** using native cloud platforms without Docker.

---

## Architecture

```
                     +---------------------------------------+
                     |            HACKATHON JUDGES           |
                     |  - Open public URL in Web Browser     |
                     |  - OR open Android APK on phone       |
                     +---------------------------------------+
                                         │
                    ┌────────────────────┴────────────────────┐
                    ▼ HTTPS                                   ▼ HTTPS
+---------------------------------------+   +---------------------------------------+
|          VERCEL (Frontend SPA)        |   |       RENDER (Native Python FastAPI)  |
|  - Root: /frontend                    |   |  - Role: Central Command HQ           |
|  - Build: npm run build (dist)        |   |  - Uvicorn on 0.0.0.0:$PORT           |
+---------------------------------------+   +---------------------------------------+
                                                              │
                                                              ▼ TLS REST / gRPC
                                            +---------------------------------------+
                                            |      QDRANT CLOUD (AWS EU-West-2)     |
                                            |  - 4 Scoped Disaster Collections      |
                                            |  - 384-dimensional Vector Search     |
                                            +---------------------------------------+
```

---

## 1. Backend: Deploy on Render.com (Native Python)

Render deploys directly from GitHub as a free Native Python Web Service with **zero Docker**:

1. Go to [render.com](https://render.com/) and sign in with GitHub.
2. Click **New +** $\rightarrow$ select **Web Service**.
3. Select your repository: `Sonal-ai/RescueMemory`.
4. Configure service:
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT`
   - **Plan**: Free
5. Under **Environment Variables**, add:
   - `NODE_ROLE` = `central`
   - `NODE_ID` = `central-hq`
   - `NODE_ADMIN_KEY` = `rescue-admin-key-2026`
   - `GUIDE_TRUST_KEY` = `rescue-guide-trust-key-2026`
   - `MESH_SHARED_KEY` = `rescue-mesh-shared-key-2026`
   - `RESPONDER_SHARED_KEY` = `rescue-responder-shared-key-2026`
   - `QDRANT_URL` = `https://7b3cb247-fa8e-4344-841e-190094e210f6.eu-west-2-0.aws.cloud.qdrant.io`
   - `QDRANT_API_KEY` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MiOiJtIiwic3ViamVjdCI6ImFwaS1rZXk6NDYyYjk1NTUtODMxYS00ZWQ5LTliYTItZDMwYjJiOTg4YzNhIn0.rCrI3kO--zNQbP5QlKmKst9l9aR7r3sXYf6M4y4oyeM`
6. Click **Create Web Service**. Render gives you a public backend URL (e.g. `https://rescuememory-backend.onrender.com`).

---

## 2. Frontend: Deploy on Vercel (Native Vite SPA)

1. Go to [vercel.com](https://vercel.com/) and import `Sonal-ai/RescueMemory`.
2. Configure project:
   - **Root Directory**: `frontend`
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
3. Click **Deploy**. Vercel gives you an instant global HTTPS URL (e.g. `https://rescuememory.vercel.app`).

---

## 3. How Judges Test It

### In Any Browser
- **Survivor Emergency HUD**: `https://rescuememory.vercel.app/`
- **Command HQ & Qdrant Cloud Mirror**: `https://rescuememory.vercel.app/command`
- **Volunteer Responder Board**: `https://rescuememory.vercel.app/volunteer`
- **Survival Radar & Compass**: `https://rescuememory.vercel.app/radar`

### In Android APK
1. Install APK on phone:
   `frontend/android/app/build/outputs/apk/debug/app-debug.apk`
2. Open **Settings** (⚙️) $\rightarrow$ enter your Render backend URL in **Backend Hub URL**.
3. Now the APK communicates directly with your live Central Cloud backend!
