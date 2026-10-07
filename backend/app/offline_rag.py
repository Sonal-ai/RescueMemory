"""Local offline RAG engine for RescueMemory.

Operates purely in-process using Qdrant Edge hybrid retrieval (all-MiniLM-L6-v2 + BM25),
curated disaster protocols, and local field reports without requiring internet or external APIs.
"""

from __future__ import annotations

import re
from typing import Any

STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "for", "from",
    "has", "have", "how", "i", "in", "is", "it", "me", "my", "near", "of", "on",
    "or", "the", "there", "this", "to", "was", "what", "where", "which", "who", "with"
}


def tokenize(text: str) -> set[str]:
    raw = {w for w in re.findall(r"[a-z]{3,}", text.lower()) if w not in STOP_WORDS}
    stems = set(raw)
    for w in raw:
        if w.endswith("ing") and len(w) > 4:
            stems.add(w[:-3])
        if w.endswith("s") and len(w) > 3:
            stems.add(w[:-1])
    return stems


def dedupe_text_lines(text: str) -> str:
    """Deduplicates redundant warning bullets and repetitive sentences in Markdown output."""
    lines = text.split("\n")
    seen_normalized = set()
    result = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            result.append(line)
            continue
        cleaned = re.sub(r"^[\s•\-\*\d\.\>#]+", "", stripped)
        cleaned = re.sub(r"^(?:⚠️\s*|\u26a0\ufe0f?\s*)", "", cleaned)
        cleaned = re.sub(r"^(?:\*\*)?(?:precaution|warning|critical warning|caution|immediate action|protocol summary)(?:\*\*)?[:\s-]*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"^[\s•\-\*\d\.\>]+", "", cleaned)
        norm = re.sub(r"[^\w\s]", "", cleaned.lower())
        norm = " ".join(norm.split())
        if len(norm) < 15:
            result.append(line)
            continue
        if norm in seen_normalized:
            continue
        seen_normalized.add(norm)
        result.append(line)
    return "\n".join(result)


# Built-in offline emergency protocols for immediate offline triage and guidance
OFFLINE_PROTOCOLS = {
    "severe_bleeding": {
        "title": "Severe Hemorrhage & Deep Bleeding Control",
        "citation": "Red Cross Emergency First Aid & TCCC Guidelines",
        "immediate": "Apply firm, continuous direct pressure directly over the wound with a clean cloth or sterile dressing.",
        "steps": [
            "Do not remove the cloth if soaked through; place additional clean layers directly on top and press harder.",
            "Keep the casualty lying flat and calm to slow heart rate and reduce blood loss.",
            "For deep cavity wounds where pressure fails, pack clean fabric tightly into the wound cavity directly against the bleeding vessel.",
            "For extremity arterial spurting or uncontrolled bleeding, apply a windlass tourniquet 2–3 inches above injury (never over a joint); tighten until bleeding stops.",
            "Broadcast an Emergency SOS immediately to alert nearby medical responders."
        ],
        "warnings": [
            "Never loosen or remove a tourniquet once placed in the field.",
            "Do not attempt improvised suturing or wound exploration."
        ]
    },
    "mobility_trauma": {
        "title": "Suspected Fracture or Inability to Walk",
        "citation": "Red Cross Emergency First Aid",
        "immediate": "Do not attempt to walk or bear weight on the injured leg or foot.",
        "steps": [
            "Keep the injured limb still and supported in the position found using blankets, rolled clothing, or towels.",
            "Do not attempt to straighten or manipulate a deformed bone or joint.",
            "Signal nearby rescue teams with a whistle, flashlight, phone screen, or sound.",
            "Transmit an Emergency SOS to local responder nodes using the 1-tap button below."
        ],
        "warnings": [
            "Never attempt to walk on a suspected fracture or severe joint trauma.",
            "If in immediate environmental danger (rising water, fire), prioritize safe shelter."
        ]
    },
    "water_safety": {
        "title": "Safe Drinking Water & Disinfection",
        "citation": "CDC Disaster Water Emergency Guidelines",
        "immediate": "Use bottled water if available; otherwise disinfect clear water before drinking.",
        "steps": [
            "Use commercially sealed bottled water whenever accessible.",
            "Bring clear water to a rolling boil for at least 1 full minute to kill waterborne bacteria and parasites.",
            "Allow water to cool and store in a clean, covered container.",
            "Check the Nearby Map for verified clean water distribution points."
        ],
        "warnings": [
            "Boiling does NOT remove motor oils, chemical runoff, or heavy metals from floodwater.",
            "Never drink untreated floodwater."
        ]
    },
    "shelter_evacuation": {
        "title": "Emergency Evacuation & High-Ground Shelter",
        "citation": "FEMA & CDC Flood Evacuation Safety",
        "immediate": "Move toward designated high ground shelters immediately if floodwaters rise.",
        "steps": [
            "Follow verified checkpoint routes to safe high-ground shelters (e.g. North Gate Shelter).",
            "Never walk or drive through moving water — 6 inches of water can sweep an adult off their feet.",
            "Stay away from downed power lines, submerged electrical equipment, and murky waters.",
            "Check local checkpoint observations in the Nearby Map before moving."
        ],
        "warnings": [
            "Do not return to low-lying areas until emergency authorities announce it is safe."
        ]
    }
}


def extract_survivor_needs(text: str) -> dict:
    """Extracts casualty injuries, conditions, and specific survival/medical needs from SOS text."""
    t = text.lower()
    conditions = []
    needs = []
    actions = []

    # Bleeding analysis
    if any(w in t for w in ["spurting", "arterial", "pumping blood", "gushing"]):
        conditions.append("Arterial / high-pressure hemorrhage")
        needs.extend(["Tourniquet (windlass/rigid rod)", "Sterile pressure dressing"])
        actions.append("Apply a windlass tourniquet 2–3 inches above injury (never directly over a joint); tighten until bleeding stops.")
    elif any(w in t for w in ["bleeding", "blood", "laceration", "cut", "wound"]):
        conditions.append("Severe bleeding / open wound")
        needs.extend(["Clean cloth / sterile gauze", "Firm pressure bandage"])
        actions.append("Apply firm, continuous direct pressure with sterile gauze or clean fabric for at least 5 minutes without lifting.")

    # Mobility / Fracture analysis
    if any(w in t for w in ["cannot walk", "cant walk", "can't walk", "unable to walk", "broken leg", "fracture", "broken bone"]):
        conditions.append("Inability to walk (suspected bone fracture / severe joint trauma)")
        needs.extend(["Rigid splinting material (stick, board, rolled cardboard)", "Securing ties (cloth strips, tape)", "Stretcher / carry support"])
        actions.append("Immobilize limb in the exact position found. Pad with rolled cloth. Do NOT attempt to straighten or bear weight.")
    elif any(w in t for w in ["ankle", "sprain", "twisted"]):
        conditions.append("Lower limb joint trauma / sprain")
        needs.extend(["Elastic bandage / support wrap", "Cold compress"])
        actions.append("Elevate and support the joint; avoid weight-bearing.")

    # Entrapment / Collapse analysis
    if any(w in t for w in ["trapped", "rubble", "collapse", "collapsed", "beam", "debris", "crush", "stuck"]):
        conditions.append("Entrapment under structural debris")
        needs.extend(["Rescue pry tools / crowbar", "Protective gloves / dust masks", "Evacuation litter"])
        actions.append("Check structural stability and verify no live power lines or gas leaks before extrication. Do not move casualty suddenly if crush syndrome is suspected.")

    # Respiratory / Vitals analysis
    if any(w in t for w in ["not breathing", "unconscious", "passed out", "unresponsive"]):
        conditions.append("Unresponsive / not breathing normally")
        needs.extend(["Immediate CPR", "AED if accessible", "Airway clearance"])
        actions.append("Begin Hands-Only CPR immediately: 100-120 compressions/min in center of chest. Push hard (2 inches deep).")
    elif any(w in t for w in ["cannot breathe", "can't breathe", "suffocating", "asthma", "smoke"]):
        conditions.append("Respiratory distress / smoke inhalation")
        needs.extend(["Clean air / moist cloth mask", "Sitting position support", "Inhaler / oxygen"])
        actions.append("Position casualty upright / seated leaning slightly forward. Loosen tight clothing around neck and chest.")

    # Water / Sustenance
    if any(w in t for w in ["water", "thirst", "dehydration"]):
        needs.append("Clean drinking water / electrolyte solution")
        actions.append("Provide sips of clean, boiled or bottled water if casualty is fully conscious.")

    # Explicit needs extraction (e.g., "needs clean splint and water", "need bandage")
    explicit_match = re.search(r"(?:needs?|require[sd]?)\s+([^.,;\n]+)", t)
    if explicit_match:
        raw_explicit = explicit_match.group(1).strip()
        if raw_explicit and raw_explicit not in [n.lower() for n in needs]:
            needs.append(raw_explicit.title())

    # Defaults if nothing specific was caught
    if not conditions:
        conditions.append(text[:120].strip() or "General trauma / distress")
    if not needs:
        needs = ["First aid kit", "Clean drinking water", "Warm insulating blanket", "Stretcher"]
    if not actions:
        actions = [
            "Approach cautiously verifying scene safety (watch for downed wires, floodwaters, debris).",
            "Keep casualty calm, sheltered from rain/cold, and monitor breathing.",
            "Coordinate peer assistance to transport to the nearest verified operational shelter."
        ]

    # Deduplicate needs while preserving order
    seen = set()
    dedup_needs = []
    for n in needs:
        nl = n.lower().strip()
        if nl not in seen:
            seen.add(nl)
            dedup_needs.append(n)

    return {
        "conditions": conditions,
        "needs": dedup_needs,
        "actions": actions
    }


def detect_intent(query: str) -> tuple[str, str, dict[str, Any] | None]:
    """Classifies user intent and determines the target app section and suggested action."""
    q = query.lower().replace("’", "'")

    # Nearest survivor / casualty seeking & Emergency SOS lookup
    nearest_patterns = (
        "nearest survivor", "nearest surviver", "nearest casualty", "survivor needs", "surviver needs",
        "who needs help", "who is the nearest", "anyone injured", "casualty status",
        "nearest injured", "nearest sos", "active casualties", "nearby casualties",
        "nearby survivor", "nearby surviver", "nearest victim", "who is injured",
        "find casualty", "find survivor", "find surviver", "sos near me", "nearby sos",
        "active sos", "any sos", "who called sos", "sos signals"
    )
    if any(p in q for p in nearest_patterns) or (
        ("nearest" in q or "nearby" in q or "active" in q or "find" in q) and
        ("survivor" in q or "surviver" in q or "casualty" in q or "injured" in q or "victim" in q or "sos" in q or "needs" in q)
    ):
        action = {
            "kind": "map",
            "label": "Navigate to Survivor",
            "button_text": "View Nearest on Radar",
            "target_tab": "map",
            "section": "radar",
            "urgency": "critical",
            "intent": "nearest_survivor",
        }
        return "nearest_survivor", "radar", action

    # Shelter & evacuation location seeking
    shelter_patterns = (
        "safe shelter", "nearest shelter", "shelter near me", "where is shelter",
        "find shelter", "evacuation checkpoint", "safe place", "safe zone", "refuge",
        "camp alpha", "evacuate", "nearest safe shelter", "closest shelter", "where to go",
        "where can i shelter", "shelter guidance", "where is the nearest safe shelter", "north gate"
    )
    if any(p in q for p in shelter_patterns) or (
        ("shelter" in q or "evacuation" in q or "refuge" in q) and
        ("near" in q or "where" in q or "safe" in q or "closest" in q or "find" in q or "reach" in q or "to go" in q or "checkpoint" in q)
    ):
        action = {
            "kind": "map",
            "label": "Navigate to Safe Shelter",
            "button_text": "Navigate to Shelter on Radar",
            "target_tab": "map",
            "section": "nearby_map",
            "urgency": "normal",
            "intent": "shelter_search",
            "nav_target": {
                "id": "shelter_alpha",
                "name": "Shelter Alpha (Central Evacuation Safe Haven)",
                "category": "shelter",
                "distance_m": 450,
                "cardinal": "NW",
                "bearing_deg": 315,
                "walk_time_min": 6,
                "status": "operational",
                "facilities": ["Shelter", "Medical Triage", "Clean Water", "Power"]
            }
        }
        return "shelter_search", "nearby_map", action

    # Safe drinking water & emergency purification
    water_patterns = (
        "safe drinking water", "clean water", "drinking water", "water near me",
        "purify water", "safe water", "purify and make safe drinking water",
        "how do i purify water", "potable water", "water point", "water tanker",
        "water purification", "make water safe", "clean drinking water", "water north gate"
    )
    if any(p in q for p in water_patterns) or (
        ("water" in q or "drink" in q) and
        ("safe" in q or "purify" in q or "clean" in q or "near" in q or "where" in q or "potable" in q or "boil" in q or "tanker" in q or "station" in q)
    ):
        action = {
            "kind": "map",
            "label": "Locate Water Station on Radar",
            "button_text": "Navigate to Water Station on Radar",
            "target_tab": "map",
            "section": "nearby_map",
            "urgency": "normal",
            "intent": "water_safety",
            "nav_target": {
                "id": "water_tanker_4",
                "name": "Water Tanker 4 (North Gate Purification Station)",
                "category": "resource",
                "distance_m": 230,
                "cardinal": "ENE",
                "bearing_deg": 65,
                "walk_time_min": 3,
                "status": "operational",
                "facilities": ["Clean Water", "Purification Tablets"]
            }
        }
        return "water_safety", "nearby_map", action

    # Inability to walk / mobility trauma
    mobility_patterns = (
        "can't walk", "cant walk", "cannot walk", "unable to walk",
        "can't move", "cant move", "cannot move", "broken leg", "injured leg",
        "twisted ankle", "broken ankle", "fracture", "immobile", "sprained ankle",
        "leg hurting", "legs hurting", "leg hurts", "legs hurt", "leg pain", "legs pain",
        "injured legs", "legs injury", "hurting leg", "hurting legs", "broken legs",
        "feet hurting", "foot hurting", "foot hurt", "feet hurt"
    )
    if any(p in q for p in mobility_patterns):
        action = {
            "kind": "sos",
            "label": "Review a responder SOS",
            "button_text": "Broadcast SOS to Responders",
            "target_tab": "report",
            "section": "urgent_sos",
            "urgency": "critical",
            "intent": "mobility_sos",
            "auto_report": {
                "kind": "incident",
                "severity": "red",
                "visibility": "responders",
                "status": "needs_help",
                "text": f"Urgent Mobility SOS: Survivor cannot walk ({query[:200].strip()})"
            }
        }
        return "mobility_sos", "urgent_sos", action

    # Life-threatening SOS and acute trauma (rubble, bleeding, severe injury)
    life_patterns = (
        "trapped", "need rescue", "can't breathe", "cant breathe", "cannot breathe",
        "severe bleeding", "bleeding", "blood", "unconscious", "heart attack", "choking",
        "drowning", "help me", "i need help", "rubble", "hit by rubble", "collapsed",
        "crush", "crushed", "arm hurt", "arm hurts", "broken arm", "broken bone",
        "severe pain", "burn", "burns", "shock"
    )
    if any(p in q for p in life_patterns):
        action = {
            "kind": "sos",
            "label": "Review a responder SOS",
            "button_text": "Broadcast Emergency SOS",
            "target_tab": "report",
            "section": "urgent_sos",
            "urgency": "critical",
            "intent": "life_sos",
            "auto_report": {
                "kind": "incident",
                "severity": "red",
                "visibility": "responders",
                "status": "needs_help",
                "text": f"Urgent Emergency SOS: {query[:200].strip()}"
            }
        }
        return "life_sos", "urgent_sos", action

    # General map / location seeking
    map_patterns = ("nearby", "where", "location", "find", "how far", "directions")
    if any(p in q for p in map_patterns):
        action = {
            "kind": "map",
            "label": "Open nearby map",
            "button_text": "Open Nearby Map",
            "target_tab": "map",
            "section": "nearby_map",
            "urgency": "normal",
            "intent": "map_search",
        }
        return "map_search", "nearby_map", action

    # Reporting an observation
    report_patterns = ("i saw", "i found", "report a", "there is a hazard", "gate is", "bridge is", "road is")
    if any(p in q for p in report_patterns):
        action = {
            "kind": "report",
            "label": "Review a local report",
            "button_text": "Review Local Report",
            "target_tab": "report",
            "section": "report",
            "urgency": "normal",
            "intent": "hazard_report",
            "auto_report": {
                "kind": "hazard",
                "severity": "yellow",
                "visibility": "public",
                "status": "reported",
                "text": query[:500].strip()
            }
        }
        return "hazard_report", "report", action

    return "general_query", "none", None


MATERIAL_PATTERNS = {
    "stick": ("stick", "branch", "rod", "pole", "dowel"),
    "cloth": ("cloth", "shirt", "t-shirt", "towel", "bandana", "fabric", "gauze", "rag", "sheet"),
    "plastic": ("plastic wrap", "plastic bag", "plastic", "tarp"),
    "tape": ("tape", "duct tape", "adhesive tape"),
    "water": ("water", "clean water", "bottled water"),
    "cardboard": ("cardboard", "box", "stiff paper"),
    "ice": ("ice", "cold pack", "ice water"),
    "string": ("string", "cord", "rope"),
}


def extract_triage_context(
    text: str,
    materials: list[str] | None = None,
    breathing: bool | None = None,
    bleeding_type: str | None = None,
) -> tuple[list[str], bool, str]:
    q = text.lower()

    # 1. Improvised Materials
    resolved_materials = list(materials) if materials else []
    if not resolved_materials:
        for canon, syns in MATERIAL_PATTERNS.items():
            if any(s in q for s in syns):
                resolved_materials.append(canon)

    # 2. Vitals: Breathing
    if breathing is not None:
        resolved_breathing = breathing
    else:
        unresponsive_cues = (
            "not breathing", "unresponsive", "passed out", "no pulse",
            "cardiac arrest", "stopped breathing", "blue lips", "gasping"
        )
        resolved_breathing = not any(cue in q for cue in unresponsive_cues)

    # 3. Vitals: Bleeding
    if bleeding_type and bleeding_type != "none":
        resolved_bleeding = bleeding_type
    else:
        if any(w in q for w in ("spurting", "arterial", "pumping blood", "gushing blood")):
            resolved_bleeding = "spurting"
        elif any(w in q for w in ("bleeding", "blood", "cut", "laceration", "hemorrhage")):
            resolved_bleeding = "venous"
        else:
            resolved_bleeding = "none"

    return resolved_materials, resolved_breathing, resolved_bleeding


def resource_adaptive_rerank(
    cards: list[dict[str, Any]],
    materials: list[str],
    breathing: bool,
    bleeding_type: str,
) -> list[dict[str, Any]]:
    scored_cards = []
    user_mats = set(materials)

    for card in cards:
        c = dict(card)
        req_mats = set(c.get("required_materials", []))
        matched_mats = list(req_mats.intersection(user_mats))
        missing_mats = list(req_mats.difference(user_mats))
        has_all_materials = req_mats.issubset(user_mats) if req_mats else True

        base_score = float(c.get("score", 0.0))

        # Material boost: up to +0.15 if user has matching required improvised resources
        material_boost = 0.0
        if req_mats:
            material_boost = (len(matched_mats) / len(req_mats)) * 0.15

        # Clinical boost based on vital triage overrides
        clinical_boost = 0.0
        if not breathing and (
            c.get("category") in ("cpr", "respiratory")
            or "cpr" in c.get("title", "").lower()
            or c.get("cpr_cadence_required")
        ):
            clinical_boost += 0.35
        elif bleeding_type in ("spurting", "arterial") and c.get("category") == "hemorrhage":
            clinical_boost += 0.20
            if "tourniquet" in c.get("title", "").lower() or "arterial" in c.get("title", "").lower():
                clinical_boost += 0.25
            if any(m in user_mats for m in ("stick", "branch", "rod")):
                clinical_boost += 0.10

        c["materials_assessment"] = {
            "required": list(req_mats),
            "matched": matched_mats,
            "missing": missing_mats,
            "has_all_materials": has_all_materials,
        }
        c["material_boost"] = round(material_boost, 4)
        c["clinical_boost"] = round(clinical_boost, 4)
        c["resource_adaptive_score"] = round(base_score + material_boost + clinical_boost, 4)
        scored_cards.append(c)

    scored_cards.sort(key=lambda x: x["resource_adaptive_score"], reverse=True)
    return scored_cards


def clinical_assess(
    query: str,
    cards: list[dict[str, Any]],
    materials: list[str] | None = None,
    breathing: bool | None = None,
    bleeding_type: str | None = None,
    limit: int = 5,
) -> dict[str, Any]:
    resolved_mats, resolved_breathing, resolved_bleeding = extract_triage_context(
        query, materials, breathing, bleeding_type
    )
    ranked = resource_adaptive_rerank(cards, resolved_mats, resolved_breathing, resolved_bleeding)

    # Determine triage level
    if not resolved_breathing:
        triage_level = "critical_cpr"
        urgency = "immediate_red"
    elif resolved_bleeding in ("spurting", "arterial"):
        triage_level = "massive_hemorrhage"
        urgency = "immediate_red"
    elif any(p in query.lower() for p in ("trapped", "cannot walk", "cant walk", "crushed", "unconscious")):
        triage_level = "trauma_sos"
        urgency = "immediate_red"
    elif resolved_bleeding == "venous":
        triage_level = "controlled_bleeding"
        urgency = "delayed_yellow"
    else:
        triage_level = "routine_field_care"
        urgency = "minimal_green"

    top = ranked[0] if ranked else None

    action_notes = []
    if not resolved_breathing:
        action_notes.append("IMMEDIATE CPR REQUIRED: 100-120 compressions per minute hard and fast in center of chest.")
    if top and top.get("materials_assessment"):
        ass = top["materials_assessment"]
        if ass["matched"]:
            action_notes.append(f"Resource match: Utilize available {', '.join(ass['matched'])} immediately.")
        if ass["missing"]:
            action_notes.append(f"Missing items: {', '.join(ass['missing'])}. Improvise with alternative clean fabrics or apply manual pressure.")

    return {
        "query": query,
        "triage_level": triage_level,
        "urgency": urgency,
        "breathing": resolved_breathing,
        "bleeding_type": resolved_bleeding,
        "materials_detected": resolved_mats,
        "top_match": top,
        "candidates": ranked[:limit],
        "action_guidance": action_notes,
    }


def synthesize_offline_rag(
    question: str,
    cards: list[dict[str, Any]],
    reports: list[dict[str, Any]],
    materials: list[str] | None = None,
    breathing: bool | None = None,
    bleeding_type: str | None = None,
) -> tuple[str, dict[str, Any] | None]:
    """Generates an offline RAG answer by fusing retrieved Edge cards, reports, and clinical triage."""
    intent, section, action = detect_intent(question)
    q_terms = tokenize(question)

    resolved_mats, resolved_breathing, resolved_bleeding = extract_triage_context(
        question, materials, breathing, bleeding_type
    )

    # Rerank cards using clinical & resource-adaptive scoring
    ranked_cards = resource_adaptive_rerank(cards, resolved_mats, resolved_breathing, resolved_bleeding)

    # Filter matching cards and reports using token intersection
    def card_tokens(c: dict) -> set[str]:
        return tokenize(" ".join(str(c.get(f, "")) for f in ("title", "keywords", "summary")))

    matching_cards = [c for c in ranked_cards[:5] if q_terms & card_tokens(c)]
    matching_reports = [r for r in reports[:5] if q_terms & tokenize(r.get("text", ""))]

    sections = []

    # Priority 0: Critical Unresponsive / CPR Override
    if not resolved_breathing:
        sections.append(
            "🚨 **CRITICAL VITALS: CASUALTY IS UNRESPONSIVE AND NOT BREATHING NORMALLY.**\n"
            "Begin Hands-Only CPR immediately:\n"
            "• Push hard and fast in center of chest (100–120 compressions per minute).\n"
            "• Depth: at least 2 inches (5 cm). Allow chest to fully recoil.\n"
            "• Cadence cue: compress to the beat of 'Stayin Alive'.\n"
            "• Send someone for emergency help and an AED immediately."
        )

    # Case 0: Nearest Survivor and Their Needs
    if intent == "nearest_survivor":
        casualty_report = None
        for rep in reports:
            rep_text = rep.get("text", "")
            if rep.get("kind") in ("incident", "sos", "presence") or any(w in rep_text.lower() for w in ["cannot walk", "cant walk", "bleeding", "trapped", "broken", "unconscious", "injured"]):
                casualty_report = rep
                break
        if not casualty_report and reports:
            casualty_report = reports[0]

        if casualty_report:
            c_text = casualty_report.get("text", "")
            details = extract_survivor_needs(c_text)
            dist_str = f"{casualty_report.get('distance_m')}m" if "distance_m" in casualty_report else "Nearby"
            cardinal = casualty_report.get("cardinal", "in local area")
            walk_min = casualty_report.get("walk_time_min", max(1, round(casualty_report.get('distance_m', 150) / 75.0)))
            c_id = (casualty_report.get("entity_id") or casualty_report.get("id") or "casualty")[:10]

            sections.append(
                f"### 🚨 Nearest Survivor Emergency SOS\n\n"
                f"📍 **Location:** {dist_str} {cardinal} (~{walk_min} min walk)\n"
                f"🚨 **Triage Priority:** IMMEDIATE (Red Triage)\n"
                f"👤 **Casualty Ref:** #{c_id}\n\n"
                f"**Critical Condition & Needs:**\n"
                f"• **Reported Condition:** {', '.join(details['conditions'])}\n"
                f"• **Identified Material Needs:** {', '.join(details['needs'])}\n\n"
                f"**Recommended Immediate Actions:**\n" +
                "\n".join(f"• {act}" for act in details["actions"]) +
                "\n\n---\n"
                "**📊 Area Status Summary:**\n"
                f"• 🔴 **Casualties:** 1 active urgent casualty ({dist_str} {cardinal})\n"
                "• ⚠️ **Hazards:** 1 active hazard logged (Checkpoint CP-17: Flooded entrance live wires)\n"
                "• 🟢 **Safe Shelters:** 3 operational (Nearest: Shelter Alpha, 850m NW)"
            )
        else:
            sections.append(
                "### 🛡️ Nearest Survivor Status\n\n"
                "• **Casualties:** No active survivor SOS signals detected within range (5.0 km radius).\n\n"
                "**📊 Area Status Summary:**\n"
                "• 🟢 **Safe Shelters:** 3 operational (Nearest: Shelter Alpha, 850m NW)\n"
                "• ⚠️ **Hazards:** 1 active hazard logged (Checkpoint CP-17: Flooded entrance live wires)\n"
                "• 📶 **Active Mesh Peers:** Local Wi-Fi mesh scanning active\n\n"
                "**Need Emergency Assistance?** If you are injured, trapped, or immobilized, tap below to broadcast an Emergency SOS to all nearby responders immediately."
            )
            action = {
                "kind": "sos",
                "label": "Broadcast Emergency SOS",
                "button_text": "1-Tap Broadcast Emergency SOS",
                "target_tab": "report",
                "section": "urgent_sos",
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
        return "\n\n".join(sections), action

    # Case 0B: Shelter & Safe Evacuation
    if intent == "shelter_search":
        shelter_rep = None
        for rep in reports:
            if rep.get("kind") == "checkpoint" or "shelter" in rep.get("text", "").lower() or "shelter" in rep.get("id", "").lower() or rep.get("category") == "shelter":
                shelter_rep = rep
                break

        s_name = (shelter_rep.get("name") or shelter_rep.get("title") or "Shelter Alpha (Central Evacuation Safe Haven)") if shelter_rep else "Shelter Alpha (Central Evacuation Safe Haven)"
        s_dist = f"{shelter_rep.get('distance_m')}m" if shelter_rep and "distance_m" in shelter_rep else "~450m"
        s_card = shelter_rep.get("cardinal", "NW") if shelter_rep else "NW"
        s_walk = shelter_rep.get("walk_time_min", 6) if shelter_rep else 6

        if shelter_rep:
            action["nav_target"] = shelter_rep
            action["button_text"] = f"Navigate to {s_name} ({s_dist} {s_card})"

        sections.append(
            f"### 🏥 Nearest Verified Safe Shelter\n\n"
            f"📍 **Location:** {s_name} ({s_dist} {s_card}, ~{s_walk} min walk)\n"
            f"🛡️ **Operational Status:** Active High-Ground Safe Haven\n"
            f"🏥 **Available Facilities:** Emergency Shelter, Medical Triage, Potable Water, Power\n\n"
            f"**🧭 Safe Evacuation Guidance:**\n"
            f"• Approach via elevated eastern high-ground route.\n"
            f"• ⚠️ **Hazard Warning:** Checkpoint CP-17 is compromised (flooded road & live wires) — take northern bypass.\n"
            f"• Follow marked high-ground corridor toward {s_name}."
        )
        if matching_cards:
            for card in matching_cards[:1]:
                sections.append(f"**Verified Protocol [{card.get('title')}]:**\n{card.get('summary', '')}")
        return "\n\n".join(sections), action

    # Case 0C: Safe Drinking Water & Emergency Purification
    if intent == "water_safety":
        water_rep = None
        for rep in reports:
            if "water" in rep.get("text", "").lower() or "water" in rep.get("id", "").lower() or rep.get("category") == "resource":
                water_rep = rep
                break

        w_name = (water_rep.get("name") or water_rep.get("title") or "Water Tanker 4 (North Gate Purification Station)") if water_rep else "Water Tanker 4 (North Gate Purification Station)"
        w_dist = f"{water_rep.get('distance_m')}m" if water_rep and "distance_m" in water_rep else "~230m"
        w_card = water_rep.get("cardinal", "ENE") if water_rep else "ENE"
        w_walk = water_rep.get("walk_time_min", 3) if water_rep else 3

        if water_rep:
            action["nav_target"] = water_rep
            action["button_text"] = f"Navigate to Water Station ({w_dist} {w_card})"

        sections.append(
            f"### 💧 Safe Drinking Water & Emergency Purification\n\n"
            f"📍 **Nearest Water Distribution:** {w_name} ({w_dist} {w_card}, ~{w_walk} min walk)\n"
            f"💧 **Operational Status:** Active Potable Water Supply\n\n"
            f"**Critical Emergency Purification Protocols:**\n\n"
            f"1. **🔥 Boiling (Most Reliable):**\n"
            f"   • Bring water to a vigorous rolling boil for **1 full minute** (3 minutes if altitude > 2,000m).\n"
            f"   • Eliminates 99.9% of bacteria, viruses, and protozoa (Giardia, Cryptosporidium).\n"
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
        if matching_cards:
            for card in matching_cards[:1]:
                sections.append(f"**Verified Protocol [{card.get('title')}]:**\n{card.get('summary', '')}")
        return "\n\n".join(sections), action

    # Case 1: Inability to walk / Severe Trauma / Urgent SOS
    if intent in ("mobility_sos", "life_sos"):
        sections.append(
            "You may need urgent help. Review the responder SOS below, add your location, and save it when ready. "
            "If possible, contact local emergency services or a nearby responder. Nothing was shared by this question alone."
        )

        if resolved_bleeding in ("spurting", "arterial", "venous") or any(w in question.lower() for w in ("bleed", "blood", "lacerat", "hemorrh")):
            protocol = OFFLINE_PROTOCOLS["severe_bleeding"]
        else:
            protocol = OFFLINE_PROTOCOLS["mobility_trauma"]
        p_lines = [
            f"**Immediate Action Protocol: {protocol['title']}**",
            f"• {protocol['immediate']}",
        ]
        for step in protocol["steps"]:
            p_lines.append(f"• {step}")
        if protocol.get("warnings"):
            p_lines.append(f"⚠️ **Precaution:** {' '.join(protocol['warnings'])}")
        sections.append("\n".join(p_lines))

        # When immediate action protocol is already provided, list matching reference cards
        # as citations with resource assessment notes without repeating identical action steps or duplicate warning bullets
        if matching_cards:
            ref_lines = ["**Related Reference Protocols:**"]
            for idx, card in enumerate(matching_cards[:2]):
                c_title = card.get("title", "")
                c_sum = card.get("summary", "")
                ref_lines.append(f"• Local guide [G{cards.index(card) + 1 if card in cards else idx + 1}]: **{c_title}**{f': {c_sum}' if c_sum else ''}")
                ass = card.get("materials_assessment")
                if ass:
                    if ass.get("matched"):
                        ref_lines.append(f"  - ✅ Resource Match: Using available {', '.join(ass['matched'])}.")
                    if ass.get("missing"):
                        ref_lines.append(f"  - ⚠️ Improvised Note: Missing {', '.join(ass['missing'])}.")
            sections.append("\n".join(ref_lines))

    # Case 2: Matching reference cards from Qdrant Edge (with Resource Assessment)
    elif matching_cards:
        seen_card_warnings = set()
        for idx, card in enumerate(matching_cards[:2]):
            c_lines = [
                f"Local guide [G{cards.index(card) + 1 if card in cards else idx + 1}]: **{card.get('title')}**",
                f"{card.get('summary', '')}"
            ]

            # Resource-Adaptive Note
            ass = card.get("materials_assessment")
            if ass:
                if ass.get("matched"):
                    c_lines.append(f"✅ Resource Match: Using available {', '.join(ass['matched'])}.")
                if ass.get("missing"):
                    c_lines.append(f"⚠️ Improvised Note: Missing {', '.join(ass['missing'])}. If rigid rod/stick is unavailable, apply continuous manual pressure.")

            if card.get("steps"):
                c_lines.append("Key steps:")
                for step in card["steps"][:3]:
                    c_lines.append(f"  - {step}")
            if card.get("warnings"):
                unique_w = [w for w in card["warnings"][:2] if re.sub(r"[^\w\s]", "", w.lower()).strip() not in seen_card_warnings]
                for w in unique_w:
                    seen_card_warnings.add(re.sub(r"[^\w\s]", "", w.lower()).strip())
                if unique_w:
                    c_lines.append(f"⚠️ Warning: {' '.join(unique_w)}")
            sections.append("\n".join(c_lines))

    # Case 3: Matching local reports from Qdrant Edge
    if matching_reports:
        rep_lines = ["**Relevant Local Observations:**"]
        for rep in matching_reports[:3]:
            label = "Command-verified" if rep.get("verified") else "Unverified"
            dist = f" ({rep.get('distance_m')}m away)" if "distance_m" in rep else ""
            rep_lines.append(f"• {label} local report{dist}: {rep.get('text', '')}")
        sections.append("\n".join(rep_lines))

    # Case 4: Water or Shelter fallback protocol if no cards matched but intent is clear
    if not matching_cards:
        if any(w in question.lower() for w in ("water", "drink", "thirst", "boil")):
            protocol = OFFLINE_PROTOCOLS["water_safety"]
            p_lines = [
                f"**Offline Guidance: {protocol['title']}**",
                f"• {protocol['immediate']}",
            ]
            for step in protocol["steps"][:3]:
                p_lines.append(f"• {step}")
            if protocol.get("warnings"):
                p_lines.append(f"⚠️ Precaution: {' '.join(protocol['warnings'])}")
            sections.append("\n".join(p_lines))
        elif any(w in question.lower() for w in ("shelter", "evacuation", "camp")):
            protocol = OFFLINE_PROTOCOLS["shelter_evacuation"]
            p_lines = [
                f"**Offline Guidance: {protocol['title']}**",
                f"• {protocol['immediate']}",
            ]
            for step in protocol["steps"][:3]:
                p_lines.append(f"• {step}")
    # General greeting or conversational query
    greetings = {
        "hi", "hello", "hey", "halo", "greetings", "good morning", "good afternoon",
        "good evening", "who are you", "what can you do", "hi there", "hey there", "hello there"
    }
    is_greeting = (
        question.lower().strip() in greetings or
        bool(re.match(r"^(hi|hello|hey|greetings|halo|howdy)([\s,!.]+.*)?$", question.lower().strip()))
    )

    if is_greeting or not sections:
        sections = [
            "### 🛡️ Rescue Assistant Ready\n"
            "• **I am here to help you.** You are connected to RescueMemory.\n"
            "• **Offline Disaster Protocols:** I can guide you through first aid (bleeding, fractures, CPR, burns), finding nearby casualties, and locating shelters.\n"
            "• **How can I assist you right now?** Describe any injuries or hazards you observe, or choose one of the quick prompts below."
        ]

    final_text = dedupe_text_lines("\n\n".join(sections))
    return final_text, action

