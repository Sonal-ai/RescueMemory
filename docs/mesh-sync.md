# Nearby Mesh Sync (Android 1.5)

Install the updated `RescueMemory-debug.apk` on both phones without uninstalling
the previous app, so existing reports are preserved. Open **Mesh Sync**, enable
Bluetooth, and allow Nearby devices. No saved Android pairing is required.

The app starts an Android foreground service after Nearby devices permission is
granted. It advertises and scans for eight seconds about every 30 seconds with
random timing variation, including on other pages and while the app is in the
background. A persistent **RescueMemory nearby mesh** notification includes a
**Stop mesh** action; **Find & sync** resumes it. Android 10/11 also require
Location permission/services for BLE scanning. Android 12+ uses Nearby devices.
Discovery survives WebView/activity destruction while the service is running;
force-stopping the app or Android/OEM terminating the service stops it. Open the
app again to start mesh; this is not a boot receiver or a guarantee against Doze.

Native presence pings exchange app IDs, battery and last GPS fixes in both
directions, even when only one phone's scan succeeds. Presence is discovery
telemetry; report access still requires device proofs and encrypted sessions.
Native peer snapshots repopulate the page when the WebView resumes. Recent
connectable addresses are retained when an incoming ping uses a different
Android central-role address. Advertising uses balanced mode.

Auto-sync is on by default and runs across every app page while the app is active.
The smaller device ID gets the first opportunity; the other phone can initiate
after 20 seconds if that fails. Both phones send and receive in one session.
**Find & sync** and **Sync now** bypass that tie-breaker. Full report exchanges
require both apps active; presence pings work while either is backgrounded. The
native receiver returns that distinction promptly instead of waiting for a paused
WebView to answer. Bluetooth signal is approximate proximity,
not a measured direction. Internet connectivity is independent of Bluetooth availability.

Each phone has one persistent app ID shared by Bluetooth, backend and cloud
presence. Bluetooth addresses can change without adding another phone card.
Online-only nodes appear in the collapsed debugging panel. Battery comes from Android and is sent over
Bluetooth even with internet disabled. The measurement timestamp is retained.

**Sync debugging** starts collapsed. It contains separate collapsible **Your data**,
**Online channel**, and **Recent activity** sections. Expand a report to
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
proofs still fail before any reports are shared. Install 1.5 on both phones,
then close and reopen Mesh Sync; it adds a new native verification method.

Report messages use ECDH/HKDF/AES-GCM, sequence checks,
inventory pagination, byte-sized report batches, and acknowledgements after
IndexedDB commits. Full text is retained. A single encoded report over 60 KB is
left pending with an explicit error rather than truncated. There is no four-report
limit. Pre-v2 APKs show **Update required**. Install 1.5 on both phones for
the current all-SOS sharing policy and GPS telemetry.

Android 14+ may negotiate MTU 517 even when the app requests 247. Wire frames
are capped at 512 bytes (including their framing header) in both directions,
preventing oversized characteristic writes that previously surfaced as
**Invalid sync request**. Missing MTU callbacks fall back to reading metadata;
later write errors retain the failing operation/MTU rather than blaming the
request contents.

Reports retain immutable IDs. Identical repeats add no records; mismatching
content under one ID is reported as a conflict and never replaces the local copy.
Cloud upload status is separate from peer receipts. Failed exchanges back off at
30, 60 and 120 seconds. Leaving the page keeps discovery and the receiver alive.
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
Android tests exercise framing at default/negotiated MTUs and native proof
verification with DER/raw signatures, malformed inputs, changed transcripts
and other-device keys. These do not replace a
physical two-phone radio test: disable Wi-Fi/mobile data, leave Bluetooth on,
exchange reports, compare displayed battery with Android, interrupt/retry, and
verify all SOS types arrive on both unenrolled phones and check radar accuracy.
