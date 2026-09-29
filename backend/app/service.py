from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
from datetime import datetime, timedelta, timezone
import math
from math import asin, cos, radians, sin, sqrt
from pathlib import Path

from fastapi import HTTPException
from pydantic import BaseModel, Field
from qdrant_edge import FieldCondition, Filter, MatchValue

from .config import Settings
from .discovery import calculate_bearing, calculate_cardinal
from .gemini import grounded_answer
from .memory import Memory
from .schemas import (AssessRequest, ChatRequest, CreateGroupRequest, GuidePublishRequest,
                      JoinGroupRequest, Location, NearbyRequest, ReportRequest, SurvivalRadarRequest)



def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def canonical(value: dict) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


STOP_WORDS = {"a", "an", "and", "are", "can", "do", "for", "from", "how", "i", "in",
              "is", "me", "my", "near", "of", "on", "the", "there", "to", "what", "where"}


def query_terms(text: str) -> set[str]:
    return {word for word in re.findall(r"[a-z]{3,}", text.lower()) if word not in STOP_WORDS}


def card_terms(card: dict) -> set[str]:
    return query_terms(" ".join(str(card.get(field, ""))
                                for field in ("title", "keywords", "summary")))


from .offline_rag import clinical_assess, resource_adaptive_rerank, synthesize_offline_rag


def local_response(
    question: str,
    cards: list[dict],
    reports: list[dict],
    materials: list[str] | None = None,
    breathing: bool | None = None,
    bleeding_type: str | None = None,
) -> tuple[str, dict | None]:
    return synthesize_offline_rag(question, cards, reports, materials, breathing, bleeding_type)



class Event(BaseModel):
    id: str = Field(min_length=64, max_length=64)
    content_hash: str = Field(min_length=64, max_length=64)
    origin_device: str = Field(min_length=1, max_length=100)
    kind: str
    text: str = Field(min_length=1, max_length=2000)
    reporter_id: str = Field(min_length=1, max_length=100)
    location: Location | None = None
    visibility: str
    group_id: str | None = None
    entity_id: str | None = None
    status: str | None = None
    severity: str = "yellow"
    observed_at: datetime
    expires_at: datetime | None = None
    source_role: str | None = None
    verified: bool = False
    supersedes_id: str | None = None
    authority_tag: str | None = None

    def body(self) -> dict:
        return self.model_dump(mode="json", exclude={"id", "content_hash"}, exclude_unset=True)


