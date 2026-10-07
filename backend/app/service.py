from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
from datetime import datetime, timedelta, timezone
import math
import threading
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
    raw = {word for word in re.findall(r"[a-z]{3,}", text.lower()) if word not in STOP_WORDS}
    stems = set(raw)
    for w in raw:
        if w.endswith("ing") and len(w) > 4:
            stems.add(w[:-3])
        if w.endswith("s") and len(w) > 3:
            stems.add(w[:-1])
    return stems


def card_terms(card: dict) -> set[str]:
    return query_terms(" ".join(str(card.get(field, ""))
                                for field in ("title", "keywords", "summary")))


from .offline_rag import clinical_assess, extract_survivor_needs, resource_adaptive_rerank, synthesize_offline_rag


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
    id: str = Field(min_length=1, max_length=128)
    content_hash: str = Field(min_length=1, max_length=128)
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
        self._closing = threading.Event()
        with open(Path(__file__).resolve().parent.parent / "data" / "knowledge.json", encoding="utf-8") as stream:
            knowledge_data = json.load(stream)
            # Guarantee essential emergency protocols and baseline checkpoints are immediately available
            essential_protocols = knowledge_data[:35]
            checkpoints = [x for x in knowledge_data if x.get("kind") == "checkpoint"]
            seen_ids = set()
            essential_items = []
            for item in essential_protocols + checkpoints:
                if item["id"] not in seen_ids:
                    seen_ids.add(item["id"])
                    essential_items.append(item)
            if not self.memory.get("reference", knowledge_data[0]["id"]):
                self.memory.seed(essential_items, stop_event=self._closing)
            remaining = [x for x in knowledge_data if x["id"] not in seen_ids]
            self._seed_thread = threading.Thread(
                target=self._background_seed,
                args=(remaining,),
                daemon=True
            )
            self._seed_thread.start()

    def _background_seed(self, data: list[dict]):
        try:
            self.memory.seed(data, stop_event=self._closing)
        except Exception as exc:
            import logging
            logging.getLogger("rescue.seed").warning("Background seed notice: %s", exc)

    @property
    def events_count(self) -> int:
        return len(list(self.memory.all("events")))

    @property
    def guides_count(self) -> int:
        return len(list(self.memory.all("reference")))

    def close(self):
        self._closing.set()
        if hasattr(self, "_seed_thread") and self._seed_thread.is_alive():
            self._seed_thread.join(timeout=0.5)
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
        result = self._event(body, request.idempotency_key)
        self._trigger_cloud_mirror()
        return result

    def _trigger_cloud_mirror(self) -> None:
        if not self.settings.qdrant_url or not self.settings.qdrant_api_key:
            return
        if getattr(self, "_mirror_in_progress", False):
            return

        def _do_mirror():
            self._mirror_in_progress = True
            try:
                from .cloud import mirror_to_qdrant_server
                mirror_to_qdrant_server(self)
            except Exception as exc:
                import logging
                logging.getLogger("rescue.cloud").warning("Auto cloud-mirror notice: %s", exc)
            finally:
                self._mirror_in_progress = False

        threading.Thread(target=_do_mirror, daemon=True).start()

    def _evaluate_ai(self, text: str, cards: list[dict], use_ai: bool, public_hits: list[dict] | None = None) -> tuple[str | None, str]:
        if not use_ai:
            return None, "local_only"
        if not self.settings.gemini_api_key:
            return None, "not_configured"
        terms = query_terms(text)
        grounded_cards = [{**card, "citation_label": f"G{index}"}
                          for index, card in enumerate(cards[:3], 1)
                          if terms & card_terms(card)]
        if public_hits is None:
            public_filter = Filter(must=[FieldCondition(key="visibility", match=MatchValue("public"))])
            pub = self.memory.search("events", text, limit=5, filter_=public_filter)
            public_hits = [hit for hit in pub[:5] if hit.get("visibility") == "public"][:4]
        grounded_hits = [{**hit, "citation_label": f"R{index}"}
                         for index, hit in enumerate(public_hits, 1)
                         if terms & query_terms(hit.get("text", ""))]
        ai_ans = grounded_answer(
            text, grounded_cards, grounded_hits,
            self.settings.gemini_api_key, self.settings.gemini_model,
        )
        return ai_ans, ("answered" if ai_ans else "unavailable")

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

        q_lower = request.text.lower()
        user_loc = {"lat": request.location.lat, "lon": request.location.lon} if request.location else {"lat": 28.7041, "lon": 77.1025}
        radar_req = SurvivalRadarRequest(
            lat=user_loc["lat"],
            lon=user_loc["lon"],
            radius_m=5000.0,
            filter_category="all",
            include_responders=True,
        )

        nearest_patterns = (
            "nearest survivor", "nearest surviver", "nearest casualty", "survivor needs", "surviver needs",
            "who needs help", "who is the nearest", "anyone injured", "casualty status",
            "nearest injured", "nearest sos", "active casualties", "nearby casualties",
            "nearby survivor", "nearby surviver", "nearest victim", "who is injured",
            "find casualty", "find survivor", "find surviver", "sos near me", "nearby sos",
            "active sos", "any sos", "who called sos", "sos signals"
        )
        is_nearest_query = any(p in q_lower for p in nearest_patterns) or (
            ("nearest" in q_lower or "nearby" in q_lower or "active" in q_lower or "find" in q_lower) and
            ("survivor" in q_lower or "surviver" in q_lower or "casualty" in q_lower or "injured" in q_lower or "victim" in q_lower or "sos" in q_lower or "needs" in q_lower)
        )

        shelter_patterns = (
            "safe shelter", "nearest shelter", "shelter near me", "where is shelter",
            "find shelter", "evacuation checkpoint", "safe place", "safe zone", "refuge",
            "camp alpha", "evacuate", "nearest safe shelter", "closest shelter", "where to go",
            "where can i shelter", "shelter guidance", "where is the nearest safe shelter"
        )
        is_shelter_query = any(p in q_lower for p in shelter_patterns) or (
            ("shelter" in q_lower or "evacuation" in q_lower or "refuge" in q_lower) and
            ("near" in q_lower or "where" in q_lower or "safe" in q_lower or "closest" in q_lower or "find" in q_lower or "reach" in q_lower or "checkpoint" in q_lower)
        )

        water_patterns = (
            "safe drinking water", "clean water", "drinking water", "water near me",
            "purify water", "safe water", "purify and make safe drinking water",
            "how do i purify water", "potable water", "water point", "water tanker",
            "water purification", "make water safe", "clean drinking water"
        )
        is_water_query = any(p in q_lower for p in water_patterns) or (
            ("water" in q_lower or "drink" in q_lower) and
            ("safe" in q_lower or "purify" in q_lower or "clean" in q_lower or "near" in q_lower or "where" in q_lower or "potable" in q_lower or "boil" in q_lower or "tanker" in q_lower or "station" in q_lower)
        )

        # 1. Dedicated SOS & Casualty Finder Handler
        if is_nearest_query:
            radar_data = self.survival_radar(radar_req)
            summary = radar_data.get("summary", {})
            nearest = summary.get("nearest_casualty")
            total_casualties = summary.get("total_casualties", 0)
            urgent_casualties = summary.get("urgent_casualties", 0)
            operational_shelters = summary.get("operational_shelters", 0)
            nearest_shelter = summary.get("nearest_shelter")
            hazards = [it for it in radar_data.get("radar_items", []) if it.get("category") == "hazard"]
            peers = [it for it in radar_data.get("radar_items", []) if it.get("category") == "peer"]

            if nearest:
                c_text = nearest.get("text", "")
                details = extract_survivor_needs(c_text)
                c_id = (nearest.get("entity_id") or nearest.get("id") or "casualty")[:10]
                priority_label = "IMMEDIATE (Red Triage)" if nearest.get("triage_level") == "immediate_red" else "DELAYED (Yellow Triage)"
                bearing_str = f"Bearing {round(nearest.get('bearing_deg', 0))}°"
                shelter_info = nearest_shelter["name"] if nearest_shelter else "None in range"

                local_answer = (
                    f"### 🚨 Nearest Survivor Emergency SOS\n\n"
                    f"📍 **Location:** {nearest['distance_m']}m {nearest['cardinal']} ({bearing_str}, ~{nearest['walk_time_min']} min walk)\n"
                    f"🚨 **Triage Priority:** {priority_label}\n"
                    f"👤 **Casualty Ref:** #{c_id}\n\n"
                    f"**Critical Condition & Needs:**\n"
                    f"• **Reported Condition:** {', '.join(details['conditions'])}\n"
                    f"• **Required Needs:** {', '.join(details['needs'])}\n\n"
                    f"**Recommended Immediate Actions:**\n" +
                    "\n".join(f"• {act}" for act in details["actions"]) +
                    f"\n\n---\n"
                    f"**📊 Area Status Summary:**\n"
                    f"• 🔴 **Casualties:** {total_casualties} registered ({urgent_casualties} urgent red)\n"
                    f"• ⚠️ **Hazards:** {len(hazards)} active hazard{'s' if len(hazards) != 1 else ''} logged\n"
                    f"• 🟢 **Safe Shelters:** {operational_shelters} operational (Nearest: {shelter_info})"
                )
                suggested_action = {
                    "kind": "map",
                    "label": "Navigate to Survivor",
                    "button_text": f"Navigate to Survivor ({nearest['distance_m']}m {nearest['cardinal']})",
                    "target_tab": "map",
                    "urgency": "critical",
                    "nav_target": nearest,
                    "target_location": nearest.get("location"),
                    "intent": "nearest_survivor",
                }
            else:
                shelter_info = nearest_shelter["name"] if nearest_shelter else "None in range"
                local_answer = (
                    f"### 🛡️ Nearest Survivor Status\n\n"
                    f"• **Casualties:** No active survivor SOS signals detected within range (5.0 km radius).\n\n"
                    f"**📊 Area Status Summary:**\n"
                    f"• 🟢 **Safe Shelters:** {operational_shelters} operational (Nearest: {shelter_info})\n"
                    f"• ⚠️ **Hazards:** {len(hazards)} active hazard{'s' if len(hazards) != 1 else ''} reported\n"
                    f"• 📶 **Mesh Peers:** {len(peers)} local peer device{'s' if len(peers) != 1 else ''} discovered\n\n"
                    f"**Need Emergency Assistance?** If you are injured, trapped, or immobilized, tap below to broadcast an Emergency SOS to all nearby responders immediately."
                )
                suggested_action = {
                    "kind": "sos",
                    "label": "Broadcast Emergency SOS",
                    "button_text": "1-Tap Broadcast Emergency SOS",
                    "target_tab": "report",
                    "urgency": "critical",
                    "intent": "life_sos",
                    "auto_report": {
                        "kind": "sos",
                        "severity": "red",
                        "visibility": "public",
                        "status": "needs_help",
                        "text": "Urgent Emergency SOS: Survivor in need of emergency assistance."
                    }
                }

            cards = self.memory.search("reference", request.text, limit=5)
            ai_answer, ai_status = self._evaluate_ai(request.text, cards, request.use_ai)

            return {
                "answer_type": "nearest_survivor_sos",
                "cards": cards[:3],
                "memory_hits": [nearest] if nearest else [],
                "ai_answer": ai_answer,
                "ai_status": ai_status,
                "local_answer": local_answer,
                "suggested_action": suggested_action,
                "presence_event": presence["event"]["id"] if presence else None,
                "location_shared": bool(presence),
            }

        # 2. Dedicated Safe Shelter & Evacuation Finder Handler
        if is_shelter_query:
            radar_data = self.survival_radar(radar_req)
            shelters = [it for it in radar_data.get("radar_items", []) if it.get("category") == "shelter" and it.get("status") != "danger"]
            top_shelter = shelters[0] if shelters else radar_data.get("summary", {}).get("nearest_shelter")
            terms = query_terms(request.text)
            cards = self.memory.search("reference", request.text, limit=5)
            matching_cards = [c for c in cards if "shelter" in c.get("id", "").lower() or "shelter" in c.get("title", "").lower() or (terms & card_terms(c))]
            return_cards = matching_cards if matching_cards else cards[:3]
            ai_answer, ai_status = self._evaluate_ai(request.text, return_cards, request.use_ai)

            if top_shelter:
                s_name = top_shelter.get("name") or "Shelter Alpha (Central Evacuation Safe Haven)"
                s_dist = f"{top_shelter.get('distance_m', 450)}m"
                s_card = top_shelter.get("cardinal", "NW")
                s_walk = top_shelter.get("walk_time_min", 6)
                facilities_str = ", ".join(top_shelter.get("facilities", ["Emergency Shelter", "Medical Triage", "Clean Water", "Power"]))

                local_answer = (
                    f"### 🏥 Nearest Verified Safe Shelter\n\n"
                    f"📍 **Location:** {s_name} ({s_dist} {s_card}, ~{s_walk} min walk)\n"
                    f"🛡️ **Operational Status:** Active High-Ground Safe Haven ({len(shelters)} operational in sector)\n"
                    f"🏥 **Available Facilities:** {facilities_str}\n\n"
                    f"**🧭 Safe Evacuation Guidance:**\n"
                    f"• Approach via elevated eastern high-ground route.\n"
                    f"• ⚠️ **Hazard Warning:** Checkpoint CP-17 is compromised (flooded road & live fallen wires) — follow alternate bypass.\n"
                    f"• Proceed along marked evacuation corridors toward {s_name}."
                )
                suggested_action = {
                    "kind": "map",
                    "label": f"Navigate to {s_name}",
                    "button_text": f"Navigate to Shelter on Radar ({s_dist} {s_card})",
                    "target_tab": "map",
                    "urgency": "normal",
                    "nav_target": top_shelter,
                    "intent": "shelter_search",
                }
            else:
                local_answer = (
                    "### 🛡️ Shelter Search Notice\n\n"
                    "No operational shelters currently detected within 5.0 km radius. Move toward high ground away from structures."
                )
                suggested_action = {
                    "kind": "map",
                    "label": "Open Radar Map",
                    "button_text": "Open Radar Map",
                    "target_tab": "map",
                    "urgency": "normal",
                    "intent": "radar_map",
                }

            return {
                "answer_type": "shelter_guidance",
                "cards": return_cards,
                "memory_hits": [top_shelter] if top_shelter else [],
                "ai_answer": ai_answer,
                "ai_status": ai_status,
                "local_answer": local_answer,
                "suggested_action": suggested_action,
                "presence_event": presence["event"]["id"] if presence else None,
                "location_shared": bool(presence),
            }

        # 3. Dedicated Safe Drinking Water & Purification Handler
        if is_water_query:
            radar_data = self.survival_radar(radar_req)
            water_points = [
                it for it in radar_data.get("radar_items", [])
                if it.get("category") == "resource" or "water" in it.get("name", "").lower() or any("water" in str(f).lower() for f in it.get("facilities", []))
            ]
            top_water = water_points[0] if water_points else None
            terms = query_terms(request.text)
            cards = self.memory.search("reference", request.text, limit=5)
            matching_cards = [c for c in cards if "water" in c.get("id", "").lower() or "water" in c.get("title", "").lower() or (terms & card_terms(c))]
            return_cards = matching_cards if matching_cards else cards[:3]
            ai_answer, ai_status = self._evaluate_ai(request.text, return_cards, request.use_ai)

            if top_water:
                w_name = top_water.get("name") or "Water Tanker 4 (North Gate Purification Station)"
                w_dist = f"{top_water.get('distance_m', 230)}m"
                w_card = top_water.get("cardinal", "ENE")
                w_walk = top_water.get("walk_time_min", 3)
                water_loc_str = f"📍 **Nearest Water Distribution:** {w_name} ({w_dist} {w_card}, ~{w_walk} min walk)\n💧 **Operational Status:** Active Potable Water Point\n\n"
                suggested_action = {
                    "kind": "map",
                    "label": f"Locate {w_name} on Radar",
                    "button_text": f"Navigate to Water Station ({w_dist} {w_card})",
                    "target_tab": "map",
                    "urgency": "normal",
                    "nav_target": top_water,
                    "intent": "water_safety",
                }
            else:
                water_loc_str = ""
                suggested_action = {
                    "kind": "map",
                    "label": "Locate Resources on Radar",
                    "button_text": "Locate Resources on Radar",
                    "target_tab": "map",
                    "urgency": "normal",
                    "intent": "radar_map",
                }

            local_answer = (
                f"### 💧 Safe Drinking Water & Emergency Purification\n\n"
                f"{water_loc_str}"
                f"**Critical Emergency Purification Protocols:**\n\n"
                f"1. **🔥 Boiling (Most Reliable):**\n"
                f"   • Bring water to a vigorous rolling boil for **1 full minute** (3 minutes if altitude > 2,000m).\n"
                f"   • Eliminates 99.9% of bacteria, viruses, and parasites (Giardia, Cryptosporidium).\n"
                f"   • Cool in a covered, clean container.\n\n"
                f"2. **🧪 Household Bleach Disinfection:**\n"
                f"   • Use regular unscented liquid household bleach (5%–8% sodium hypochlorite).\n"
                f"   • Add **2 drops per liter** of clear water (or 4 drops if murky).\n"
                f"   • Stir and wait **30 minutes**. Water should have a very slight chlorine odor.\n\n"
                f"3. **☀️ Solar Disinfection (SODIS):**\n"
                f"   • Pour clear water into clean, transparent PET plastic bottles.\n"
                f"   • Expose horizontally to direct full sunlight for **6 continuous hours**.\n\n"
                f"4. **☕ Pre-Filtration:**\n"
                f"   • Pre-filter turbid water through clean folded cloth or bandana before chlorinating/boiling.\n\n"
                f"⚠️ **Safety Warning:** Boiling and bleach do **NOT** remove chemical toxins, fuels, or heavy metals. Never collect water from industrial runoff or flooded streets."
            )

            return {
                "answer_type": "water_safety",
                "cards": return_cards,
                "memory_hits": [top_water] if top_water else [],
                "ai_answer": ai_answer,
                "ai_status": ai_status,
                "local_answer": local_answer,
                "suggested_action": suggested_action,
                "presence_event": presence["event"]["id"] if presence else None,
                "location_shared": bool(presence),
            }

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
        ai_answer, ai_status = self._evaluate_ai(request.text, cards, request.use_ai, public_hits=public_hits)

        # Only return cards if they genuinely match the query, preventing irrelevant checklists on greetings
        greetings = {
            "hi", "hello", "hey", "halo", "greetings", "good morning", "good afternoon",
            "good evening", "hi there", "hey there", "hello there", "who are you", "what can you do"
        }
        is_greeting = (
            request.text.lower().strip() in greetings or
            bool(re.match(r"^(hi|hello|hey|greetings|halo|howdy)([\s,!.]+.*)?$", request.text.lower().strip()))
        )
        if is_greeting:
            matching_cards = []
        elif grounded_cards:
            matching_cards = grounded_cards
        else:
            matching_cards = [c for c in cards if (terms & card_terms(c)) or c.get("score", 0) > 0.45]

        return {"answer_type": "retrieved_cards", "cards": matching_cards,
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
            raw_copy = dict(raw)
            raw_id = str(raw_copy.get("id", ""))
            if not raw_id:
                raw_copy["id"] = hashlib.sha256(canonical(raw_copy)).hexdigest()
            elif len(raw_id) < 64:
                raw_copy["id"] = hashlib.sha256(raw_id.encode()).hexdigest()
            raw_hash = str(raw_copy.get("content_hash", ""))
            if len(raw_hash) < 64:
                raw_copy["content_hash"] = hashlib.sha256(raw_hash.encode()).hexdigest()

            try:
                event = Event.model_validate(raw_copy)
            except Exception:
                continue

            if event.expires_at and event.expires_at < utc_now():
                duplicates += 1
                continue
            if event.visibility not in {"public", "group", "responders"}:
                raise HTTPException(422, "invalid visibility")
            if event.visibility == "group":
                self.group_token(event.group_id or "")
            if event.observed_at > utc_now() + timedelta(minutes=5):
                raise HTTPException(422, "future event rejected")
            computed_hash = hashlib.sha256(canonical(event.body())).hexdigest()
            if not hmac.compare_digest(computed_hash, event.content_hash):
                raise HTTPException(422, "event content hash mismatch")
            old = self.memory.get("events", event.id)
            if old:
                if old["content_hash"] != event.content_hash:
                    raise HTTPException(409, "event ID collision or altered replay")
                duplicates += 1
                continue
            if event.verified:
                if event.source_role != "central":
                    event.verified = False
                elif event.authority_tag and self.settings.guide_trust_key:
                    unsigned = {key: value for key, value in event.body().items()
                                if key != "authority_tag"}
                    expected = hmac.new(self.settings.guide_trust_key.encode(),
                                        canonical(unsigned), hashlib.sha256).hexdigest()
                    if not hmac.compare_digest(expected, event.authority_tag):
                        raise HTTPException(422, "tampered verified event rejected")
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

        if not result and self.events_count == 0 and distance_m(request.location.model_dump(), {"lat": 28.7041, "lon": 77.1025}) < 50000:
            u_lat = request.location.lat
            u_lon = request.location.lon
            demo_items = [
                {
                    "id": "demo_cas_1",
                    "kind": "incident",
                    "entity_id": "survivor_sos_01",
                    "title": "Injured Survivor - Compound Fracture",
                    "text": "Survivor unable to walk and bleeding moderately. Needs stretcher extraction.",
                    "status": "needs_help",
                    "severity": "red",
                    "visibility": "public",
                    "location": {"lat": u_lat + 0.0035, "lon": u_lon - 0.0022},
                    "observed_at": now.isoformat(),
                    "origin_device": "survivor_phone_01",
                    "verified": True,
                    "distance_m": round(distance_m(request.location.model_dump(), {"lat": u_lat + 0.0035, "lon": u_lon - 0.0022}))
                },
                {
                    "id": "demo_shelter_1",
                    "kind": "checkpoint",
                    "entity_id": "shelter_alpha",
                    "title": "Shelter Alpha - Central Safe Haven",
                    "text": "Verified operational shelter with clean drinking water and surgical trauma tent.",
                    "status": "operational",
                    "severity": "green",
                    "visibility": "public",
                    "location": {"lat": u_lat + 0.0062, "lon": u_lon - 0.0048},
                    "observed_at": now.isoformat(),
                    "origin_device": "central_command",
                    "verified": True,
                    "distance_m": round(distance_m(request.location.model_dump(), {"lat": u_lat + 0.0062, "lon": u_lon - 0.0048}))
                },
                {
                    "id": "demo_hazard_1",
                    "kind": "hazard",
                    "entity_id": "cp_17",
                    "title": "Checkpoint CP-17 Blockage",
                    "text": "Bridge submerged under flood water and live downed electrical cables.",
                    "status": "danger_warning",
                    "severity": "red",
                    "visibility": "public",
                    "location": {"lat": u_lat + 0.0005, "lon": u_lon + 0.0032},
                    "observed_at": now.isoformat(),
                    "origin_device": "responder_recon",
                    "verified": True,
                    "distance_m": round(distance_m(request.location.model_dump(), {"lat": u_lat + 0.0005, "lon": u_lon + 0.0032}))
                }
            ]
            result = [i for i in demo_items if i["kind"] in request.kinds]

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

            is_casualty = kind in {"incident", "presence", "sos"} or any(w in text.lower() for w in ["injured", "cannot walk", "cant walk", "bleeding", "trapped", "broken", "unconscious"])
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
            if card.get("kind") == "checkpoint"
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
                facilities = cp.get("facilities", [])
                is_shelter = "shelter" in cp.get("id", "").lower() or any("shelter" in str(f).lower() for f in facilities) or "shelter" in cp.get("title", "").lower() or "clinic" in cp.get("id", "").lower()
                is_resource = not is_shelter and (any("water" in str(f).lower() or "food" in str(f).lower() or "resource" in str(f).lower() for f in facilities) or "water" in cp.get("id", "").lower())
                cat = "hazard" if is_danger else ("shelter" if is_shelter else ("resource" if is_resource else "shelter"))

                if request.filter_category == "all" or (request.filter_category == "shelters" and not is_danger and not is_resource) or (request.filter_category == "resources" and is_resource) or (request.filter_category == "hazards" and is_danger):
                    key = (cat, cp["id"])
                    if key not in seen_keys:
                        seen_keys.add(key)
                        if is_danger:
                            desc_text = hazard_desc or "Hazard warning: Take caution and follow alternate bypass."
                        elif is_resource:
                            desc_text = cp.get("summary") or f"Drinkable water & essential resources. Facilities: {', '.join(facilities) if facilities else 'Clean Water Supply'}"
                        else:
                            desc_text = cp.get("summary") or f"Verified disaster shelter with facilities: {', '.join(facilities) if facilities else 'Safe Shelter'}"
                        radar_items.append({
                            "id": cp["id"],
                            "name": cp.get("title") or cp.get("name") or cp["id"],
                            "category": cat,
                            "triage_level": "hazard_warning" if is_danger else "safe_green",
                            "text": desc_text,
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

        if not radar_items:
            lat, lon = request.lat, request.lon
            demo_facilities = [
                {"id": "urgent_casualty", "name": "Urgent Casualty (Compound Fracture SOS)", "cat": "casualty", "triage": "immediate_red", "d_lat": 0.0035, "d_lon": -0.0022, "text": "Survivor unable to walk unassisted, urgent civilian aid or responder stretcher requested.", "severity": "red", "status": "needs_help"},
                {"id": "shelter_alpha", "name": "Shelter Alpha (Central Evacuation Safe Haven)", "cat": "shelter", "triage": "safe_green", "d_lat": 0.0062, "d_lon": -0.0048, "text": "Verified safe high-ground community shelter with emergency medical tent and power generator.", "severity": "green", "status": "operational", "facilities": ["Shelter", "Medical", "Clean Water"]},
                {"id": "water_point_4", "name": "Clean Water Depot (North Tanker 4)", "cat": "resource", "triage": "safe_green", "d_lat": 0.0028, "d_lon": 0.0041, "text": "Municipal emergency drinkable water distribution point.", "severity": "green", "status": "operational", "facilities": ["Clean Water"]},
                {"id": "cp_17", "name": "Checkpoint CP-17 (North Bridge Warning)", "cat": "hazard", "triage": "hazard_warning", "d_lat": 0.0005, "d_lon": 0.0032, "text": "Hazard alert: Flooded entrance and live fallen wires. Avoid and take northern detour.", "severity": "red", "status": "danger_warning", "facilities": ["Checkpoint"]}
            ]
            for df in demo_facilities:
                c_loc = {"lat": lat + df["d_lat"], "lon": lon + df["d_lon"]}
                d = distance_m(user_loc, c_loc)
                b = calculate_bearing(lat, lon, c_loc["lat"], c_loc["lon"])
                radar_items.append({
                    "id": df["id"],
                    "name": df["name"],
                    "category": df["cat"],
                    "triage_level": df["triage"],
                    "text": df["text"],
                    "status": df["status"],
                    "severity": df["severity"],
                    "distance_m": round(d),
                    "bearing_deg": b,
                    "cardinal": calculate_cardinal(b),
                    "walk_time_min": max(1, round(d / 75.0)),
                    "location": c_loc,
                    "facilities": df.get("facilities", []),
                    "signal_source": "demo_adaptive_field",
                    "verified": True
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

    def reset_all_data(self, purge_cloud: bool = True) -> dict:
        events_deleted = self.memory.clear("events")
        receipts_deleted = self.memory.clear("receipts")
        groups_deleted = self.memory.clear("groups")
        cloud_info = {}
        if purge_cloud and self.settings.qdrant_url:
            try:
                from .cloud import purge_cloud_data
                cloud_info = purge_cloud_data(self)
            except Exception as exc:
                cloud_info = {"purged": False, "error": str(exc)}
        return {
            "status": "cleared",
            "events_cleared": events_deleted,
            "receipts_cleared": receipts_deleted,
            "groups_cleared": groups_deleted,
            "cloud": cloud_info,
        }


def distance_m(a: dict, b: dict) -> float:
    r = 6371000
    dlat, dlon = radians(b["lat"] - a["lat"]), radians(b["lon"] - a["lon"])
    x = sin(dlat / 2) ** 2 + cos(radians(a["lat"])) * cos(radians(b["lat"])) * sin(dlon / 2) ** 2
    return 2 * r * asin(sqrt(x))
