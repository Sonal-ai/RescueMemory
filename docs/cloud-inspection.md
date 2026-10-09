# Cloud inventory and record inspection

APK 1.7 removes the dashboard/offline API's fabricated shard counts and mirror
total. Cloud statistics now use exact counts from the four application
collections. Unrelated presence/vector collections are excluded from that total.
A confirmed missing or empty collection displays zero; an unreachable cloud or
failed count displays **Unavailable** with its error and last check time.

**Cloud Collection Records** reads the same cloud source as these counts. Choose
Public, Responders, Group, or Guides, inspect stored payloads, and load additional
pages. Counts and page read times are shown separately because concurrent changes
can occur between reads. The separate local report feed is labelled explicitly;
its size is not presented as the cloud inventory. Cloud groups/guides can exist
without appearing in the local public/responder report feed.

The backend's `/api/sync/cloud-records` endpoint requires the existing admin
authorization and only reads the four application collections, without vectors.
HTTP authorization failures remain errors. The existing direct-cloud fallback
uses actual count/scroll responses and never invents record rows or counts.

Mirror notices distinguish newly uploaded/downloaded records from the verified
cloud inventory. A browser fallback only checks report sync; it does not claim
that the central API mirrored every collection. Existing signed guides are not
reported as new uploads on every repeated central mirror.

The provenance inspector displays stored hashes/metadata and actual relay
receipts. Missing hashes/origins/receipts remain unknown. It does not create
fictional survivor IDs, two-hop paths, or automatic cloud-confirmation claims.

Verification:

```powershell
cd frontend
npm test
npm run build
cd ..
python -m pytest -q backend/tests/test_cloud_inspector.py backend/tests/test_roundtrip.py -k 'cloud or scoped_qdrant'
```

The unit tests use mock cloud responses, while the mirror integration test uses
a temporary local Qdrant store to compare exact counts with retrieved payloads
for every collection. Live verification is read-only; it never mirrors, resets,
or prints stored report contents or cloud credentials.
