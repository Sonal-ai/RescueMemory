# Continuous survivor GPS

The survivor page previously read location once on mount and copied its coordinates into a success message. A separate radar watcher could update while that message and the SOS pin kept the initial position. Opening a navigation destination could also replace the phone's position with the destination.

The survivor page now owns one native/browser GPS stream across its tabs. Fresh measurements update the GPS banner, current SOS location, radar origin and Bluetooth location telemetry. Online presence updates are throttled to ten seconds; the coordinates and timestamps come from the latest actual GPS measurements. A navigation destination and an explicitly chosen SOS map pin remain separate from the phone's GPS fix. Refresh GPS clears the manual pin.

The native watch requests high accuracy, zero cached age, a five-second desired update interval and a one-second minimum interval. Actual delivery depends on the device's location provider. The watch restarts when the page becomes visible and clears on unmount; late callbacks cannot revive an old watch. Older measurements cannot replace newer ones.

The banner identifies a last fix once no fresh measurement has arrived for thirty seconds. Permission/provider errors include their GPS stage and error code. Missing GPS never becomes a fixed Delhi anchor on this page. Actual measurement times, accuracy, speed and heading are preserved, including valid zero values. A legacy fallback for other callers is not cached or accepted as live GPS.

## Validation

- 71 frontend tests passed, including ten GPS/API tests covering movement beyond thirty kilometres, real measurement timestamps, stale/cached/out-of-order fixes, permission errors, foreground restart and delayed-watch cleanup. Bluetooth exchange and native retrieval regressions also passed.
- 28 Android unit tests passed; production web build and Android debug assembly succeeded.
- The offline Android emulator ran the actual APK. Injected GPS movement from the screenshot position to a position approximately 44 km away changed the rendered banner automatically, without pressing refresh or reopening the screen. Both the persisted GPS fix and Bluetooth telemetry changed to the new measured position and timestamp. This was an emulator test; physical-phone GPS testing remains a device check.
- All 55 production web assets match those inside the APK. Native Qdrant Edge libraries remain included for ARM64 and x86_64. The APK retains the existing signing certificate.

Root `RescueMemory-debug.apk`: version **1.11**, version code **12**.

SHA-256: `7ed433cddb543c1e6864c28b56256018a84d8de3c7c6dc2f4d68ae1d4db464c5`.

The release was built from an isolated snapshot of the staged GPS fix. Concurrent, uncommitted cloud-dashboard changes in the shared workspace were preserved and excluded from this release.
