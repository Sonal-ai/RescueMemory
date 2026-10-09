"""Seed high-fidelity demonstration disaster data into all 4 Qdrant Cloud collections.

Populates:
1. rescue_approved_guides - Authoritative medical/survival guidelines
2. rescue_public_events   - Public hazards, safe shelters, clean water points
3. rescue_group_events    - Tactical reconnaissance, supply drops, team comms
4. rescue_responder_events- Emergency casualty SOS alerts, critical rescues
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from uuid import NAMESPACE_URL, uuid5
import sys

# Configure UTF-8 output for Windows console
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

from dotenv import load_dotenv
from fastembed import TextEmbedding
from qdrant_client import QdrantClient, models


def _point_id(record_id: str) -> str:
    return str(uuid5(NAMESPACE_URL, record_id))


def canonical(obj: dict) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()


def make_event(
    event_id: str,
    kind: str,
    visibility: str,
    text: str,
    lat: float,
    lon: float,
    severity: str = "yellow",
    status: str = "active",
    reporter_id: str = "central-cmd",
    source_role: str = "central",
    group_id: str | None = None,
    verified: bool = True,
) -> dict:
    if len(event_id) != 64:
        event_id = hashlib.sha256(event_id.encode()).hexdigest()
    observed_at = datetime.now(timezone.utc).isoformat()
    body = {
        "kind": kind,
        "visibility": visibility,
        "text": text,
        "severity": severity,
        "status": status,
        "location": {"lat": lat, "lon": lon},
        "observed_at": observed_at,
        "reporter_id": reporter_id,
        "origin_device": "central-hub",
        "source_role": source_role,
        "verified": verified,
        "expires_at": None,
    }
    if group_id:
        body["group_id"] = group_id

    content_hash = hashlib.sha256(canonical(body)).hexdigest()
    return {
        "id": event_id,
        "content_hash": content_hash,
        **body,
    }


def ensure_collection(client: QdrantClient, name: str, is_event: bool = True) -> None:
    if not client.collection_exists(name):
        client.create_collection(
            name,
            vectors_config={"dense": models.VectorParams(size=384, distance=models.Distance.COSINE)},
        )
    fields = (
        ("kind", models.PayloadSchemaType.KEYWORD),
        ("visibility", models.PayloadSchemaType.KEYWORD),
        ("group_id", models.PayloadSchemaType.KEYWORD),
        ("location", models.PayloadSchemaType.GEO),
    ) if is_event else (
        ("id", models.PayloadSchemaType.KEYWORD),
        ("category", models.PayloadSchemaType.KEYWORD),
    )
    for field, kind in fields:
        try:
            client.create_payload_index(name, field, kind)
        except Exception:
            pass


def main() -> None:
    load_dotenv()
    url = os.getenv("QDRANT_URL", "")
    key = os.getenv("QDRANT_API_KEY", "")

    if not url.startswith("https://") or not key:
        raise SystemExit("Missing valid HTTPS QDRANT_URL and QDRANT_API_KEY in .env")

    print(f"Connecting to Qdrant Cloud at {urlparse(url).hostname}...")
    client = QdrantClient(url=url, api_key=key, timeout=30)
    embedder = TextEmbedding(model_name="sentence-transformers/all-MiniLM-L6-v2")

    # ---------------------------------------------------------
    # 1. rescue_approved_guides
    # ---------------------------------------------------------
    guides = [
        {
            "id": "guide-cpr-unresponsive",
            "title": "Adult Unresponsive and Not Breathing Normally (Hands-Only CPR)",
            "category": "cpr",
            "summary": "Immediate hands-only cardiopulmonary resuscitation for adults in cardiac arrest.",
            "steps": [
                "Verify responsiveness and check for normal breathing or gasping.",
                "Call local emergency services (112/911) and send for an AED immediately.",
                "Place heel of hand in center of chest, other hand on top with interlocked fingers.",
                "Push hard and fast at 100 to 120 compressions per minute to a depth of 2 inches (5 cm).",
                "Allow chest to completely recoil between compressions. Continue until emergency personnel arrive."
            ],
            "warnings": [
                "Do not stop CPR unless casualty shows signs of life or professional help relieves you.",
                "Do not perform compressions if the casualty is breathing normally."
            ],
            "keywords": "cpr chest compressions cardiac arrest unconscious no breathing unresponsive emergency life support",
            "source": "AHA & Red Cross Emergency Cardiac Care",
            "reviewer": "Disaster Command Clinical Board",
            "version": 1,
            "authority_tag": "verified-auth-2026",
        },
        {
            "id": "guide-tourniquet-arterial-bleed",
            "title": "Severe Arterial Bleeding and Tourniquet Application",
            "category": "hemorrhage",
            "summary": "Life-saving intervention for rapid, spurting, or bright red blood loss from limbs.",
            "steps": [
                "Apply immediate direct manual pressure over the wound using clean cloth or dressing.",
                "If bleeding does not stop and is on an arm or leg, apply a commercial or improvised windlass tourniquet.",
                "Position 2 to 3 inches above the wound toward the heart (never over a joint).",
                "Tighten rod/windlass until the arterial bleeding completely stops and the distal pulse is absent.",
                "Secure windlass and write exact application time (e.g., T 14:30) on casualty's forehead."
            ],
            "warnings": [
                "Never loosen or remove a tourniquet once applied; only surgical teams may release it.",
                "Do not use thin wire or string which can slice into flesh."
            ],
            "keywords": "arterial bleeding spurting blood deep wound tourniquet windlass severe hemorrhage limb trauma",
            "source": "Stop The Bleed & Tactical Combat Casualty Care (TCCC)",
            "reviewer": "Disaster Command Clinical Board",
            "version": 1,
            "authority_tag": "verified-auth-2026",
        },
        {
            "id": "guide-water-purification",
            "title": "Emergency Drinking Water Disinfection and Filtration",
            "category": "water",
            "summary": "Purifying suspect floodwater or contaminated surface water for safe human consumption.",
            "steps": [
                "Filter cloudy or turbid water through a clean cotton cloth, coffee filter, or sand to remove silt.",
                "Bring clear water to a vigorous rolling boil for at least 1 full minute (3 minutes at high altitude).",
                "If boiling is impossible, add 2 drops of unscented 6% household bleach per liter (4 drops if cloudy).",
                "Mix thoroughly and let stand undisturbed for 30 minutes. Water should have a slight chlorine scent."
            ],
            "warnings": [
                "Boiling and bleach do NOT remove chemical contaminants, heavy metals, or fuel residues.",
                "Never drink untreated stagnant floodwater."
            ],
            "keywords": "water purification drinking water disinfection boiling bleach filtration cholera diarrhea prevention",
            "source": "CDC & WHO Emergency Water Safety Guidelines",
            "reviewer": "Disaster Command Clinical Board",
            "version": 1,
            "authority_tag": "verified-auth-2026",
        },
        {
            "id": "guide-fracture-splinting",
            "title": "Suspected Bone Fracture Immobilization and Splinting",
            "category": "trauma",
            "summary": "Stabilizing deformed or broken limbs to prevent vascular and nerve damage during transport.",
            "steps": [
                "Keep casualty still; do not attempt to straighten or manipulate deformed bones or joints.",
                "Support injured limb with rolled blankets, towels, or rigid cardboard/branches on both sides.",
                "Secure the splint above and below the fracture site using cloth strips, bandanas, or tape.",
                "Check circulation (fingers/toes warm, capillary refill < 2s) to ensure the splint is not too tight.",
                "Keep injured limb elevated above heart level if comfortable and open wounds are dressed."
            ],
            "warnings": [
                "Never force a protruding bone back under the skin (open fracture).",
                "Do not allow casualty to bear weight or walk on a suspected lower extremity fracture."
            ],
            "keywords": "broken leg broken arm fracture bone splinting immobilization trauma cannot walk sprain",
            "source": "Red Cross Emergency First Aid",
            "reviewer": "Disaster Command Clinical Board",
            "version": 1,
            "authority_tag": "verified-auth-2026",
        },
        {
            "id": "guide-burn-care",
            "title": "Thermal and Electrical Burn Emergency Care",
            "category": "burns",
            "summary": "Immediate cooling and protective dressing for flame, steam, or hot liquid burns.",
            "steps": [
                "Remove casualty from heat source. Ensure electrical power is off before touching electrical burn victims.",
                "Cool the burn immediately under cool (not freezing/ice) clean running water for 10 to 20 minutes.",
                "Gently remove tight jewelry, watches, or loose clothing before swelling begins.",
                "Cover burn loosely with a sterile, non-adherent dressing or clean plastic food wrap.",
                "Keep casualty warm with dry blankets to prevent hypothermia."
            ],
            "warnings": [
                "Do not apply ice, butter, grease, toothpaste, or ointments to burn wounds.",
                "Never burst blisters as this increases severe infection risk."
            ],
            "keywords": "burn thermal burns fire scald electrical burn blisters cooling dressing",
            "source": "British Red Cross & WHO Burn Care",
            "reviewer": "Disaster Command Clinical Board",
            "version": 1,
            "authority_tag": "verified-auth-2026",
        },
        {
            "id": "guide-hypothermia-rewarming",
            "title": "Severe Hypothermia and Cold Water Exposure Management",
            "category": "environmental",
            "summary": "Passive and active gradual rewarming for survivors submerged in floodwaters or freezing rain.",
            "steps": [
                "Move survivor to sheltered dry area. Gently remove wet clothing and pat skin dry.",
                "Wrap in multiple dry wool blankets or thermal foil space blanket, covering the head.",
                "Apply gentle external warmth (warm water bottles wrapped in cloth) to chest, neck, and groin.",
                "If conscious and swallowing normally, provide warm, sweetened non-caffeinated fluids.",
                "Handle the casualty very gently; rough movement can trigger fatal ventricular fibrillation."
            ],
            "warnings": [
                "Do not rub or massage cold extremities.",
                "Do not apply direct intense heat (radiators, boiling water) which can cause shock and burn skin."
            ],
            "keywords": "hypothermia shivering cold exposure flood water rewarming frostbite shock",
            "source": "Wilderness Medical Society Clinical Guidelines",
            "reviewer": "Disaster Command Clinical Board",
            "version": 1,
            "authority_tag": "verified-auth-2026",
        },
    ]

    # ---------------------------------------------------------
    # 2. rescue_public_events (Hazards, Safe Shelters, Resources)
    # Reference coordinates around Delhi NCR (28.7495° N, 77.1172° E)
    # ---------------------------------------------------------
    public_events = [
        make_event(
            "pub-shelter-north-gate",
            kind="checkpoint",
            visibility="public",
            text="Safe High Ground Shelter: North Gate Community Complex open. 450 capacity, clean drinking water, emergency medical staff, and diesel generator power active.",
            lat=28.7512,
            lon=77.1190,
            severity="green",
            status="open",
            reporter_id="cmd-logistics",
        ),
        make_event(
            "pub-shelter-central-high",
            kind="checkpoint",
            visibility="public",
            text="Designated Safe Shelter: Central High School Gymnasium. Capacity 300, dry cots and food distribution operational.",
            lat=28.7460,
            lon=77.1140,
            severity="green",
            status="open",
            reporter_id="cmd-logistics",
        ),
        make_event(
            "pub-hazard-bridge-collapse",
            kind="hazard",
            visibility="public",
            text="HAZARD ALERT: Main Canal Bridge collapsed. Submerged live 11kV electrical power cables in water. Complete perimeter barricade. DO NOT ATTEMPT CROSSING.",
            lat=28.7480,
            lon=77.1215,
            severity="red",
            status="danger",
            reporter_id="cmd-recon",
        ),
        make_event(
            "pub-hazard-gas-leak",
            kind="hazard",
            visibility="public",
            text="CHEMICAL HAZARD: Industrial LPG cylinder venting and gas vapor cloud near Sector 16 Depot. Evacuate 500m upwind immediately. Avoid all open flames.",
            lat=28.7535,
            lon=77.1120,
            severity="red",
            status="active",
            reporter_id="fire-unit-3",
        ),
        make_event(
            "pub-water-station-alpha",
            kind="resource",
            visibility="public",
            text="Clean Water Distribution Point: Red Cross mobile reverse osmosis tanker active at Sector 14 Public Park. Free 20L containers available.",
            lat=28.7490,
            lon=77.1165,
            severity="green",
            status="active",
            reporter_id="red-cross-team",
        ),
        make_event(
            "pub-hazard-flooded-underpass",
            kind="hazard",
            visibility="public",
            text="ROAD BLOCK: Outer Ring Road underpass submerged under 1.8 meters of floodwater. Two submerged vehicles blocking roadway. Use elevated bypass road.",
            lat=28.7440,
            lon=77.1230,
            severity="yellow",
            status="blocked",
            reporter_id="traffic-police-7",
        ),
    ]

    # ---------------------------------------------------------
    # 3. rescue_group_events (Tactical Volunteer & Recon Team Feeds)
    # ---------------------------------------------------------
    group_events = [
        make_event(
            "grp-recon-sector4-cleared",
            kind="resource",
            visibility="group",
            text="Team Bravo Recon: Sector 4 residential perimeter cleared. 14 civilians guided to North Gate Shelter. Secondary access route safe for light trucks.",
            lat=28.7505,
            lon=77.1180,
            severity="green",
            status="completed",
            group_id="volunteer-corps",
            reporter_id="vol-bravo-lead",
            source_role="volunteer",
        ),
        make_event(
            "grp-supplies-depot-stocked",
            kind="resource",
            visibility="group",
            text="Logistics Unit 2: Staging Depot 3 stocked with 600 MRE ration packs, 150 thermal blankets, and 40 basic trauma kits. Distribution team standing by.",
            lat=28.7475,
            lon=77.1135,
            severity="green",
            status="stocked",
            group_id="volunteer-corps",
            reporter_id="vol-supply-mgr",
            source_role="volunteer",
        ),
        make_event(
            "grp-vhf-repeater-active",
            kind="resource",
            visibility="group",
            text="Comms Unit: Tactical emergency VHF repeater operational on 145.500 MHz from Water Tower summit. Mesh nodes bridging packets via UDP port 8888.",
            lat=28.7520,
            lon=77.1150,
            severity="green",
            status="operational",
            group_id="volunteer-corps",
            reporter_id="vol-radio-op",
            source_role="volunteer",
        ),
        make_event(
            "grp-structural-warning-warehouse",
            kind="hazard",
            visibility="group",
            text="Safety Advisory: Cold Storage Warehouse roof trusses bowed under storm debris. Team members must wear hard hats and maintain 15m perimeter.",
            lat=28.7455,
            lon=77.1200,
            severity="yellow",
            status="caution",
            group_id="volunteer-corps",
            reporter_id="vol-safety-insp",
            source_role="volunteer",
        ),
    ]

    # ---------------------------------------------------------
    # 4. rescue_responder_events (Restricted Casualty SOS Alerts)
    # ---------------------------------------------------------
    responder_events = [
        make_event(
            "resp-sos-trapped-debris",
            kind="sos",
            visibility="responders",
            text="🚨 CRITICAL SOS: 2 civilians trapped under collapsed residential masonry wall. One casualty unconscious with shallow breathing. Extraction equipment required.",
            lat=28.7485,
            lon=77.1158,
            severity="red",
            status="needs_help",
            reporter_id="survivor-phone-89",
            source_role="survivor",
            verified=False,
        ),
        make_event(
            "resp-sos-femoral-bleed",
            kind="sos",
            visibility="responders",
            text="🚨 URGENT MEDICAL SOS: Adult male with severe spurting laceration on right thigh from shattered glass. Improvised belt tourniquet applied at 14:15. Immediate paramedic evacuation requested.",
            lat=28.7500,
            lon=77.1142,
            severity="red",
            status="needs_help",
            reporter_id="survivor-phone-12",
            source_role="survivor",
            verified=False,
        ),
        make_event(
            "resp-sos-mobility-trauma",
            kind="sos",
            visibility="responders",
            text="🚨 MOBILITY SOS: Elderly survivor with compound fracture in lower left leg. Immobile, rising flood water reached ground floor. Stretcher evacuation team needed.",
            lat=28.7468,
            lon=77.1175,
            severity="red",
            status="needs_help",
            reporter_id="survivor-phone-44",
            source_role="survivor",
            verified=False,
        ),
        make_event(
            "resp-sos-rooftop-stranding",
            kind="sos",
            visibility="responders",
            text="🚨 RESCUE SOS: Family of 4 (including infant) stranded on flat residential roof due to flash flooding. Ground floor completely inundated. Waving orange fabric.",
            lat=28.7525,
            lon=77.1220,
            severity="red",
            status="needs_help",
            reporter_id="survivor-phone-07",
            source_role="survivor",
            verified=False,
        ),
        make_event(
            "resp-sos-acute-asthma-smoke",
            kind="sos",
            visibility="responders",
            text="🚨 RESPIRATORY SOS: 8-year-old child experiencing severe respiratory distress and cyanosis after inhaling smoke from nearby transformer explosion. Oxygen support needed.",
            lat=28.7450,
            lon=77.1130,
            severity="red",
            status="needs_help",
            reporter_id="survivor-phone-61",
            source_role="survivor",
            verified=False,
        ),
    ]

    # ---------------------------------------------------------
    # Upload batches to Qdrant Cloud with retries
    # ---------------------------------------------------------
    collections_data = [
        ("rescue_approved_guides", guides, False, lambda g: f"{g['title']} {g['keywords']} {g['summary']}"),
        ("rescue_public_events", public_events, True, lambda e: e["text"]),
        ("rescue_group_events", group_events, True, lambda e: e["text"]),
        ("rescue_responder_events", responder_events, True, lambda e: e["text"]),
    ]

    import time

    print("\nEnsuring collections and upserting data with 384-d dense embeddings...\n")
    for col_name, items, is_evt, text_fn in collections_data:
        texts = [text_fn(item) for item in items]
        print(f"Generating FastEmbed embeddings for {len(items)} items in {col_name}...")
        vectors = [v.tolist() for v in embedder.embed(texts)]

        points = [
            models.PointStruct(
                id=_point_id(item["id"]),
                vector={"dense": vec},
                payload=item,
            )
            for item, vec in zip(items, vectors)
        ]

        uploaded = False
        for attempt in range(1, 4):
            try:
                # Use a fresh connection per batch to prevent cloud idle socket disconnect
                c = QdrantClient(url=url, api_key=key, timeout=60)
                ensure_collection(c, col_name, is_event=is_evt)
                c.upsert(col_name, points=points, wait=True)
                count = c.count(col_name).count
                print(f"[OK] {col_name}: {count} points stored successfully.")
                c.close()
                uploaded = True
                break
            except Exception as e:
                print(f"Attempt {attempt} for {col_name} failed: {e}. Retrying in 2s...")
                time.sleep(2)
        if not uploaded:
            print(f"[ERROR] Failed to upload {col_name}")

    print("\n=========================================================")
    print("SUCCESS: ALL 4 QDRANT CLOUD COLLECTIONS SEEDED SUCCESSFULLY!")
    print("=========================================================")


if __name__ == "__main__":
    main()
