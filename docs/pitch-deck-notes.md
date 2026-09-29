# RescueMemory pitch deck — Team Rubix

Canva working design: https://www.canva.com/d/M7AOv5b8YHBesXO

This deck uses the team's ten-slide RescueMemory Canva design and the visual rhythm of the supplied DeepTrace award-winning presentation: one claim per slide, large callouts, short copy, and diagrams or images. Each slide has a distinct job.

## Slide map and talk track

1. **Cover — Emergency help when networks fail.** RescueMemory carries useful local knowledge and reports between people and command during an outage.
2. **Team Rubix.** Sonal Verma, Palak Jain, and Shivendra Prasad. Keep roles concise if presenting live: edge/retrieval, interface, and backend/sync respectively.
3. **Problem — No signal. No updates.** A flooded gate report has value only if the survivor can use local guidance and the report can move toward responders. The app is designed for intermittent connectivity.
4. **Why every minute matters.** WHO says conditions behind nearly 30 million deaths each year in low- and middle-income countries could be addressed by effective emergency care. This is the broad need, not a RescueMemory benefit estimate. In Bangladesh, TraumaLink cared for 5,966 patients in 3,330 crashes over ten years; volunteer responders reached 90% of incidents in five minutes or less. This is a separate real-world example of rapid local response, not a result produced by RescueMemory. Measure RescueMemory's guide access, successful SOS handoffs and acknowledgements in pilots before estimating lives saved.
5. **Proposed solution.** A survivor asks and reports offline; Qdrant Edge retrieves source-linked guides and local observations on the node host. A hotspot/LAN peer exchange moves allowed records. A connected node syncs them to command, and verified updates travel back.
6. **Target audience.** Survivors need guidance and a way to report. Volunteers carry reports between nodes. Command teams, NGOs, campuses and district disaster managers need a scoped operational view. Emphasize the three-role graphic, not a market-size claim.
7. **Why Qdrant.** Real `qdrant-edge-py` stores persistent reference, event, group and receipt shards on local hosts. Dense MiniLM search plus Edge BM25 and reciprocal-rank fusion retrieve both semantic and exact matches without internet. Geo and visibility filtering surface nearby permitted facts. The 416-record prototype data file contains many generated variants; do not describe it as 416 clinically validated guides.
8. **Architecture and stack.** React/Vite UI → local FastAPI + Qdrant Edge on the node host → explicit LAN/hotspot exchange with a volunteer node → central FastAPI gateway → separate scoped Qdrant Cloud collections. The Android prototype is a browser UI connected to the host; Edge does not run inside the phone browser. Each transfer has a receipt and stable event ID to avoid duplicate reports.
9. **Business model (proposal).** Emergency guidance and SOS access stays free to survivors. Organizations could pay an annual command/sync contract, plus setup, training and reviewed local guide services. Validate pricing and procurement with campus/district/NGO pilots; there is no proven revenue yet.
10. **Demo / video storyboard.** Keep WAN off while the local LAN remains up. Ask for safe-water guidance, report Gate 3 flooded, exchange with a volunteer, reconnect a node to command/Qdrant Cloud, then send a verified update back. Add a real video link or embed only after the team records that flow. The current slide is a live-demo storyboard.

## Evidence links for slide 4

- [WHO, “Strengthening acute care systems saves lives, but urgent action is needed” (20 May 2025)](https://www.who.int/news/item/20-05-2025-strengthening-acute-care-systems-saves-lives--but-urgent-action-is-needed). The nearly 30 million figure is *addressable with effective emergency care*, not a count saved and not an estimate attributable to this app.
- [TraumaLink 10-year operational outcomes, BMJ Public Health (2025), PubMed record](https://pubmed.ncbi.nlm.nih.gov/41333092/). Reports 5,966 patients, 3,330 crashes and arrival within five minutes or less in 90% of cases.
- [ITU emergency telecommunications response](https://www.itu.int/en/itu-d/emergency-telecommunications/pages/response.aspx). Explains why restoring vital communications links matters for coordination after disasters; no numerical rescue effect for RescueMemory is inferred.

## Claims to avoid during judging

- Do not say RescueMemory has saved a measured number of lives; no field trial has established that outcome.
- Do not call the prototype an automatic Bluetooth mesh or say Edge runs inside an Android browser. The tested transport is a reachable LAN/hotspot with explicit peer exchange.
- Do not use the earlier `<50 ms`, `<300 ms`, or `<100 ms` targets as measured performance. If asked, show live metrics measured on the demo hardware.
- Do not present the generated guide variants as medically reviewed instructions. Keep the guidance and SOS flow within the prototype's safety boundary.
