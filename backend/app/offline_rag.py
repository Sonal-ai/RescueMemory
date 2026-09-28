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
    return {w for w in re.findall(r"[a-z]{3,}", text.lower()) if w not in STOP_WORDS}


# Built-in offline emergency protocols for immediate offline triage and guidance
OFFLINE_PROTOCOLS = {
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


def detect_intent(query: str) -> tuple[str, str, dict[str, Any] | None]:
    """Classifies user intent and determines the target app section and suggested action."""
    q = query.lower().replace("’", "'")

    # Inability to walk / mobility trauma
    mobility_patterns = (
        "can't walk", "cant walk", "cannot walk", "unable to walk",
        "can't move", "cant move", "cannot move", "broken leg", "injured leg",
        "twisted ankle", "broken ankle", "fracture", "immobile", "sprained ankle"
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

    # Shelter & evacuation location seeking
    shelter_patterns = ("where is shelter", "find shelter", "evacuation", "safe zone", "refuge", "camp alpha", "north gate")
    if any(p in q for p in shelter_patterns):
        action = {
            "kind": "map",
            "label": "Open nearby map",
            "button_text": "View Shelters on Map",
            "target_tab": "map",
            "section": "nearby_map",
            "urgency": "normal",
            "intent": "shelter_search",
        }
        return "shelter_search", "nearby_map", action

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

    # Case 1: Inability to walk / Severe Trauma / Urgent SOS
    if intent in ("mobility_sos", "life_sos"):
        sections.append(
            "You may need urgent help. Review the responder SOS below, add your location, and save it when ready. "
            "If possible, contact local emergency services or a nearby responder. Nothing was shared by this question alone."
        )

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

    # Case 2: Matching reference cards from Qdrant Edge (with Resource Assessment)
    if matching_cards:
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
                c_lines.append(f"⚠️ Warning: {' '.join(card['warnings'][:2])}")
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
            sections.append("\n".join(p_lines))

    if not sections:
        sections.append(
            "I could not find directly matching guidance or observations in this device's memory. "
            "Ask a nearby responder or try another search. You can still report what you observed locally."
        )

    return "\n\n".join(sections), action

