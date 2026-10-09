# Nearby Mesh Sync (Android 1.6)

Install the updated `RescueMemory-debug.apk` on both phones without uninstalling
the previous app, so existing reports are preserved. Open **Mesh Sync**, enable
Bluetooth, and allow Nearby devices and precise Location. No saved Android pairing is required.

The app starts an Android foreground service after the required permissions are
granted. It advertises continuously and starts eight-second scans about every
10 seconds while active, or 30 seconds in the background, with random timing
variation. Scan results are delivered immediately rather than after the window. A persistent **RescueMemory nearby mesh** notification includes a
**Stop mesh** action; **Find & sync** resumes it. Android 10/11 also require
Location services for BLE scanning. Android 12+ requires Nearby devices plus
precise Location because the radar derives approximate range from scan results.
The manifest no longer asserts `neverForLocation`, which Android documents can
filter some BLE beacons. See https://developer.android.com/develop/connectivity/bluetooth/bt-permissions.
Discovery survives WebView/activity destruction while the service is running;
force-stopping the app or Android/OEM terminating the service stops it. Open the
app again to start mesh; this is not a boot receiver or a guarantee against Doze.

Native presence pings exchange app IDs, battery and last GPS fixes in both
directions, even when only one phone's scan succeeds. Presence is discovery
telemetry; report access still requires device proofs and encrypted sessions.
Native peer snapshots repopulate the page when the WebView resumes. Recent
connectable addresses are retained when an incoming ping uses a different
Android central-role address. Advertising uses low-latency connectable mode and reports ready only after Android
confirms advertising succeeded. Startup callbacks have a bounded timeout.

Auto-sync is on by default and runs across every app page while the app is active.
Each fresh observed app beacon schedules identification and report exchange
automatically, using one connection with a small timing jitter. There is no
20-second device-ID hold. Both phones send and receive in one session.
**Find & sync** and **Sync now** remain optional recovery controls. Full report exchanges
require both apps active; presence pings work while either is backgrounded. The
native receiver returns that distinction promptly instead of waiting for a paused
WebView to answer. Bluetooth signal is approximate proximity,
not a measured direction. Internet connectivity is independent of Bluetooth availability.

Each phone has one persistent app ID shared by Bluetooth, backend and cloud
presence. Bluetooth addresses can change without adding another phone card.
Online-only nodes appear in the collapsed debugging panel. Battery comes from Android and is sent over
Bluetooth even with internet disabled. The measurement timestamp is retained.

**Sync debugging** starts collapsed. It contains separate collapsible **Your data**,
**Online channel**, **Recent activity**, and **Bluetooth diagnostics** sections. Expand a report to
inspect its text, scope, location, original source, observation/receipt timestamps,
and actual transfer receipts. Data and transfer history survive reopening the app.
"Copied to" requires a receiver storage acknowledgement. "Confirmed present on"
means a later inventory confirmed that the peer already stores the same report.
Neither means that command or a responder has acknowledged the emergency.

## Current sharing policy and radar

Every stored SOS type and field report is shared in both directions with nearby
RescueMemory app phones: public, responder-scoped, medical, and group SOS.
Responder enrollment is not required. Original report scope and group IDs are
retained for the separate online channel; the online server policy is unchanged.
Bluetooth transfers still use encrypted sessions and device key proofs. QR
transfer and the responder enrollment panel have been removed from this page.

Offline responder verification was intended to limit private SOS to phones
approved by command, using signed credentials that work without internet. It is
useful for a future restricted responder mode, but is not used to restrict the
current all-phone sharing flow. Optional backend credential routes remain
available; configuring an issuer is not required to use this APK's Bluetooth sync.

The rotating radar restores the navy/cyan SVG artwork from commit `3608341`.
It shows the local phone at the center with north up. Both phones
share their GPS latitude/longitude, accuracy and measurement timestamp over
Bluetooth while Mesh Sync is open. When both fixes are at most two minutes old,
solid cyan dots use GPS distance and bearing; the card shows combined GPS uncertainty.
Latitude/longitude come from phone GPS, not battery percentage or Bluetooth itself.
The sweep rotates for visual feedback; it is not a phone compass reading.

When GPS is unavailable or stale, outlined cyan dots use approximate Bluetooth signal
range and a stable display angle explicitly marked as direction unknown. Location
permission and Android location services are needed for fresh GPS positions.
The disaster-zone fallback location is never used as a real radar fix.
Transfer notifications appear briefly; details stay in the debugging panel.

## Transfer behavior and verification

