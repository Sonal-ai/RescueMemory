# Bluetooth identification fix — APK 1.9

The reported `Cannot read properties of undefined (reading 'node_id')` is reproducible in the previous release when GATT metadata identifies a nearby phone with the same node ID as the local phone. Discovery finds a beacon, but `remember()` discards it as self; the exchange replaces its peer reference with `undefined`, and the error handler crashes again while trying to read that reference.

Android previously accepted the browser's stored device ID and allowed native preferences to be restored independently of the non-exportable Keystore signing key. Restoring or copying that storage could therefore give different phones the same ID. The screenshot alone does not prove that storage was restored on these particular phones; copied diagnostics are still useful if the updated release fails.

## Changes

- Bind native node IDs to the SHA-256 fingerprint of the phone's actual Android Keystore public key. Unbound legacy survivor IDs migrate once; subsequent updates preserve the bound ID. A legacy responder ID is retained when its stored credential names that ID and public key. This matching check only preserves the name; existing signature/issuer checks still authorize credentials.
- Ignore proposed browser IDs during native identity initialization. Stored reports, report IDs, original provenance, transfer receipts, signing keys and certificates are not deleted.
- Validate local identity, connected metadata and selected peers before dereferencing them. Duplicate identity and incomplete metadata produce `DUPLICATE_NODE_ID` and `INVALID_METADATA` diagnostics with the failure stage and address. No transfer is recorded before authentication.
- Keep discovered beacons and their errors visible on failed identification, including during manual scanning. A retry is available for unresolved beacons; the existing app runtime continues automatic retries without opening Mesh Sync or tapping a button.
- Replace the stale row for an address when its native node ID changes, then authenticate the new identity before exchanging reports. Preserve the original transfer error if recording a partial session also fails.
- Include the actual local node ID in native diagnostic output. Keep the existing radar theme and sharing policy.

## Validation

- The regression test against the previous code produces the exact screenshot exception for duplicate IDs.
- All 53 frontend tests pass, including automatic retry after missing metadata, duplicate-ID diagnostics without invented transfers, identity migration, two-way exchange, all SOS visibility scopes, cryptographic proof rejection and lost-acknowledgement recovery.
- All 28 Android unit tests pass, including distinct IDs for different signing keys despite copied preferences, stable bound IDs, preserving a matching legacy responder ID, scanning prerequisites, advertising readiness, background presence and frame handling.
- Production web build, Capacitor asset sync and Android debug APK build pass. APK version is 1.9, version code 10.

Install this APK as an update on both phones and start each app once with the required permissions. Discovery/presence remain active in the native background service; encrypted report exchange currently runs while the app is active. Physical two-phone radio testing was not available in this workspace. If sharing still fails, copy Bluetooth error details from Sync debugging on both phones; diagnostics now distinguish duplicate IDs, metadata failures, Android GATT failures and handshake failures.