class RescueService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.memory = Memory(settings.data_dir, settings.model_cache)
        with open(Path(__file__).resolve().parent.parent / "data" / "knowledge.json", encoding="utf-8") as stream:
            self.memory.seed(json.load(stream))

    def close(self):
        self.memory.close()

    def create_group(self, request: CreateGroupRequest) -> dict:
        group_id = secrets.token_hex(8)
        token = secrets.token_urlsafe(32)
        self.join_group(JoinGroupRequest(group_id=group_id, name=request.name, token=token))
        return {"group_id": group_id, "name": request.name, "token": token}

    def join_group(self, request: JoinGroupRequest) -> dict:
        current = self.memory.get("groups", request.group_id)
        token_hash = hashlib.sha256(request.token.encode()).hexdigest()
        if current and not hmac.compare_digest(current["token_hash"], token_hash):
            raise HTTPException(409, "group ID already exists with another token")
        payload = {"group_id": request.group_id, "name": request.name,
                   "token_hash": token_hash, "token": request.token}
        self.memory.upsert("groups", request.group_id, payload, request.name)
        return {"group_id": request.group_id, "name": request.name}

    def groups(self) -> list[dict]:
        return [{"group_id": g["group_id"], "name": g["name"]} for g in self.memory.all("groups")]

    def group_token(self, group_id: str) -> str:
        group = self.memory.get("groups", group_id)
        if not group:
            raise HTTPException(404, "group not joined on this node")
        return group["token"]

    def _event(self, body: dict, idempotency_key: str | None = None) -> dict:
        body["origin_device"] = self.settings.node_id
        body["source_role"] = self.settings.role
        if body.get("verified"):
            if self.settings.role != "central" or not self.settings.guide_trust_key:
                raise HTTPException(403, "verified command reports require the guide trust key")
            body["authority_tag"] = hmac.new(
                self.settings.guide_trust_key.encode(), canonical(body), hashlib.sha256
            ).hexdigest()
        normalized = Event(id="0" * 64, content_hash="0" * 64, **body).body()
        body = normalized
        event_hash = hashlib.sha256(canonical(body)).hexdigest()
        if idempotency_key:
            event_id = hashlib.sha256(f"{self.settings.node_id}:{idempotency_key}".encode()).hexdigest()
        else:
            # Same report by the same reporter in the same minute is one event.
            dedup = {k: v for k, v in body.items() if k not in ("observed_at", "expires_at")}
            minute = body["observed_at"][:16]
            event_id = hashlib.sha256(canonical(dedup) + minute.encode()).hexdigest()
        event = Event(id=event_id, content_hash=event_hash, **body).model_dump(mode="json", exclude_unset=True)
        existing = self.memory.get("events", event_id)
        if existing:
            if idempotency_key and existing["content_hash"] != event_hash:
                raise HTTPException(409, "idempotency key reused with different report")
            return {"event": existing, "duplicate": True}
        self.memory.upsert("events", event_id, event, body["text"])
        return {"event": event, "duplicate": False}

    def report(self, request: ReportRequest) -> dict:
        visibility = request.visibility or ("group" if request.group_id else
                                            "responders" if request.kind == "incident" else "public")
        if request.kind == "incident" and visibility == "public":
            raise HTTPException(422, "medical incidents cannot be public")
        if request.verified and self.settings.role != "central":
            raise HTTPException(403, "only command may verify a report")
        if visibility == "group":
            if not request.group_id:
                raise HTTPException(422, "group_id required for group visibility")
            self.group_token(request.group_id)
        if request.observed_at > utc_now() + timedelta(minutes=5):
            raise HTTPException(422, "observation is too far in the future")
        body = request.model_dump(mode="json", exclude={"idempotency_key"})
        body["visibility"] = visibility
        body["expires_at"] = None
        return self._event(body, request.idempotency_key)

    def chat(self, request: ChatRequest) -> dict:
        self.purge_expired()
        visibility = request.visibility or ("group" if request.group_id else "responders")
        if request.share_location:
            if not request.location or not request.survivor_id:
                raise HTTPException(422, "location and survivor_id required to share location")
            if visibility == "group" and not request.group_id:
                raise HTTPException(422, "group_id required for group location sharing")
            if request.group_id:
                self.group_token(request.group_id)
            now = utc_now()
            # The chat text is not copied into a public presence record.
            body = {
                "kind": "presence", "text": "Survivor requested help",
                "reporter_id": request.survivor_id,
                "location": ({"lat": round(request.location.lat, 2),
                              "lon": round(request.location.lon, 2)}
                             if visibility == "public" else request.location.model_dump()),
                "visibility": visibility,
                "group_id": request.group_id,
                "entity_id": request.survivor_id,
                "status": "needs_contact", "severity": "yellow",
                "observed_at": now.isoformat(),
                "expires_at": (now + timedelta(hours=2)).isoformat(),
            }
            presence = self._event(body)
        else:
            presence = None
        cards = self.memory.search("reference", request.text, limit=5)
        public_filter = Filter(must=[FieldCondition(key="visibility", match=MatchValue("public"))])
        memory_hits = self.memory.search("events", request.text, limit=5, filter_=public_filter)
        if request.group_id:
            group_filter = Filter(must=[
                FieldCondition(key="visibility", match=MatchValue("group")),
                FieldCondition(key="group_id", match=MatchValue(request.group_id)),
            ])
            memory_hits += self.memory.search("events", request.text, limit=5, filter_=group_filter)
        memory_hits = [e for e in memory_hits if not e.get("expires_at")
                       or datetime.fromisoformat(e["expires_at"]) > utc_now()]
        memory_hits.sort(key=lambda e: e["score"], reverse=True)
        local_answer, suggested_action = local_response(
            request.text, cards, memory_hits,
            materials=request.materials,
            breathing=request.breathing,
            bleeding_type=request.bleeding_type,
        )
        terms = query_terms(request.text)
        grounded_cards = [{**card, "citation_label": f"G{index}"}
                          for index, card in enumerate(cards[:3], 1)
                          if terms & card_terms(card)]
        public_hits = [hit for hit in memory_hits[:5] if hit.get("visibility") == "public"][:4]
        grounded_hits = [{**hit, "citation_label": f"R{index}"}
                         for index, hit in enumerate(public_hits, 1)
                         if terms & query_terms(hit.get("text", ""))]
        ai_answer = None
        ai_status = "local_only"
        if request.use_ai:
            if not self.settings.gemini_api_key:
                ai_status = "not_configured"
            elif not grounded_cards and not grounded_hits:
                ai_status = "no_evidence"
            else:
                ai_answer = grounded_answer(
                    request.text, grounded_cards, grounded_hits,
                    self.settings.gemini_api_key, self.settings.gemini_model,
                )
                ai_status = "answered" if ai_answer else "unavailable"
        return {"answer_type": "retrieved_cards", "cards": cards,
                "memory_hits": memory_hits[:5],
                "ai_answer": ai_answer, "ai_status": ai_status,
                "local_answer": local_answer, "suggested_action": suggested_action,
                "presence_event": presence["event"]["id"] if presence else None,
                "location_shared": bool(presence)}

    def assess(self, request: AssessRequest) -> dict:
        cards = self.memory.search("reference", request.query, limit=max(10, request.limit))
        return clinical_assess(
            query=request.query,
            cards=cards,
            materials=request.materials,
            breathing=request.breathing,
            bleeding_type=request.bleeding_type,
            limit=request.limit,
        )

    def import_events(self, events: list[dict]) -> dict:
        if len(events) > 128:
            raise HTTPException(413, "batch exceeds 128 events")
        imported = duplicates = 0
        imported_ids: list[str] = []
        for raw in events:
            event = Event.model_validate(raw)
            if event.expires_at and event.expires_at < utc_now():
                duplicates += 1
                continue
            if event.visibility not in {"public", "group", "responders"}:
                raise HTTPException(422, "invalid visibility")
            if event.visibility == "group":
                self.group_token(event.group_id or "")
            if event.observed_at > utc_now() + timedelta(minutes=5):
                raise HTTPException(422, "future event rejected")
            if not hmac.compare_digest(hashlib.sha256(canonical(event.body())).hexdigest(), event.content_hash):
                raise HTTPException(422, "event content hash mismatch")
            old = self.memory.get("events", event.id)
            if old:
                if old["content_hash"] != event.content_hash:
                    raise HTTPException(409, "event ID collision or altered replay")
                duplicates += 1
                continue
            if event.verified and event.source_role != "central":
                raise HTTPException(422, "verified reports require a command origin")
            if event.verified:
                if not self.settings.guide_trust_key or not event.authority_tag:
                    raise HTTPException(422, "verified report authentication unavailable")
                unsigned = {key: value for key, value in event.body().items()
                            if key != "authority_tag"}
                expected = hmac.new(self.settings.guide_trust_key.encode(),
                                    canonical(unsigned), hashlib.sha256).hexdigest()
                if not hmac.compare_digest(expected, event.authority_tag):
                    raise HTTPException(422, "verified report authentication failed")
            self.memory.upsert("events", event.id,
                               event.model_dump(mode="json", exclude_unset=True), event.text)
            imported += 1
            imported_ids.append(event.id)
        return {"imported": imported, "duplicates": duplicates,
                "imported_ids": imported_ids}

    def scoped_events(self, scope: str, group_id: str | None = None) -> list[dict]:
        self.purge_expired()
        if scope == "group":
            if not group_id:
                raise HTTPException(422, "group_id required")
            self.group_token(group_id)
        elif scope not in {"public", "responders"}:
            raise HTTPException(422, "unknown scope")
        return [e for e in self.memory.all("events")
                if e["visibility"] == scope and (scope != "group" or e["group_id"] == group_id)]

    def nearby(self, request: NearbyRequest) -> list[dict]:
        self.purge_expired()
        if request.group_id:
            self.group_token(request.group_id)
        now = utc_now()
        seen = {}
        for event in self.memory.nearby(request.location.model_dump(), request.radius_m):
            if event["kind"] not in request.kinds:
                continue
            if event["visibility"] == "group" and event["group_id"] != request.group_id:
                continue
            if event["visibility"] == "responders" and not request.include_responders:
                continue
            if event.get("expires_at") and datetime.fromisoformat(event["expires_at"]) < now:
                continue
            key = (event["kind"], event.get("entity_id") or event["id"])
            if key not in seen or event["observed_at"] > seen[key]["observed_at"]:
                seen[key] = event
        result = []
        for event in seen.values():
            event = dict(event)
            event["distance_m"] = round(distance_m(request.location.model_dump(), event["location"]))
            result.append(event)
        return sorted(result, key=lambda e: e["distance_m"])

    def entity_timeline(self, entity_id: str, group_id: str | None = None,
                        include_responders: bool = False) -> dict:
        self.purge_expired()
        reports = sorted((e for e in self.memory.all("events") if e.get("entity_id") == entity_id
                          and (e["visibility"] == "public"
                               or (e["visibility"] == "group" and e.get("group_id") == group_id)
                               or (e["visibility"] == "responders" and include_responders))),
                         key=lambda e: (e["observed_at"], e["id"]))
        # A recent danger report remains visible even if a later unverified report says safe.
        recent_danger = [e for e in reports if e["kind"] in {"hazard", "checkpoint"}
                         and e.get("status") in {"danger", "flooded", "blocked"}
                         and datetime.fromisoformat(e["observed_at"]) > utc_now() - timedelta(hours=6)]
        latest_verified = next((e for e in reversed(reports)
                                if e.get("verified") and e.get("source_role") == "central"), None)
        danger = recent_danger[-1] if recent_danger else None
        effective = (latest_verified if latest_verified and
                     (not danger or latest_verified["observed_at"] > danger["observed_at"])
                     else danger or (reports[-1] if reports else None))
        conflict = len({e.get("status") for e in reports}) > 1
        alternative = None
        if danger or conflict or (effective and effective.get("status") in {"danger", "flooded", "blocked"}):
            hazard_text = (danger.get("text") if danger else effective.get("text") if effective else "flooded hazard blocked")
            alternative = self.memory.recommend_alternative(entity_id, hazard_text)
        return {"entity_id": entity_id, "effective": effective, "timeline": reports,
                "conflict": conflict, "alternative_recommendation": alternative}

    def recommend_alternative_checkpoint(self, compromised_id: str, avoid_hazard: str = "flooded entrance live wires") -> dict:
        rec = self.memory.recommend_alternative(compromised_id, avoid_hazard)
        return {
            "compromised_id": compromised_id,
            "avoid_hazard": avoid_hazard,
            "recommended": rec,
        }

    def survival_radar(self, request: SurvivalRadarRequest, peers: list[dict] | None = None) -> dict:
        """Unified survival finder radar combining Qdrant Edge memory, Wi-Fi peers, and Bluetooth proximity."""
        self.purge_expired()
        user_loc = {"lat": request.lat, "lon": request.lon}
        now = utc_now()
        radar_items = []
        seen_keys = set()

        # 1. Dynamic Events from Local Qdrant Memory
        nearby_events = self.memory.nearby(user_loc, request.radius_m)
        for event in nearby_events:
            if event.get("expires_at") and datetime.fromisoformat(event["expires_at"]) < now:
                continue
            if event.get("visibility") == "group" and event.get("group_id") != request.group_id:
                continue
            if event.get("visibility") == "responders" and not request.include_responders:
                continue

            dist = distance_m(user_loc, event["location"])
            if dist > request.radius_m:
                continue

            bearing = calculate_bearing(request.lat, request.lon, event["location"]["lat"], event["location"]["lon"])
            cardinal = calculate_cardinal(bearing)
            walk_min = max(1, round(dist / 75.0))

            kind = event.get("kind", "incident")
            text = event.get("text", "")
            severity = event.get("severity", "yellow")
            status = event.get("status", "active")

            is_casualty = kind in {"incident", "presence"} or any(w in text.lower() for w in ["injured", "cannot walk", "cant walk", "bleeding", "trapped", "broken", "unconscious"])
            is_hazard = kind == "hazard" or status in {"danger", "flooded", "blocked"}
            is_resource = kind == "resource" or "water" in text.lower()
            is_shelter = kind == "checkpoint" and not is_hazard

            if is_casualty:
                cat = "casualty"
                triage = "immediate_red" if (severity == "red" or any(w in text.lower() for w in ["cannot walk", "cant walk", "bleeding", "unresponsive", "trapped", "broken"])) else "delayed_yellow"
            elif is_hazard:
                cat = "hazard"
                triage = "hazard_warning"
            elif is_resource:
                cat = "resource"
                triage = "resource_green"
            elif is_shelter:
                cat = "shelter"
                triage = "safe_green"
            else:
                cat = "other"
                triage = "informational"

            if request.filter_category != "all":
                if request.filter_category == "casualties" and cat != "casualty":
                    continue
                if request.filter_category == "shelters" and cat != "shelter":
                    continue
                if request.filter_category == "resources" and cat != "resource":
                    continue
                if request.filter_category == "hazards" and cat != "hazard":
                    continue

            key = (cat, event.get("entity_id") or event.get("id"))
            if key in seen_keys:
                continue
            seen_keys.add(key)

            radar_items.append({
                "id": event.get("id"),
                "name": event.get("title") or event.get("entity_id") or f"{cat.title()} Signal",
                "category": cat,
                "triage_level": triage,
                "text": text,
                "status": status,
                "severity": severity,
                "distance_m": round(dist),
                "bearing_deg": bearing,
                "cardinal": cardinal,
                "walk_time_min": walk_min,
                "location": event["location"],
                "origin_device": event.get("origin_device", "local"),
                "observed_at": event.get("observed_at"),
                "signal_source": "qdrant_memory",
                "verified": event.get("verified", False),
            })

        # 2. Dynamic Checkpoints from Reference Memory
        ref_checkpoints = [
            card for card in self.memory.all("reference")
            if card.get("kind") == "checkpoint" or "checkpoint" in card.get("id", "").lower() or "shelter" in card.get("id", "").lower()
        ]

        # If unseeded test environment, fall back to safe minimal defaults
        if not ref_checkpoints:
            ref_checkpoints = [
                {"id": "shelter_alpha", "name": "Shelter Alpha (Central High)", "title": "Shelter Alpha (Central High)", "lat": 28.7120, "lon": 77.0980, "facilities": ["Shelter", "Medical", "Food", "Power"], "capacity": 250, "status": "operational"},
                {"id": "clinic_beta", "name": "Clinic Beta (West District)", "title": "Clinic Beta (West District)", "lat": 28.7090, "lon": 77.0940, "facilities": ["Emergency Surgery", "Clean Water"], "capacity": 80, "status": "operational"},
                {"id": "water_tanker_4", "name": "Water Tanker 4 (North Gate)", "title": "Water Tanker 4 (North Gate)", "lat": 28.7060, "lon": 77.1080, "facilities": ["Clean Water", "Purification"], "capacity": 5000, "status": "operational"},
                {"id": "cp_17", "name": "Checkpoint CP-17 (North Bridge)", "title": "Checkpoint CP-17 (North Bridge)", "lat": 28.7041, "lon": 77.1025, "facilities": ["Checkpoint"], "capacity": 0, "status": "danger_warning", "hazard": "Flooded entrance live wires"},
            ]

        # Check recent event status overrides for checkpoints
        recent_statuses = {}
        for ev in self.memory.all("events"):
            ent_id = ev.get("entity_id")
            if ent_id and ev.get("status"):
                recent_statuses[ent_id] = ev

        for cp in ref_checkpoints:
            cp_loc = cp.get("location")
            if not cp_loc and cp.get("lat") is not None and cp.get("lon") is not None:
                cp_loc = {"lat": cp["lat"], "lon": cp["lon"]}
            if not cp_loc:
                continue

            dist = distance_m(user_loc, cp_loc)
            if dist <= request.radius_m:
                bearing = calculate_bearing(request.lat, request.lon, cp_loc["lat"], cp_loc["lon"])
                cardinal = calculate_cardinal(bearing)
                walk_min = max(1, round(dist / 75.0))

                override_ev = recent_statuses.get(cp.get("id"))
                status = override_ev.get("status") if override_ev else cp.get("status", "operational")
                is_danger = status in {"danger", "flooded", "blocked", "danger_warning"}
                hazard_desc = override_ev.get("text") if (override_ev and is_danger) else cp.get("hazard")
                cat = "hazard" if is_danger else "shelter"

                if request.filter_category == "all" or (request.filter_category == "shelters" and not is_danger) or (request.filter_category == "hazards" and is_danger):
                    key = (cat, cp["id"])
                    if key not in seen_keys:
                        seen_keys.add(key)
                        radar_items.append({
                            "id": cp["id"],
                            "name": cp.get("title") or cp.get("name") or cp["id"],
                            "category": cat,
                            "triage_level": "hazard_warning" if is_danger else "safe_green",
                            "text": hazard_desc or cp.get("summary") or f"Verified disaster shelter with facilities: {', '.join(cp.get('facilities', []))}",
                            "status": status,
                            "severity": "red" if is_danger else "green",
                            "distance_m": round(dist),
                            "bearing_deg": bearing,
                            "cardinal": cardinal,
                            "walk_time_min": walk_min,
                            "location": cp_loc,
                            "facilities": cp.get("facilities", []),
                            "capacity": cp.get("base_capacity") or cp.get("capacity"),
                            "signal_source": "reference_memory",
                            "verified": True,
                        })

        # 3. Discovered Wi-Fi & Simulated Bluetooth Proximity Peers
        if peers:
            for p in peers:
                if p.get("lat") is not None and p.get("lon") is not None:
                    p_loc = {"lat": p["lat"], "lon": p["lon"]}
                    dist = distance_m(user_loc, p_loc)
                    if dist <= request.radius_m:
                        bearing = calculate_bearing(request.lat, request.lon, p["lat"], p["lon"])
                        cardinal = calculate_cardinal(bearing)
                        walk_min = max(1, round(dist / 75.0))

                        # Simulated BLE / Wi-Fi Direct path loss in dBm
                        dbm = -min(95, max(40, int(42 + 20 * math.log10(max(1.0, dist)))))
                        quality = "strong" if dbm >= -62 else ("moderate" if dbm >= -76 else "weak")

                        if request.filter_category in {"all", "peers"}:
                            key = ("peer", p["node_id"])
                            if key not in seen_keys:
                                seen_keys.add(key)
                                radar_items.append({
                                    "id": f"peer_{p['node_id']}",
                                    "name": f"Peer: {p['node_id']} ({p.get('role', 'device')})",
                                    "category": "peer",
                                    "triage_level": "peer_cyan",
                                    "text": f"Active {p.get('role', 'survivor')} node discovered on Wi-Fi/Bluetooth hotspot",
                                    "status": "online" if p.get("is_online", True) else "recent",
                                    "severity": "green",
                                    "distance_m": round(dist),
                                    "bearing_deg": bearing,
                                    "cardinal": cardinal,
                                    "walk_time_min": walk_min,
                                    "location": p_loc,
                                    "signal_source": "wifi_direct",
                                    "signal_dbm": dbm,
                                    "signal_quality": quality,
                                    "ip_port": f"{p.get('ip')}:{p.get('port')}",
                                    "node_id": p["node_id"],
                                    "node_role": p.get("role", "survivor"),
                                    "verified": False,
                                })

        radar_items.sort(key=lambda x: x["distance_m"])

        casualties = [i for i in radar_items if i["category"] == "casualty"]
        shelters = [i for i in radar_items if i["category"] == "shelter"]
        peers_found = [i for i in radar_items if i["category"] == "peer"]
        urgent = [c for c in casualties if c["triage_level"] == "immediate_red"]

        return {
            "center": user_loc,
            "radius_m": request.radius_m,
            "total_found": len(radar_items),
            "summary": {
                "urgent_casualties": len(urgent),
                "total_casualties": len(casualties),
                "operational_shelters": len(shelters),
                "active_peers": len(peers_found),
                "nearest_casualty": casualties[0] if casualties else None,
                "nearest_shelter": shelters[0] if shelters else None,
            },
            "radar_items": radar_items
        }

    def signed_guides(self) -> list[dict]:

        return [card for card in self.memory.all("reference") if card.get("auth_tag")]

    def _guide_tag(self, guide: dict) -> str:
        body = {key: value for key, value in guide.items() if key != "auth_tag"}
        return hmac.new(self.settings.guide_trust_key.encode(), canonical(body), hashlib.sha256).hexdigest()

    def publish_guide(self, request: GuidePublishRequest) -> dict:
        if self.settings.role != "central" or not self.settings.guide_trust_key:
            raise HTTPException(403, "command guide publishing is unavailable")
        current = self.memory.get("reference", request.id)
        guide = request.model_dump()
        guide.update({"kind": "protocol", "version": int(current.get("version", 0)) + 1 if current else 1,
                      "issued_at": utc_now().isoformat(), "publisher": self.settings.node_id,
                      "review_status": "team_reviewed"})
        guide["auth_tag"] = self._guide_tag(guide)
        self.memory.upsert("reference", guide["id"], guide,
                           f"{guide['title']} {guide['keywords']} {guide['summary']}")
        return guide

    def import_guides(self, guides: list[dict]) -> dict:
        if len(guides) > 64:
            raise HTTPException(413, "guide batch exceeds 64")
        if not self.settings.guide_trust_key:
            raise HTTPException(503, "GUIDE_TRUST_KEY is required for guide updates")
        imported = duplicates = 0
        for guide in guides:
            GuidePublishRequest.model_validate(guide)
            if guide.get("kind") != "protocol" or not isinstance(guide.get("version"), int):
                raise HTTPException(422, "invalid guide version or kind")
            tag = guide.get("auth_tag", "")
            if not hmac.compare_digest(self._guide_tag(guide), tag):
                raise HTTPException(422, "guide authentication failed")
            old = self.memory.get("reference", guide["id"])
            if old and old.get("version", 0) >= guide["version"]:
                duplicates += 1
                continue
            self.memory.upsert("reference", guide["id"], guide,
                               f"{guide['title']} {guide['keywords']} {guide['summary']}")
            imported += 1
        return {"imported": imported, "duplicates": duplicates}

    def record_transfer(self, event_id: str, from_node: str, to_node: str) -> None:
        event = self.memory.get("events", event_id)
        if not event:
            return
        receipt_id = hashlib.sha256(f"{event_id}:{from_node}:{to_node}".encode()).hexdigest()
        if self.memory.get("receipts", receipt_id):
            return
        receipt = {"id": receipt_id, "type": "transfer", "event_id": event_id,
                   "from_node": from_node, "to_node": to_node,
                   "synced_at": utc_now().isoformat(),
                   "visibility": event["visibility"], "group_id": event.get("group_id")}
        self.memory.upsert("receipts", receipt_id, receipt,
                           f"{event_id} {from_node} {to_node}")

    def transfer_receipts(self, scope: str, group_id: str | None = None) -> list[dict]:
        return [receipt for receipt in self.memory.all("receipts")
                if receipt.get("type") == "transfer" and receipt.get("visibility") == scope
                and (scope != "group" or receipt.get("group_id") == group_id)]

    def import_receipts(self, receipts: list[dict], scope: str,
                        group_id: str | None = None) -> dict:
        if len(receipts) > 128:
            raise HTTPException(413, "receipt batch exceeds 128")
        imported = duplicates = 0
        for receipt in receipts:
            event_id = receipt.get("event_id", "")
            event = self.memory.get("events", event_id)
            expected_id = hashlib.sha256(
                f"{event_id}:{receipt.get('from_node')}:{receipt.get('to_node')}".encode()
            ).hexdigest()
            if (not event or receipt.get("type") != "transfer" or
                    receipt.get("id") != expected_id or
                    event["visibility"] != scope or
                    (scope == "group" and event.get("group_id") != group_id)):
                raise HTTPException(422, "receipt does not match a visible event")
            if self.memory.get("receipts", expected_id):
                duplicates += 1
                continue
            self.memory.upsert("receipts", expected_id, receipt,
                               f"{event_id} {receipt['from_node']} {receipt['to_node']}")
            imported += 1
        return {"imported": imported, "duplicates": duplicates}

    def provenance(self, event_id: str, group_id: str | None = None,
                   include_responders: bool = False) -> dict:
        event = self.memory.get("events", event_id)
        if not event:
            raise HTTPException(404, "event not found")
        if event["visibility"] == "group" and event.get("group_id") != group_id:
            raise HTTPException(403, "group token required")
        if event["visibility"] == "responders" and not include_responders:
            raise HTTPException(403, "responder key required")
        hops = sorted((r for r in self.memory.all("receipts")
                       if r.get("type") == "transfer" and r.get("event_id") == event_id),
                      key=lambda r: r["synced_at"])
        known_nodes = sorted({event["origin_device"]} |
                             {r["to_node"] for r in hops})
        return {"event": event, "known_nodes": known_nodes, "hops": hops}

    def sync_status(self) -> dict:
        self.purge_expired()
        events = list(self.memory.all("events"))
        return {"node_id": self.settings.node_id,
                "local_event_count": len(events),
                "by_visibility": {scope: sum(e["visibility"] == scope for e in events)
                                  for scope in ("public", "group", "responders")},
                "last_exchanges": list(self.memory.all("receipts"))}

    def purge_expired(self) -> int:
        now = utc_now()
        expired = [e["id"] for e in self.memory.all("events")
                   if e.get("expires_at") and datetime.fromisoformat(e["expires_at"]) < now]
        self.memory.delete("events", expired)
        return len(expired)


def distance_m(a: dict, b: dict) -> float:
    r = 6371000
    dlat, dlon = radians(b["lat"] - a["lat"]), radians(b["lon"] - a["lon"])
    x = sin(dlat / 2) ** 2 + cos(radians(a["lat"])) * cos(radians(b["lat"])) * sin(dlon / 2) ** 2
    return 2 * r * asin(sqrt(x))
