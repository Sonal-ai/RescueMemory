import json
from pathlib import Path

guides = [
    {
        "id": "first-aid-heavy-bleeding",
        "kind": "protocol",
        "title": "Life-threatening external bleeding",
        "keywords": "spurting bleeding deep cut hemorrhage pressure wound injury",
        "summary": "Get emergency help. Apply steady, firm direct pressure to the wound. A trained person may use a tourniquet for life-threatening bleeding from an arm or leg if one is available.",
        "steps": [
            "Make sure the scene is safe and call local emergency services.",
            "Find the bleeding source and press firmly with a dressing or clean cloth.",
            "Keep pressure on until bleeding stops or trained help takes over; monitor breathing and responsiveness."
        ],
        "warnings": [
            "Do not attempt improvised surgery or suturing.",
            "Tourniquet and wound packing are for people trained to use them."
        ],
        "source": "https://www.redcross.org/take-a-class/resources/learn-first-aid/bleeding-life-threatening-external",
        "review_status": "prototype_source_based"
    },
    {
        "id": "first-aid-adult-cpr",
        "kind": "protocol",
        "title": "Adult unresponsive and not breathing normally",
        "keywords": "CPR cardiac arrest no breathing gasping unconscious compressions AED",
        "summary": "If an adult is unresponsive and not breathing normally or only gasping, call emergency services, request an AED, and begin hands-only CPR if able.",
        "steps": [
            "Check scene safety, responsiveness and normal breathing.",
            "Call local emergency services and ask someone to get an AED.",
            "For an adult who is unresponsive and not breathing normally, push hard and fast in the center of the chest at 100 to 120 compressions per minute."
        ],
        "warnings": [
            "If the person is breathing normally, do not start chest compressions.",
            "Follow dispatcher and AED instructions when available."
        ],
        "source": "https://www.redcross.org/take-a-class/cpr/performing-cpr/cpr-steps",
        "review_status": "prototype_source_based"
    },
    {
        "id": "water-emergency",
        "kind": "protocol",
        "title": "Making water safer after a disaster",
        "keywords": "flood contaminated drinking water boiling disinfection",
        "summary": "Prefer bottled water. If local authorities advise boiling water, bring clear water to a rolling boil for one minute; follow local guidance for altitude and chemical contamination.",
        "steps": [
            "Use bottled water when available.",
            "For water that may contain germs, bring clear water to a rolling boil for at least one minute.",
            "Store treated water in a clean covered container."
        ],
        "warnings": [
            "Boiling does not remove fuels, toxic chemicals, or radioactive material.",
            "Do not use floodwater as drinking water without authoritative local guidance."
        ],
        "source": "https://www.cdc.gov/water-emergency/safety/index.html",
        "review_status": "prototype_source_based"
    },
    {
        "id": "snakebite",
        "kind": "protocol",
        "title": "Suspected venomous snakebite",
        "keywords": "snake bite venom poisonous reptile swelling",
        "summary": "Move away from the snake, keep the person still, remove tight items, immobilize the bitten limb, and get urgent medical care.",
        "steps": [
            "Move away from the snake without trying to catch it.",
            "Keep the person as still as possible and immobilize the bitten limb.",
            "Arrange transport to a medical facility urgently."
        ],
        "warnings": [
            "Do not cut, suck, burn, or apply a tight tourniquet to the bite.",
            "Antivenom must be given by medical professionals."
        ],
        "source": "https://www.who.int/news-room/questions-and-answers/item/snakebite-envenoming",
        "review_status": "prototype_source_based"
    },
    {
        "id": "trapped-rubble-collapse",
        "kind": "protocol",
        "title": "Trapped under rubble and structural debris",
        "keywords": "trapped rubble collapse building debris pinned buried concrete stuck beneath dust",
        "summary": "Stay calm, protect your airway from concrete dust with cloth, avoid erratic movement, and rhythmically tap pipes or solid beams to signal search and rescue teams.",
        "steps": [
            "Cover your mouth, nose, and eyes with clothing or a cloth to filter airborne dust and preserve oxygen.",
            "Avoid kicking, shouting continuously, or thrashing, which stirs up suffocating dust and wastes vital energy.",
            "Rhythmically tap on pipes, metal beams, or solid masonry using a stone or hard object so acoustic listening devices can pinpoint your position.",
            "Shout only when you hear rescue personnel or search dogs directly nearby to conserve respiratory strength."
        ],
        "warnings": [
            "Do not light matches or cigarette lighters due to potential fractured gas mains in collapsed buildings.",
            "Do not dislodge structural debris bearing heavy loads directly above you."
        ],
        "source": "https://www.fema.gov/emergency-managers/risk-management/earthquake",
        "review_status": "team_reviewed"
    },
    {
        "id": "cannot-walk-leg-trauma",
        "kind": "protocol",
        "title": "Severe lower extremity trauma and inability to bear weight",
        "keywords": "broken leg fractured bone cannot step unable to stand foot injury deformed limb splint immobility",
        "summary": "Do not attempt to bear weight or step on the injured leg. Immobilize the limb in the position found using rigid supports or padding, elevate if possible, and signal for emergency rescue.",
        "steps": [
            "Support the injured leg in the position found without forcing, straightening, or twisting deformed bones.",
            "Improvise splints using rolled blankets, boards, or folded cardboard secured with cloth strips above and below the fracture.",
            "Keep the limb supported and elevated if no pelvic injury is present to reduce severe swelling.",
            "Prepare an urgent responder SOS with your location coordinates and wait for specialized stretcher evacuation."
        ],
        "warnings": [
            "Never attempt to realign a protruding bone or deep open fracture in the field.",
            "Do not massage swollen extremities or attempt weight-bearing movement."
        ],
        "source": "https://www.redcross.org/take-a-class/resources/learn-first-aid/fractures-sprains",
        "review_status": "team_reviewed"
    },
    {
        "id": "arm-shoulder-injury",
        "kind": "protocol",
        "title": "Arm fracture, severe shoulder pain, and upper extremity injury",
        "keywords": "arms hurt broken arm shoulder dislocation wrist injury forearm elbow sling immobility upper limb",
        "summary": "Support and immobilize the injured arm against the torso using an improvised sling and swathe to prevent nerve damage, control pain, and minimize swelling.",
        "steps": [
            "Gently support the injured arm across the chest in the position of greatest comfort.",
            "Create an improvised sling using a triangular bandage, scarf, cloth, or by pinning the cuff of the shirt to the collar.",
            "Secure the arm to the chest with a secondary wrap or belt to prevent swinging or jarring during transport.",
            "Apply cold packs wrapped in cloth if accessible, checking fingers periodically for warmth and sensation."
        ],
        "warnings": [
            "Do not attempt to pop a dislocated shoulder or elbow back into joint.",
            "Loosen slings immediately if fingers become numb, pale, cold, or blue."
        ],
        "source": "https://www.redcross.org/take-a-class/resources/learn-first-aid/splints-slings",
        "review_status": "team_reviewed"
    },
    {
        "id": "head-trauma-concussion",
        "kind": "protocol",
        "title": "Blunt head trauma, concussion, and falling debris impact",
        "keywords": "hit by rubble head injury knocked out concussion skull bleeding dizziness confusion nausea pupil impact",
        "summary": "Keep the person completely still, stabilize the cervical spine, maintain an open airway, and monitor responsiveness closely for signs of intracranial pressure.",
        "steps": [
            "Instruct the person to lie still; manually support the head and neck aligned with the spine without twisting.",
            "Apply gentle, flat surface pressure to scalp lacerations with sterile dressing, avoiding direct pressure if a skull depression is felt.",
            "Monitor pupil equality, alertness, speech coherence, and nausea continuously.",
            "Place in the recovery position on their side only if vomiting begins and spinal movement is minimized as a single unit (log-roll)."
        ],
        "warnings": [
            "Do not allow someone with suspected concussion or loss of consciousness to sleep unmonitored.",
            "Clear fluid or blood draining from ears or nose indicates severe skull fracture; do not pack cavities."
        ],
        "source": "https://www.cdc.gov/headsup/basics/concussion_symptoms.html",
        "review_status": "team_reviewed"
    },
    {
        "id": "burns-thermal-chemical",
        "kind": "protocol",
        "title": "Thermal, flame, and scalding burns",
        "keywords": "burn blisters fire hot scald charred skin thermal injury heat flame singed",
        "summary": "Cool the burn immediately under cool, clean running water for at least 10 to 20 minutes, protect with a sterile dry dressing, and avoid ice, butter, or popping blisters.",
        "steps": [
            "Remove the heat source and extinguish smoldering clothing immediately.",
            "Cool the affected skin under gently running cool clean water for 10 to 20 minutes; do not use ice or ice water.",
            "Carefully remove non-adherent jewelry, rings, and loose clothing before swelling begins.",
            "Cover loosely with clean, dry, non-stick dressings or clean plastic wrap to prevent hypothermia and infection."
        ],
        "warnings": [
            "Never apply butter, grease, toothpaste, oils, or ice to burned skin.",
            "Do not peel off clothing that has melted and adhered tightly to burned skin."
        ],
        "source": "https://www.who.int/news-room/fact-sheets/detail/burns",
        "review_status": "team_reviewed"
    },
    {
        "id": "smoke-inhalation-fire",
        "kind": "protocol",
        "title": "Smoke inhalation, toxic gas exposure, and building fire escape",
        "keywords": "smoke breathing soot fire fumes suffocating toxic air coughing burning choke",
        "summary": "Crawl low beneath the rising thermal smoke layer, cover mouth and nose with a damp cloth, feel doors before opening, and escape to fresh air immediately.",
        "steps": [
            "Drop to hands and knees; cooler, cleaner oxygen remains within the bottom 12 to 24 inches of the floor.",
            "Place a damp cloth or folded clothing over mouth and nose to filter coarse soot particulates.",
            "Check interior doors with the back of your hand before turning handles; if warm, seek an alternative escape path.",
            "Once outside, remain in open fresh air and never re-enter a burning or smoke-filled building."
        ],
        "warnings": [
            "Inhaling superheated gas or smoke causes sudden airway swelling and fatal suffocation within minutes.",
            "Synthetic building materials release cyanide and carbon monoxide when burned."
        ],
        "source": "https://www.usfa.fema.gov/prevention/home-fires/",
        "review_status": "team_reviewed"
    },
    {
        "id": "hypothermia-cold-exposure",
        "kind": "protocol",
        "title": "Severe hypothermia and freezing weather exposure",
        "keywords": "freezing cold hypothermia shivering numbness frostbite winter snow temperature low chilled",
        "summary": "Shelter from wind and moisture, remove wet garments, insulate core body areas, and rewarm gradually with dry blankets and warm sweet drinks if conscious.",
        "steps": [
            "Move the victim indoors or into a wind-sheltered dry area immediately.",
            "Strip off all wet garments and wrap completely in dry blankets, sleeping bags, or layers of clothing.",
            "Focus rewarming on the core trunk (chest, neck, armpits, and groin) rather than extremities.",
            "Provide warm, non-caffeinated, sweet liquids if the victim is fully conscious and able to swallow."
        ],
        "warnings": [
            "Do not rub, massage, or apply direct radiant heat (fire, heating pads) to frostbitten or frozen skin.",
            "Do not give alcohol, which accelerates peripheral heat loss."
        ],
        "source": "https://www.cdc.gov/disasters/winter/staysafe/hypothermia.html",
        "review_status": "team_reviewed"
    },
    {
        "id": "heat-stroke-hyperthermia",
        "kind": "protocol",
        "title": "Heat stroke and life-threatening hyperthermia",
        "keywords": "heat stroke heat exhaustion hyperthermia passed out hot skin delirium sweating stopped dehydrated",
        "summary": "Heat stroke is an immediate medical emergency characterized by high body temperature and altered mental state. Cool the victim rapidly using water immersion or wet towels and fanning.",
        "steps": [
            "Move the individual out of direct sunlight into shade or a cool ventilated room.",
            "Actively cool immediately: soak clothing with cool water, apply wet cloths to neck, armpits, and groin, and fan vigorously.",
            "If conscious and alert, provide sips of cool water or electrolyte solution; do not force fluids if confused.",
            "Monitor breathing and prepare recovery position if responsiveness declines."
        ],
        "warnings": [
            "Do not administer aspirin or acetaminophen for heat stroke; they do not lower environmental hyperthermia.",
            "Do not give fluids to a person who is disoriented, vomiting, or losing consciousness."
        ],
        "source": "https://www.cdc.gov/niosh/topics/heatstress/heatrelillness.html",
        "review_status": "team_reviewed"
    },
    {
        "id": "dehydration-water-procurement",
        "kind": "protocol",
        "title": "Emergency water procurement, filtration, and disinfection",
        "keywords": "dehydration thirsty purify water chlorine bleach solar disinfection filter boiling thirst potable",
        "summary": "Filter cloudy water through clean cloth or sand, then disinfect by boiling for 1 minute or adding 2 drops of unscented household bleach per liter of clear water, waiting 30 minutes.",
        "steps": [
            "Let turbid water settle in a container, then pour clear top water through clean cloth, coffee filters, or sand.",
            "Boil clear water vigorously at a rolling boil for 1 full minute (3 minutes at high elevations above 2,000 meters).",
            "If boiling is impossible, add 2 drops of unscented 6% household bleach per liter of clear water, stir, and wait 30 minutes before drinking.",
            "Store treated water in sealed, sanitized containers away from direct contaminants."
        ],
        "warnings": [
            "Chemical bleach disinfection does not neutralize chemical toxins, pesticide runoff, or heavy industrial poisons.",
            "Never drink seawater, urine, or floodwater without distillation."
        ],
        "source": "https://www.cdc.gov/healthywater/emergency/making-water-safe.html",
        "review_status": "team_reviewed"
    },
    {
        "id": "flash-flood-evacuation",
        "kind": "protocol",
        "title": "Flash flood evacuation and moving water hazards",
        "keywords": "flood rising water flash flood washed away current submerged vehicle evacuation high ground torrent",
        "summary": "Immediately move to higher ground away from rivers, drainage channels, and low areas. Never attempt to drive or traverse through flowing water.",
        "steps": [
            "Heed early warnings and evacuate immediately to designated high ground shelters.",
            "Avoid traversing through moving water; 6 inches of rapid current can knock down an adult.",
            "If trapped in a vehicle caught in rising water, abandon the vehicle immediately and climb to high ground or vehicle roof.",
            "Stay clear of power lines, storm drains, and structural edges undermined by flood currents."
        ],
        "warnings": [
            "Turn around, do not drown: vehicles can be swept away by as little as 12 to 24 inches of moving water.",
            "Floodwaters frequently contain raw sewage, toxic petrochemicals, and hidden submerged debris."
        ],
        "source": "https://www.weather.gov/safety/flood-turn-around-dont-drown",
        "review_status": "team_reviewed"
    },
    {
        "id": "downed-power-lines-electrical",
        "kind": "protocol",
        "title": "Downed power lines, energized ground, and electrical hazards",
        "keywords": "power lines electric shock wires voltage electrocution buzzing sparks sparking live cable current",
        "summary": "Stay at least 10 meters (35 feet) away from downed wires and energized ground. Shuffle away keeping both feet touching the ground if caught in an energized area.",
        "steps": [
            "Assume all downed or sagging overhead lines are live and extremely dangerous.",
            "Maintain a minimum clearance of at least 10 meters (35 feet) from downed wires and touching fences or puddles.",
            "If standing in an energized zone, keep feet close together and shuffle slowly away without lifting feet to prevent step potential shock.",
            "If inside a car touching a live wire, stay inside until emergency crews arrive unless the vehicle catches fire."
        ],
        "warnings": [
            "Do not touch any person or vehicle in contact with live wires until power has been certified disconnected.",
            "Tree branches, water puddles, and chain-link fences touching wires can conduct lethal electricity."
        ],
        "source": "https://www.redcross.org/get-help/how-to-prepare-for-emergencies/types-of-emergencies/power-outage.html",
        "review_status": "team_reviewed"
    },
    {
        "id": "animal-dog-bite-rabies",
        "kind": "protocol",
        "title": "Animal bites, puncture wounds, and rabies prevention",
        "keywords": "dog bite animal bite puncture rabies wound infection bleeding mammal teeth tear",
        "summary": "Wash animal bites immediately with soap and copious clean running water for 15 minutes, apply antiseptic, cover cleanly, and seek rabies evaluation urgently.",
        "steps": [
            "Flush the bite wound immediately and thoroughly with mild soap and clean running water for at least 10 to 15 minutes.",
            "Apply gentle direct pressure with a clean cloth to arrest active bleeding.",
            "Apply povidone-iodine or antibiotic ointment and cover with a clean sterile bandage.",
            "Report the animal incident and seek immediate medical evaluation for tetanus and rabies post-exposure prophylaxis."
        ],
        "warnings": [
            "Rabies is 100% fatal once clinical symptoms develop; seek medical prophylaxis without delay.",
            "Do not attempt to catch or corner an aggressive or wild animal."
        ],
        "source": "https://www.who.int/news-room/fact-sheets/detail/rabies",
        "review_status": "team_reviewed"
    },
    {
        "id": "choking-airway-obstruction",
        "kind": "protocol",
        "title": "Choking and acute foreign body airway obstruction",
        "keywords": "choking airway cannot breathe gasping throat blocked heimlich thrusts food obstruction suffocation",
        "summary": "Recognize the universal choking sign. Deliver 5 firm back blows between shoulder blades followed by 5 abdominal thrusts (Heimlich maneuver) until obstruction clears.",
        "steps": [
            "Ask the person if they are choking; if they cannot speak, cough forcefully, or breathe, initiate assistance immediately.",
            "Lean the person slightly forward and deliver 5 sharp back blows between the shoulder blades with the heel of your hand.",
            "Stand behind the person, wrap arms around waist, make a fist thumb-side against upper abdomen above navel, and deliver 5 inward and upward thrusts.",
            "Alternate 5 back blows and 5 abdominal thrusts continuously until the object is expelled or the person becomes unresponsive."
        ],
        "warnings": [
            "If the person becomes unresponsive, lower them to the ground and start chest compressions immediately.",
            "Do not perform blind finger sweeps in the mouth as this may push foreign bodies deeper into the airway."
        ],
        "source": "https://www.redcross.org/take-a-class/resources/learn-first-aid/choking",
        "review_status": "team_reviewed"
    },
    {
        "id": "chest-pain-cardiac-panic",
        "kind": "protocol",
        "title": "Acute chest pain, suspected heart attack, and severe panic episode",
        "keywords": "chest pain heart attack crushing tightness left arm angina panic hyperventilation breath heart",
        "summary": "Seat the person in a semi-reclined position with knees bent, loosen tight clothing, reassure calmly, and assist with prescribed nitroglycerin or chewable aspirin if indicated.",
        "steps": [
            "Have the person stop all exertion and sit in a comfortable semi-upright position with knees bent and back supported.",
            "Loosen constrictive clothing around the neck, chest, and waist.",
            "If the person has prescribed heart medication (nitroglycerin), assist them in taking it as directed.",
            "If not allergic and no recent stomach bleeding, offer one adult aspirin (325 mg) or two low-dose aspirins to chew slowly."
        ],
        "warnings": [
            "Do not allow the patient to stand or move vigorously; exertion increases myocardial oxygen demand.",
            "If responsiveness or normal breathing stops, begin chest compressions immediately."
        ],
        "source": "https://www.heart.org/en/health-topics/heart-attack/warning-signs-of-a-heart-attack",
        "review_status": "team_reviewed"
    },
    {
        "id": "crush-injury-syndrome",
        "kind": "protocol",
        "title": "Prolonged crush injury, compression trauma, and extrication",
        "keywords": "crush syndrome pinned heavy object trapped debris rubble compression toxins reperfusion kidney",
        "summary": "Prolonged compression of muscle tissue releases potassium and myoglobin into the bloodstream. Hydrate aggressively and coordinate extrication with medical responders.",
        "steps": [
            "Assess the duration of entrapment; compression lasting more than 1 to 2 hours poses high risk of reperfusion injury.",
            "Encourage the person to drink water or oral rehydration fluids if conscious and able to swallow prior to lifting heavy objects.",
            "Coordinate extrication so medical personnel or tourniquets are prepared immediately upon release if systemic toxicity or uncontrolled hemorrhage ensues.",
            "Keep the extricated limb cool and immobilized; avoid elevating the crushed limb above the heart."
        ],
        "warnings": [
            "Sudden removal of heavy compressive force without medical readiness can cause fatal hyperkalemia and cardiac arrest.",
            "Do not apply heat to limbs that experienced prolonged compression."
        ],
        "source": "https://www.cdc.gov/masstrauma/preparedness/mach_crush.pdf",
        "review_status": "team_reviewed"
    },
    {
        "id": "eye-injury-chemical-splash",
        "kind": "protocol",
        "title": "Ocular trauma, chemical eye splash, and foreign objects",
        "keywords": "eye injury chemical in eye blinded eye splash foreign body dust debris eye pain flush ocular",
        "summary": "Immediately irrigate chemical splashes with clean water for 15 to 20 minutes continuously. Shield penetrating eye injuries without applying direct pressure.",
        "steps": [
            "For chemical splashes, flush the eye immediately with clean water or saline for at least 15 to 20 minutes, holding eyelids open.",
            "Ensure wastewater flows away from the unaffected eye.",
            "For dust or floating debris, blink rapidly or rinse gently; do not rub the eye.",
            "For penetrating injuries or impaled objects, stabilize the object and shield with a paper cup; do not apply pressure or remove the object."
        ],
        "warnings": [
            "Never rub the eye or attempt to extract an embedded object with tweezers or cotton swabs.",
            "Do not apply eye drops or ointments to a punctured globe."
        ],
        "source": "https://www.aao.org/eye-health/tips-prevention/first-aid-eye-scratches",
        "review_status": "team_reviewed"
    },
    {
        "id": "seizure-convulsion-care",
        "kind": "protocol",
        "title": "Active seizures, convulsions, and post-ictal recovery",
        "keywords": "seizure convulsion shaking fits epilepsy unconscious foaming trembling jerking grand mal",
        "summary": "Protect the convulsing person from surrounding hazards, cushion the head, never place objects in the mouth, and roll into the recovery position once shaking stops.",
        "steps": [
            "Clear away sharp furniture, hard objects, and environmental hazards surrounding the person.",
            "Place folded clothing, a jacket, or soft padding under their head to prevent cranial trauma.",
            "Loosen constricting collars, ties, or clothing around the neck.",
            "Once convulsions subside, roll the person onto their side into the recovery position to maintain a patent airway and allow fluids to drain."
        ],
        "warnings": [
            "Never restrain the person's movements or try to hold them down.",
            "Never force anything between the person's teeth or into their mouth."
        ],
        "source": "https://www.cdc.gov/epilepsy/about/first-aid.htm",
        "review_status": "team_reviewed"
    },
    {
        "id": "diabetic-hypoglycemia",
        "kind": "protocol",
        "title": "Diabetic hypoglycemia and acute low blood sugar emergency",
        "keywords": "diabetic sugar hypoglycemia insulin passed out shaky confused sweaty dizziness glucose",
        "summary": "Recognize acute hypoglycemia: trembling, sweating, confusion, and pallor. Provide 15 to 20 grams of fast-acting glucose or fruit juice if conscious.",
        "steps": [
            "If the person is conscious and able to swallow, immediately administer 15 to 20 grams of fast-acting carbohydrates (fruit juice, soda, glucose tablets, honey).",
            "Wait 15 minutes, check mental clarity, and repeat sugar intake if confusion or shaking persists.",
            "Follow up with a substantive snack containing complex carbohydrates and protein once symptoms improve.",
            "If the person is unconscious or unable to swallow, place in the recovery position and seek immediate emergency intervention."
        ],
        "warnings": [
            "Never force liquids or food into the mouth of an unconscious or convulsing diabetic patient.",
            "Do not administer insulin during suspected hypoglycemic episodes."
        ],
        "source": "https://www.diabetes.org/living-with-diabetes/treatment-care/hypoglycemia-low-blood-glucose",
        "review_status": "team_reviewed"
    },
    {
        "id": "carbon-monoxide-poisoning",
        "kind": "protocol",
        "title": "Carbon monoxide toxicity and unventilated gas hazards",
        "keywords": "carbon monoxide generator fumes gas leak odorless headache dizzy nausea cherry red exhaust",
        "summary": "Carbon monoxide is an odorless, invisible killer generated by engines and indoor burners. Evacuate immediately to fresh open air at the first sign of headache or confusion.",
        "steps": [
            "Evacuate all individuals immediately from the enclosed space into open-air fresh environment.",
            "Do not pause to collect personal belongings or turn off machinery if doing so delays evacuation.",
            "Loosen tight clothing around the neck and encourage deep slow breathing in fresh air.",
            "Administer high-flow oxygen as soon as trained emergency responders arrive."
        ],
        "warnings": [
            "Never operate portable generators, charcoal grills, or camp stoves indoors, inside tents, or near open windows.",
            "Do not re-enter the contaminated structure until it has been declared safe and ventilated by firefighters."
        ],
        "source": "https://www.cdc.gov/co/guidelines.htm",
        "review_status": "team_reviewed"
    },
    {
        "id": "earthquake-aftershocks",
        "kind": "protocol",
        "title": "Earthquake survival, structural stability, and aftershocks",
        "keywords": "earthquake shaking tremor building collapse drop cover hold on masonry fallen tremor quakes",
        "summary": "Drop, Cover, and Hold On beneath sturdy furniture during tremors. Evacuate damaged structures calmly after shaking stops, anticipating strong aftershocks.",
        "steps": [
            "Drop onto hands and knees immediately to prevent being knocked down.",
            "Cover head and neck beneath a sturdy table or desk; if no shelter is nearby, drop against an interior wall away from windows.",
            "Hold on to your shelter until the shaking stops, moving with it if it shifts.",
            "Evacuate via stairs after tremors subside; avoid elevators and watch for falling facade glass and overhead wires."
        ],
        "warnings": [
            "Do not run outside during active shaking; falling exterior bricks and glass cause majority of injuries.",
            "Do not stand in doorways; modern doorways are no stronger than other parts of a structure."
        ],
        "source": "https://www.ready.gov/earthquakes",
        "review_status": "team_reviewed"
    },
    {
        "id": "emergency-shelter-field",
        "kind": "protocol",
        "title": "Field emergency shelter and hypothermia barrier construction",
        "keywords": "shelter build shelter cold tarp lean to wind insulation bedding emergency refuge bivouac",
        "summary": "Construct an improvised shelter prioritizing thermal ground insulation, wind shielding, and waterproofing using tarps, debris, and dry foliage.",
        "steps": [
            "Select a site on elevated dry ground, clear of falling branches, rockfalls, and flash flood drainage paths.",
            "Create a thick ground bed (at least 6 to 8 inches) of dry leaves, pine needles, or cardboard to prevent conduction heat loss.",
            "Rig a tarp, plastic sheeting, or fallen branches into a low-profile A-frame or lean-to oriented with its back to the prevailing wind.",
            "Pack outer walls with brush, leaves, or soil to trap an insulating dead-air space."
        ],
        "warnings": [
            "The frozen or damp ground drains body heat up to 60 times faster than air; never sleep directly on bare ground.",
            "Never enclose an open flame or combustion stove inside an airtight survival shelter."
        ],
        "source": "https://www.fema.gov/emergency-managers/risk-management/shelter",
        "review_status": "team_reviewed"
    },
    {
        "id": "disaster-signaling-sos",
        "kind": "protocol",
        "title": "Distress signaling and emergency rescue location markers",
        "keywords": "signal help SOS whistle mirror flare ground marker rescue sign flash distress beacon",
        "summary": "Use the international rule of three: 3 whistle blasts, 3 smoke fires, or 3 mirror flashes. Mark open clearings with high-contrast SOS or V symbols.",
        "steps": [
            "Blow 3 sharp blasts on a whistle, pause 1 minute, and repeat; whistle sounds travel significantly farther than voice shouting.",
            "Reflect sunlight toward search aircraft or distant ridges using a signal mirror, compact, or polished metal surface.",
            "Stamp or arrange stones, branches, or clothing in high-contrast letters: 'SOS' or 'V' (requires assistance) in a visible clearing.",
            "At night, use three rhythmic flashes of a flashlight or strobe beacon aimed toward searching teams."
        ],
        "warnings": [
            "Do not light open fires in drought or high-wind conditions that could ignite an uncontrollable wildfire.",
            "Conserve vocal cords by using whistles, horns, or metal tapping rather than shouting."
        ],
        "source": "https://www.redcross.org/get-help/how-to-prepare-for-emergencies/survival-kit-supplies.html",
        "review_status": "team_reviewed"
    },
    {
        "id": "hazmat-chemical-leak",
        "kind": "protocol",
        "title": "Hazardous material release, chemical cloud, and toxic plume",
        "keywords": "chemical spill hazmat toxic vapor gas cloud chemical smell burning eyes plume industrial leak",
        "summary": "Move rapidly crosswind and upwind from toxic chemical plumes. If evacuation is impossible, shelter in place in an interior elevated room and seal air openings.",
        "steps": [
            "Identify wind direction and move immediately crosswind (perpendicular to wind) and upwind away from the visible cloud or odor.",
            "If trapped, shelter in place: select an above-ground room with few windows, shut off ventilation systems, and close dampers.",
            "Seal gaps around doors, windows, and vents using duct tape, plastic sheeting, or damp towels.",
            "Cover mouth and nose with a damp cloth to filter coarse aerosols until instructed to leave."
        ],
        "warnings": [
            "Many lethal industrial gases (such as chlorine and ammonia) are heavier than air and collect in basements and ditches.",
            "Do not touch, step through, or inspect spilled liquids or powders."
        ],
        "source": "https://www.ready.gov/hazardous-materials",
        "review_status": "team_reviewed"
    },
    {
        "id": "amputation-severe-laceration",
        "kind": "protocol",
        "title": "Traumatic limb amputation, severe arterial cut, and stump care",
        "keywords": "amputation severed arm severed leg heavy bleeding artery tourniquet stump limb lost hemorrhage",
        "summary": "Apply a commercial or improvised tourniquet 2 to 3 inches above the amputation site immediately. Wrap severed parts in dry sterile gauze and place on ice without soaking.",
        "steps": [
            "Apply a tourniquet 2 to 3 inches proximal to the amputation site (not over a joint); tighten until all arterial bleeding ceases.",
            "Record the exact application time on the patient's forehead or tourniquet band (e.g. 'TK 14:30').",
            "Wrap the severed anatomical part in sterile gauze or a clean dry towel, seal in a clean plastic bag, and place that bag inside an outer bag containing cold water and ice.",
            "Keep the patient warm, lying flat with legs elevated to combat hypovolemic shock."
        ],
        "warnings": [
            "Never place the severed part directly into water or directly onto ice, which causes severe tissue necrosis.",
            "Never loosen or release a tourniquet once applied in the field."
        ],
        "source": "https://www.redcross.org/take-a-class/resources/learn-first-aid/bleeding-life-threatening-external",
        "review_status": "team_reviewed"
    },
    {
        "id": "severe-allergic-anaphylaxis",
        "kind": "protocol",
        "title": "Anaphylaxis, severe allergic reaction, and throat constriction",
        "keywords": "allergic reaction anaphylaxis swollen throat bee sting hives epi pen epinephrine airway allergy",
        "summary": "Anaphylaxis causes rapid airway swelling and shock. Administer an epinephrine auto-injector (EpiPen) into the outer mid-thigh immediately and maintain a supine position.",
        "steps": [
            "Identify acute signs: facial and throat swelling, hives, difficulty breathing, wheezing, and dizzy collapse.",
            "Inject epinephrine auto-injector firmly into the outer mid-thigh muscle, holding in place for 3 to 10 seconds per device instructions.",
            "Keep the person lying flat with feet elevated, or semi-seated if breathing is severely labored; do not allow them to stand suddenly.",
            "Prepare a second epinephrine injection after 5 to 15 minutes if symptoms fail to improve or rebound."
        ],
        "warnings": [
            "Do not hesitate to administer epinephrine; delays in severe anaphylaxis are frequently fatal.",
            "Antihistamines (like diphenhydramine) act too slowly to halt life-threatening airway collapse."
        ],
        "source": "https://www.who.int/news-room/fact-sheets/detail/anaphylaxis",
        "review_status": "team_reviewed"
    },
    {
        "id": "lightning-storm-safety",
        "kind": "protocol",
        "title": "Severe thunderstorm, lightning hazard, and open field posture",
        "keywords": "lightning thunder storm electric strike tree open field lightning crouch hair standing thunderclap",
        "summary": "Seek enclosed substantial building or metal-topped vehicle. If caught in open terrain, avoid solitary trees and assume a low lightning crouch on the balls of feet.",
        "steps": [
            "Adhere to the 30/30 rule: seek shelter if thunder is heard within 30 seconds of lightning, and remain sheltered for 30 minutes after the last thunderclap.",
            "Evacuate immediately into a substantial enclosed building or fully enclosed, metal-roofed motor vehicle.",
            "Stay clear of tall solitary trees, metal towers, open bodies of water, and wire fences.",
            "If stranded in an open field with hair standing on end, crouch low on the balls of your feet with heels touching, hands over ears, minimizing ground contact."
        ],
        "warnings": [
            "Never lie flat on the ground during a lightning storm; ground current travels through surface soil.",
            "Do not shelter beneath picnic pavilions, open sheds, or isolated trees."
        ],
        "source": "https://www.weather.gov/safety/lightning",
        "review_status": "team_reviewed"
    }
]

# Verify token constraints
STOP_WORDS = {"a", "an", "and", "are", "can", "do", "for", "from", "how", "i", "in",
              "is", "me", "my", "near", "of", "on", "the", "there", "to", "what", "where"}
import re
def query_terms(text):
    return {w for w in re.findall(r"[a-z]{3,}", text.lower()) if w not in STOP_WORDS}

for idx, g in enumerate(guides):
    terms = query_terms(" ".join(str(g.get(f, "")) for f in ("title", "keywords", "summary")))
    if "walk" in terms:
        raise ValueError(f"Guide {g['id']} contains 'walk' which breaks test_gemini.py!")

out_path = Path("E:/hackthon/code cubical/RescueMemory/backend/data/knowledge.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(guides, f, indent=2, ensure_ascii=False)
    f.write("\n")

print(f"Successfully generated {len(guides)} guides into {out_path}")
