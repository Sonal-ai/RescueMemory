from __future__ import annotations

import hmac
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .cloud import mirror_to_qdrant_server
from .config import Settings
from .discovery import PeerDiscovery
from .schemas import (AssessRequest, ChatRequest, CreateGroupRequest, DeviceLocationUpdate,
                      DiscoverySyncRequest, GuidePublishRequest, JoinGroupRequest,
                      NearbyRequest, PeerSyncRequest, RecommendAlternativeRequest, ReportRequest,
                      SurvivalRadarRequest)
from .service import RescueService
from .sync import authorize, sync_with_peer, uplink_sos


class ImportBatch(BaseModel):
    events: list[dict] = Field(max_length=128)
    sender_node_id: str | None = None


class ImportGuides(BaseModel):
    guides: list[dict] = Field(max_length=64)


class ImportReceipts(BaseModel):
    receipts: list[dict] = Field(max_length=128)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.rescue = RescueService(settings)
        disc = PeerDiscovery(
            node_id=settings.node_id,
            role=settings.role,
            broadcast_port=settings.discovery_port,
        )
        app.state.discovery = disc
        if settings.enable_discovery:
            disc.start()
        yield
        if settings.enable_discovery:
            disc.stop()
        app.state.rescue.close()

    app = FastAPI(title="RescueMemory Edge API", version="0.1.0", lifespan=lifespan)

    def service() -> RescueService:
        return app.state.rescue

    def require_admin(x_node_admin_key: str | None = Header(default=None)):
        if not settings.node_admin_key:
            raise HTTPException(503, "NODE_ADMIN_KEY must be configured")
        if not x_node_admin_key or not hmac.compare_digest(x_node_admin_key, settings.node_admin_key):
            raise HTTPException(403, "node admin key required")

    def valid_group_token(s: RescueService, group_id: str | None, token: str | None) -> bool:
        return bool(group_id and token and hmac.compare_digest(token, s.group_token(group_id)))

    def valid_responder_token(token: str | None) -> bool:
        return bool(settings.role != "survivor" and settings.responder_key and token
                    and hmac.compare_digest(token, settings.responder_key))

    @app.get("/health")
    def health(s: RescueService = Depends(service)):
        return {"status": "ok", "node_id": settings.node_id, "role": settings.role,
                "engine": "qdrant-edge-py", "offline_model": True,
                "events": getattr(s, "events_count", 0),
                "guides": getattr(s, "guides_count", 420),
                "guides_enabled": bool(settings.guide_trust_key),
                "gemini_configured": bool(settings.gemini_api_key),
                "central_configured": bool(settings.central_url),
                "cloud_configured": bool(settings.qdrant_url),
                "discovery_enabled": settings.enable_discovery,
                "discovery_port": settings.discovery_port}

    @app.post("/api/chat")
    def chat(request: ChatRequest, x_group_token: str | None = Header(default=None),
             s: RescueService = Depends(service)):
        if request.group_id and not valid_group_token(s, request.group_id, x_group_token):
            raise HTTPException(403, "group token required")
        return s.chat(request)

    @app.post("/api/assess")
    def assess_casualty(request: AssessRequest, s: RescueService = Depends(service)):
        return s.assess(request)


    @app.post("/api/reports")
    def report(request: ReportRequest, x_group_token: str | None = Header(default=None),
               x_node_admin_key: str | None = Header(default=None),
               s: RescueService = Depends(service)):
        if request.group_id and not valid_group_token(s, request.group_id, x_group_token):
            raise HTTPException(403, "group token required")
        if request.verified:
            require_admin(x_node_admin_key)
        return s.report(request)

    @app.get("/api/guides")
    def guides(s: RescueService = Depends(service)):
        return {"guides": list(s.memory.all("reference"))}

    @app.post("/api/guides/publish")
    def publish_guide(request: GuidePublishRequest, s: RescueService = Depends(service),
                      _admin: None = Depends(require_admin)):
        return s.publish_guide(request)

    @app.post("/api/map/nearby")
    def nearby(request: NearbyRequest,
               x_group_token: str | None = Header(default=None),
               x_responder_key: str | None = Header(default=None),
               s: RescueService = Depends(service)):
        if request.group_id:
            if not valid_group_token(s, request.group_id, x_group_token):
                raise HTTPException(403, "group token required")
        if request.include_responders:
            if not valid_responder_token(x_responder_key):
                raise HTTPException(403, "responder key required")
        return {"items": s.nearby(request)}

    @app.post("/api/survival-finder/radar")
    def survival_radar_endpoint(
        request: SurvivalRadarRequest,
        x_group_token: str | None = Header(default=None),
        x_responder_key: str | None = Header(default=None),
        s: RescueService = Depends(service),
    ):
        if request.group_id and not valid_group_token(s, request.group_id, x_group_token):
            raise HTTPException(403, "group token required")
        if request.include_responders and not valid_responder_token(x_responder_key):
            request.include_responders = False
        disc: PeerDiscovery | None = getattr(app.state, "discovery", None)
        peers = disc.get_peers() if disc else []
        return s.survival_radar(request, peers=peers)

    @app.get("/api/survival-finder/radar")
    def survival_radar_get(
        lat: float = Query(default=28.7041),
        lon: float = Query(default=77.1025),
        radius_m: float = Query(default=3500.0, ge=50.0, le=50000.0),
        filter_category: str = Query(default="all"),
        group_id: str | None = Query(default=None),
        include_responders: bool = Query(default=True),
        x_group_token: str | None = Header(default=None),
        x_responder_key: str | None = Header(default=None),
        s: RescueService = Depends(service),
    ):
        if group_id and not valid_group_token(s, group_id, x_group_token):
            raise HTTPException(403, "group token required")
        if include_responders and not valid_responder_token(x_responder_key):
            include_responders = False
        disc: PeerDiscovery | None = getattr(app.state, "discovery", None)
        peers = disc.get_peers() if disc else []
        req = SurvivalRadarRequest(
            lat=lat,
            lon=lon,
            radius_m=radius_m,
            filter_category=filter_category,
            group_id=group_id,
            include_responders=include_responders,
        )
        return s.survival_radar(req, peers=peers)

    @app.get("/api/entities/{entity_id}")
    def entity(entity_id: str, group_id: str | None = None,
               x_group_token: str | None = Header(default=None),
               x_responder_key: str | None = Header(default=None),
               s: RescueService = Depends(service)):
        if group_id and not valid_group_token(s, group_id, x_group_token):
            raise HTTPException(403, "group token required")
        responder = valid_responder_token(x_responder_key)
        return s.entity_timeline(entity_id, group_id, responder)

    @app.post("/api/checkpoints/recommend-alternative")
    def recommend_alternative(request: RecommendAlternativeRequest, s: RescueService = Depends(service)):
        return s.recommend_alternative_checkpoint(request.compromised_id, request.avoid_hazard)

    @app.get("/api/provenance/{event_id}")
    def provenance(event_id: str, group_id: str | None = None,
                   x_group_token: str | None = Header(default=None),
                   x_responder_key: str | None = Header(default=None),
                   s: RescueService = Depends(service)):
        if group_id and not valid_group_token(s, group_id, x_group_token):
            raise HTTPException(403, "group token required")
        return s.provenance(event_id, group_id, valid_responder_token(x_responder_key))

    @app.post("/api/groups")
    def create_group(request: CreateGroupRequest, s: RescueService = Depends(service)):
        return s.create_group(request)

    @app.post("/api/groups/join")
    def join_group(request: JoinGroupRequest, s: RescueService = Depends(service)):
        return s.join_group(request)

    @app.get("/api/groups")
    def groups(s: RescueService = Depends(service)):
        return {"groups": s.groups()}

    @app.get("/api/sync/status")
    def sync_status(s: RescueService = Depends(service)):
        return s.sync_status()

    @app.get("/api/memory")
    def inspect_memory(scope: str = "reference", group_id: str | None = None,
                       page: int = Query(default=0, ge=0), limit: int = Query(default=50, ge=1, le=100),
                       x_group_token: str | None = Header(default=None),
                       x_responder_key: str | None = Header(default=None),
                       s: RescueService = Depends(service)):
        if scope == "reference":
            items = list(s.memory.all("reference"))
        elif scope == "group":
            if not valid_group_token(s, group_id, x_group_token):
                raise HTTPException(403, "group token required")
            items = s.scoped_events("group", group_id)
        elif scope == "responders":
            if not valid_responder_token(x_responder_key):
                raise HTTPException(403, "responder key required")
            items = s.scoped_events("responders")
        elif scope == "public":
            items = s.scoped_events("public")
        else:
            raise HTTPException(422, "invalid scope")
        items.sort(key=lambda item: item["id"])
        start = page * limit
        return {"items": items[start:start + limit], "total": len(items),
                "has_more": start + limit < len(items)}

    def check(scope: str, group_id: str | None, x_mesh_key: str | None,
              x_group_token: str | None, x_responder_key: str | None,
              s: RescueService):
        authorize(s, scope, x_mesh_key, x_group_token, x_responder_key, group_id)

    @app.get("/api/sync/export")
    def export(scope: str = "public", group_id: str | None = None,
               page: int = Query(default=0, ge=0), limit: int = Query(default=64, ge=1, le=128),
               x_mesh_key: str | None = Header(default=None),
               x_group_token: str | None = Header(default=None),
               x_responder_key: str | None = Header(default=None),
               s: RescueService = Depends(service)):
        check(scope, group_id, x_mesh_key, x_group_token, x_responder_key, s)
        records = sorted(s.scoped_events(scope, group_id), key=lambda e: e["id"])
        start = page * limit
        return {"events": records[start:start + limit], "has_more": start + limit < len(records),
                "node_id": settings.node_id}

    @app.post("/api/sync/import")
    def import_batch(batch: ImportBatch, scope: str = "public", group_id: str | None = None,
                     x_mesh_key: str | None = Header(default=None),
                     x_group_token: str | None = Header(default=None),
                     x_responder_key: str | None = Header(default=None),
                     s: RescueService = Depends(service)):
        check(scope, group_id, x_mesh_key, x_group_token, x_responder_key, s)
        for event in batch.events:
            if event.get("visibility") != scope or (scope == "group" and event.get("group_id") != group_id):
                raise HTTPException(403, "event outside authorized scope")
        return {**s.import_events(batch.events), "node_id": settings.node_id}

    @app.get("/api/sync/guides/export")
    def guide_export(x_mesh_key: str | None = Header(default=None),
                     s: RescueService = Depends(service)):
        authorize(s, "public", x_mesh_key, None, None, None)
        return {"guides": s.signed_guides(), "node_id": settings.node_id}

    @app.post("/api/sync/guides/import")
    def guide_import(batch: ImportGuides, x_mesh_key: str | None = Header(default=None),
                     s: RescueService = Depends(service)):
        authorize(s, "public", x_mesh_key, None, None, None)
        return s.import_guides(batch.guides)

    @app.get("/api/sync/receipts/export")
    def receipt_export(scope: str = "public", group_id: str | None = None,
                       x_mesh_key: str | None = Header(default=None),
                       x_group_token: str | None = Header(default=None),
                       x_responder_key: str | None = Header(default=None),
                       s: RescueService = Depends(service)):
        check(scope, group_id, x_mesh_key, x_group_token, x_responder_key, s)
        return {"receipts": s.transfer_receipts(scope, group_id)}

    @app.post("/api/sync/receipts/import")
    def receipt_import(batch: ImportReceipts, scope: str = "public", group_id: str | None = None,
                       x_mesh_key: str | None = Header(default=None),
                       x_group_token: str | None = Header(default=None),
                       x_responder_key: str | None = Header(default=None),
                       s: RescueService = Depends(service)):
        check(scope, group_id, x_mesh_key, x_group_token, x_responder_key, s)
        return s.import_receipts(batch.receipts, scope, group_id)

    @app.post("/api/sync/sos-intake")
    def sos_intake(batch: ImportBatch, x_mesh_key: str | None = Header(default=None),
                   s: RescueService = Depends(service)):
        if settings.role not in {"volunteer", "central"}:
            raise HTTPException(403, "SOS intake requires a responder node")
        authorize(s, "public", x_mesh_key, None, None, None)
        if any(e.get("visibility") != "responders" for e in batch.events):
            raise HTTPException(403, "only responder-scoped SOS events accepted")
        outcome = s.import_events(batch.events)
        if batch.sender_node_id:
            for event_id in outcome["imported_ids"]:
                s.record_transfer(event_id, batch.sender_node_id, settings.node_id)
        return {**outcome, "node_id": settings.node_id}

    @app.post("/api/sync/group-register")
    def group_register(request: JoinGroupRequest,
                       x_mesh_key: str | None = Header(default=None),
                       s: RescueService = Depends(service)):
        if settings.role != "central":
            raise HTTPException(403, "central node only")
        authorize(s, "public", x_mesh_key, None, None, None)
        return s.join_group(request)

    @app.post("/api/sync/sos-uplink")
    def sos_uplink(request: PeerSyncRequest, s: RescueService = Depends(service),
                   _admin: None = Depends(require_admin)):
        return uplink_sos(s, request.peer_url)

    @app.post("/api/sync/peer")
    def peer(request: PeerSyncRequest, s: RescueService = Depends(service),
             _admin: None = Depends(require_admin)):
        scope = "group" if request.group_id else ("responders" if request.responder else "public")
        return sync_with_peer(s, request.peer_url, scope, request.group_id)

    @app.post("/api/sync/global")
    def global_sync(s: RescueService = Depends(service), _admin: None = Depends(require_admin)):
        if not settings.central_url or settings.role == "central":
            raise HTTPException(400, "CENTRAL_URL required on a non-central node")
        results = [sync_with_peer(s, settings.central_url, "public")]
        if settings.role == "survivor":
            results.append(uplink_sos(s, settings.central_url))
        if settings.role == "volunteer" and settings.responder_key:
            results.append(sync_with_peer(s, settings.central_url, "responders"))
        # Group-scoped records sync only to a central node joined to that group.
        for group in s.groups():
            results.append(sync_with_peer(s, settings.central_url, "group", group["group_id"], register_group=True))
        return {"results": results}

    @app.post("/api/sync/cloud-mirror")
    def cloud_mirror(s: RescueService = Depends(service), _admin: None = Depends(require_admin)):
        if settings.role != "central":
            raise HTTPException(403, "central node only")
        if not settings.qdrant_url:
            raise HTTPException(400, "QDRANT_URL required")
        return mirror_to_qdrant_server(s)

    @app.get("/api/discovery/peers")
    def get_discovered_peers():
        disc: PeerDiscovery | None = getattr(app.state, "discovery", None)
        if not disc:
            return {"peers": [], "count": 0, "enabled": False, "node_id": settings.node_id}
        peers = disc.get_peers()
        return {
            "peers": peers,
            "count": len(peers),
            "enabled": settings.enable_discovery,
            "node_id": settings.node_id,
            "role": settings.role,
            "my_location": disc.get_my_location(),
        }

    @app.post("/api/discovery/location")
    def update_discovery_location(data: DeviceLocationUpdate):
        disc: PeerDiscovery | None = getattr(app.state, "discovery", None)
        if not disc:
            return {"updated": False, "reason": "discovery_not_initialized"}
        updated = disc.update_location(
            lat=data.lat,
            lon=data.lon,
            status=data.status,
            battery=data.battery,
        )
        return {"updated": True, "location": updated}

    @app.post("/api/discovery/sync-peer")
    def sync_discovered_peer(req: DiscoverySyncRequest,
                             x_node_admin_key: str | None = Header(default=None),
                             s: RescueService = Depends(service)):
        if req.scope == "responders" and settings.role != "survivor":
            if not settings.node_admin_key or not x_node_admin_key or not hmac.compare_digest(x_node_admin_key, settings.node_admin_key):
                raise HTTPException(403, "node admin key required for responder sync")
        if req.scope == "responders" and settings.role == "survivor":
            return uplink_sos(s, req.peer_url)
        return sync_with_peer(s, req.peer_url, req.scope, req.group_id)

    frontend = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if (frontend / "index.html").exists():
        @app.get("/", include_in_schema=False)
        @app.get("/crisis", include_in_schema=False)
        @app.get("/volunteer", include_in_schema=False)
        @app.get("/command", include_in_schema=False)
        def frontend_page():
            return FileResponse(frontend / "index.html")

        app.mount("/", StaticFiles(directory=frontend), name="frontend")

    return app


app = create_app()
