# Admin dashboard data corrections

APK 1.8 replaces the admin portal's fixed CRITICAL/flood status with a recorded
hazard count. Verified operational facilities are counted from the latest stored
entity reports; no three-facility baseline is added. A red hazard is not a medical
casualty. A later evacuation update replaces the earlier SOS in dashboard counts.
Both public and responder report feeds are paginated fully. Read failures remain
visible and make totals unavailable rather than implying a successful empty read.
Nearby phone counts use discovery results and do not add an assumed HQ node.

Admin GPS requests require a real fix, preserve zero coordinates, and disable the
legacy cached/Delhi-anchor fallback. Unknown report locations have no distance or
bearing. Walking duration remains explicitly an estimate. Backend peer signal
values derived from coordinates carry an explicit estimate flag and source;
native Bluetooth RSSI remains unchanged. Facility coordinates
can be entered manually or filled with a confirmed GPS fix. The sector map is
labelled as a schematic grid rather than claiming an unused 5 km search radius.

Hazard, facility, and guide forms start without fabricated incident text, names,
capacities, supplies, locations, or reviewer names. Reporter identity uses the
device ID. Guide source and reviewer are required operator inputs. Unknown
equipment availability remains unknown; existing saved inventory is preserved.

Signed guide/report writes must reach the authority server. Offline or rejected
requests cannot become fabricated signed publications. Ordinary offline SOS
storage, encryption, Bluetooth discovery, and report transfers are unchanged.
Publication notices claim a signature only when one is returned by the server;
they do not claim delivery to every phone. Local entity history uses actual stored
observations and the central timeline's danger/verified-report precedence, with
no invented timeline or fallback facility recommendation.

Browser/backend radar no longer generate synthetic nearby casualty, shelter,
water, or hazard markers when records are missing. Real reference records and
report retrieval remain in place. A recommender with no candidate returns no
recommendation rather than inventing a facility and score. The manual generator's
output path resolves relative to its own repository; the generator was not run.

Deferred questions (these behaviors were left unchanged):

- Are the bundled shelter/clinic/checkpoint records real approved facilities or
  demonstration data? Which pack should be the authoritative source? This also
  affects the separate Safe Place page's fallback facility list.
- Which backend URLs and credential provisioning method should replace embedded
  credentials/default keys and automatic server probes? Rotation needs the
  deployment credentials and rollout coordinated with installed phones.
- For remaining survivor screens, should unavailable GPS disable location actions
  or allow a clearly labelled last real fix? Their legacy fallback has not been
  migrated in this admin-focused change.
- Which approved protocols and reported assessment fields should govern emergency
  answers, triage, supplies, and route recommendations? Existing medical answer
  builders and dataset contents were not rewritten without that decision.

Verification: admin helper/API tests cover empty, partial, paginated, offline,
permission-denied, zero-coordinate, actual-record, and unsigned-publication cases.
Backend tests cover no synthetic radar data, recorded hazards, and existing
report/authorization/cloud/round-trip behavior. APK packaging uses the committed
frontend plus this task's changes, preserving unrelated ongoing work separately.

An existing raw-beacon mesh regression test intermittently records two connection
attempts rather than one, although both report copies arrive successfully. The
seven Bluetooth runtime/protocol/security/storage dependency files in this
package match the committed baseline byte-for-byte. This behavior was left
unchanged pending a separate Bluetooth investigation; it does not imply failure
of the new admin data tests.
