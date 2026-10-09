# Phone presence uses one renewable cloud beacon

Cloud inspection found 12 inactive `peer_beacon` records with different stored identities. None had an expiry. The existing publisher already derived a point ID from the saved phone identity, but inactive records from prior identities were never physically removed. The application hides those beacons after five minutes, while cloud inventory still counts them.

The publisher now serializes updates per phone, retains its chosen point ID for the session, preserves actual GPS measurement time and zero-valued coordinates/battery, and waits for confirmed cloud completion. Subsequent pings update the same record. Older GPS readings cannot replace a newer successfully published reading. Missing coordinates are rejected, and unknown telemetry is omitted. The location API returns `cloud_updated` separately from local location success.

Each new managed beacon has `beacon_protocol: lease-v1` and an expiry five minutes after the latest ping. After confirming its current beacon, the publisher can remove alternate managed point IDs for that same phone. It periodically prunes managed beacons that have received no ping for over five minutes. These filters require the `peer_beacon` kind and cannot delete SOS, incident, hazard, resource, checkpoint or chat-presence records. Active other phones are preserved.

The actual cloud initially rejected cleanup filters because `node_id` and `last_seen` had no indexes. The required keyword/integer indexes, plus a protocol keyword index, were created successfully and their filters verified. No cloud point was deleted during this task.

Existing unmanaged beacons are excluded from automatic cleanup. Deleting the 12 old inactive beacons was rejected by automatic approval review because explicit user permission is required to delete existing cloud data. `pruneInactivePhoneBeacons({ includeLegacy: true })` is reserved for that explicitly approved cleanup. Recheck the count before executing it; the number may change as phones reconnect. Ordinary pings may renew an existing record for the same saved identity.

## Validation

- 86 frontend tests passed, including eight new presence tests and the existing GPS, cloud routing, Bluetooth exchange and offline native retrieval checks.
- Presence tests exercise the actual cloudSync entry point against a simulated cloud, repeated updates, concurrent pings, stale GPS, HTTP failures/retries, managed expiry and preservation of existing unmanaged records and SOS data.
- 28 Android unit tests passed; production web build and APK assembly succeeded. All 55 release web assets match the APK.
- Cloud validation was limited to reading actual beacon metadata/counts and adding/verifying indexes. Repeated test pings were not written to the live cloud.

Root APK: `RescueMemory-debug.apk`, version **1.12**, version code **13**.

SHA-256: `1c5580246426f923c1d5613a9effee89aa59764d58e3b041ad16f133be4bd18c`.

The release is based on main's merged Render connectivity and GPS work (`302bb34`) and excludes unrelated uncommitted edits in the shared checkout.
