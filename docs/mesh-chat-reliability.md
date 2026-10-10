# Mesh sharing and grounded chat

Android now obtains peer identity and battery through the existing framed presence exchange instead of parsing a possibly truncated GATT JSON characteristic. This works at the minimum MTU, identifies both phones, and leaves the signed, encrypted SOS exchange unchanged. Failures retain their exact stage/code in Sync debugging. A completed exchange clears the visible retry alert; idle reconnection failures do not undo successful sharing.

An unchanged cloud report is no longer counted as newly received on every poll. New or changed report bodies are counted once; pending local edits and newer observed versions are retained. A raw beacon and its identified phone at the same Bluetooth address become one UI row. Battery readings survive advertisements and older telemetry; no battery is invented for an unidentified phone.

Mesh keeps its existing radar theme, with a single compact range caption. Detailed errors, stored reports, receipts and activity remain collapsible.

Android chat retrieves Qdrant Edge guide evidence locally first. When online and AI is requested, `/api/chat/format` sends those retrieved cards and matching public observations to the configured backend for Gemini formatting. The original local answer and citations remain available. Offline mode, a network disconnect, timeout, unavailable Gemini configuration or an HTTP failure returns the local answer. The Gemini key remains on the backend. Responder/group observations are excluded from this LLM request.

Supply and nearby survivor questions read the actual report inventory saved on the phone, including reports received by Bluetooth. Each entity uses its latest observation; known closures, resolved incidents and expired supplies are excluded. Distances require actual coordinates, are straight-line estimates, and are not route instructions. Answers include report timestamps and do not claim current availability. These observations are stored in IndexedDB, not indexed as native Qdrant vectors. Qdrant Edge currently indexes guide cards using BM25.

Quick questions cover being lost, nearby water, food, shelter, casualty needs and first aid. An app-controls guidance card explains how to use GPS, radar and the compass without inventing north, a destination or a safe route.

Validation includes a production native radio test with MTU 23, Unicode metadata and real telemetry fields; minimum-packet frame reassembly; repeated cloud imports; actual two-endpoint encrypted exchanges; local report selection and missing-coordinate cases; actual Android API routing to Gemini; backend evidence bounds and private-report rejection; and connection loss after local retrieval. Physical two-phone radio testing is still required to confirm behavior on the affected handsets.