Protocol v2 uses the existing service and META/RX/TX UUIDs. The native transport
negotiates MTU and frames bounded messages. Handshakes bind both identities,
nonces and ephemeral keys. Android verifies phone proofs using its native
`SHA256withECDSA` provider instead of converting them inside the WebView. Both
DER and fixed-width P1363 signatures are supported. Signing checks the local
Keystore key pair, and the app rejects stale cached keys explicitly. Altered
proofs still fail before any reports are shared. Install 1.6 on both phones,
then close and reopen Mesh Sync; it adds a new native verification method.

Report messages use ECDH/HKDF/AES-GCM, sequence checks,
inventory pagination, byte-sized report batches, and acknowledgements after
IndexedDB commits. Full text is retained. A single encoded report over 60 KB is
left pending with an explicit error rather than truncated. There is no four-report
limit. Pre-v2 APKs show **Update required**. Install 1.6 on both phones for
the current all-SOS sharing policy and GPS telemetry.

Android 14+ may negotiate MTU 517 even when the app requests 247. Wire frames
are capped at 512 bytes (including their framing header) in both directions,
preventing oversized characteristic writes that previously surfaced as
**Invalid sync request**. Missing MTU callbacks fall back to reading metadata;
later write errors retain the failing operation/MTU rather than blaming the
request contents.

Reports retain immutable IDs. Identical repeats add no records; mismatching
content under one ID is reported as a conflict and never replaces the local copy.
Cloud upload status is separate from peer receipts. Automatic failed exchanges retry with exponential backoff starting at
two seconds, capped at 30 seconds. Recent completed sessions have a short cooldown.
Scanner starts are limited to four per rolling 30 seconds to avoid restart throttling.
If filtered scans find nothing, the next foreground scan uses compatibility mode
and checks the app UUID locally; unrelated Bluetooth devices are never counted. Leaving the page keeps discovery and the receiver alive.
Foreground scans/transfers take priority over native discovery pings; a
failed/partial transfer can retry.

Automated checks:

```powershell
cd frontend
npm test
npm run build
npx cap sync android
cd android
.\gradlew.bat testDebugUnitTest assembleDebug --no-daemon
```

```powershell
python -m pytest -q backend/tests/test_responder_credentials.py backend/tests/test_discovery.py
```

The JavaScript tests use isolated phone stores and a simulated native bridge to
exercise the real sync engine, including long Unicode reports, two-way exchange,
duplicate retry, all-scope SOS sharing, GPS geometry, simultaneous initiation,
lost acknowledgement, WebView ECDSA import failure with native verification,
and rejection of invalid proofs in both handshake directions.
Android tests exercise advertising readiness/failure/startup timeout, immediate
scan observations, actual empty scans, Android scan/GATT failure codes, scanner
restart limits, framing at default/negotiated MTUs and native proof
verification with DER/raw signatures, malformed inputs, changed transcripts
and other-device keys. These do not replace a
physical two-phone radio test: disable Wi-Fi/mobile data, leave Bluetooth on,
exchange reports, compare displayed battery with Android, interrupt/retry, and
verify all SOS types arrive on both unenrolled phones and check radar accuracy.

## Diagnose detection and transfer failures

Expand **Sync debugging → Bluetooth diagnostics → Copy error details** on both
phones after reproducing the failure. The copied snapshot includes the actual
phone model, Android/app version, permissions, Location and Bluetooth states,
confirmed advertising, scan/service state, and bounded native/JavaScript events.
Native events persist across app reopening and are also logged as `RescueMesh`
in Android logcat. Report bodies and cryptographic keys/proofs are not logged.

Stages distinguish service binding/foreground startup, advertising, scanning,
GATT connection/services/MTU, metadata/presence, identity proof, inventories,
report storage acknowledgements, and cleanup. Numeric Android errors are retained
(e.g. `ANDROID_SCAN_2`, `ANDROID_ADVERTISE_2`, `ANDROID_GATT_133`). Successful
empty scans record `NO_APP_ADVERTISEMENTS`; an Android scan failure is an error,
not a successful empty result. Optional 2M PHY failures retain a diagnostic and
continue at the available PHY.

Transfer counts are computed only from authenticated inventories and actual
commit receipts. No peer means no transfer session. A connection attempt does
not claim report transfer; a successful exchange with equal/empty inventories
states that no new reports were needed without showing placeholder zero counts.
The existing navy/cyan radar theme is unchanged.

The audit fixes observable correctness and recovery issues; simulated bridge
and Android callback tests cannot establish the cause of a particular handset's
radio failure. If detection still fails, send copied diagnostics from both phones.
