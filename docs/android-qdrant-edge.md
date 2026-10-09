# Qdrant Edge inside the Android app

Merged into `main` from `codex/android-qdrant-edge`. The Android assistant uses Qdrant Edge 0.8.0 and its built-in BM25 embedder inside the APK. No Python process, retrieval server, network request, or neural embedding download is needed to search the bundled references.

## Execution and storage

The React assistant calls the `QdrantEdge` Capacitor plugin, which sends work to one Android worker. Java calls the Rust engine through the JNI library `librescue_qdrant_edge.so`. Edge embeds documents and queries, searches the `bm25` sparse vector field with the IDF modifier, and returns scored source cards. Existing report, Bluetooth receipt, and guide transfer storage stays in IndexedDB.

The first native initialization seeds 420 records from `backend/data/knowledge.json`. The generated asset includes the source pack hash and BM25 configuration. The shard lives in the app's private `files/qdrant/reference` directory. A ready status requires initialization and a successful native count. Existing shard load errors are surfaced without deleting data. Imported guide revisions are reconciled into the shard before the next query and flushed to disk; older revisions cannot replace newer indexed guides.

Android `/api/chat`, `/api/assess`, `/health`, and `/api/sync/status` requests take the native route before network or response-cache routing. Emergency reference searches filter for protocol cards. Actual nearby survivor lookup continues using stored reports. The browser/PWA uses its existing JavaScript retrieval and is identified separately. Native failures never silently switch to that browser search. An empty native result returns no invented source cards.

The answer displays **Qdrant Edge · On-device BM25** only when its retrieval metadata identifies the native engine. Native health includes engine version, pack version, actual shard count, and actual pending report counts. `/api/assess` provides references and explicitly reports that automated clinical assessment is unavailable locally.

## Native distribution

The build consumes only the C ABI header and prebuilt Android static archives from [`react-native-qdrant-edge` 0.4.1](https://www.npmjs.com/package/react-native-qdrant-edge/v/0.4.1). Its pinned Cargo manifest and lock identify Qdrant Edge 0.8.0. The React Native package, Nitro runtime, and install hooks are not installed or run. The existing Capacitor application is retained.

`frontend/scripts/prepare-qdrant-edge.mjs` verifies a pinned SHA-512 before extracting an explicit file list, then verifies cached files on subsequent builds. `QDRANT_EDGE_ARCHIVE` can point to the exact verified archive for an offline build. A first build otherwise needs internet to download build tools and the native archive. App retrieval needs no internet. Support covers `arm64-v8a` phones and `x86_64` emulators; 32-bit Android is unsupported. Native linking requests 16 KB alignment.

The distribution's package metadata declares the FFI wrapper MIT licensed, authored by danixx; [source repository](https://github.com/rust-dd/react-native-qdrant-edge). Qdrant Edge is maintained by Qdrant; see the [crate](https://crates.io/crates/qdrant-edge/0.8.0), [source and license](https://github.com/qdrant/qdrant), and [official BM25 documentation](https://qdrant.tech/documentation/edge/edge-bm25/). The supplied static archives include Rust dependencies listed in the pinned Cargo.lock. Their original licenses apply.

## Build and verification

From `frontend`, run `npm ci`, `npm test`, `npm run build`, and `npx cap sync android`. With JDK 21 and an Android SDK configured, run `./gradlew :app:assembleDebug :app:assembleDebugAndroidTest` from `frontend/android`. Gradle verifies the native distribution and exports the current knowledge pack automatically. The APK is written to `frontend/android/app/build/outputs/apk/debug/app-debug.apk`.

With an Android device or emulator connected, run `./gradlew :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.rescuememory.app.QdrantEdgeInstrumentedTest`. These tests execute the actual Rust engine and check positive BM25 scores, no-match behavior, Unicode guide payloads, revision protection, flush/reopen persistence, malformed-batch rejection, and preservation of an invalid existing shard. Frontend integration tests separately verify API routing, imported-guide reconciliation, metadata, and failure propagation.

For the submission, install the new APK, enable airplane mode before its first launch, open the Survivor assistant, and search for `severe bleeding`, `burns`, or `clean water`. Confirm the answer has the native BM25 label. Close and reopen the app and repeat. Test on the actual submission phone: Android filesystem compatibility and memory limits can differ from an emulator. The pre-existing vector facility recommender and browser path are not covered by this native BM25 requirement. This change does not validate the clinical correctness of the source guidance.

## Validation record

Validated on 9 October 2026:

- Frontend: 57 tests passed, including native bridge and actual API dispatcher contract tests; production web build and Capacitor sync succeeded.
- Android: app APK and test APK compiled. Four actual-engine instrumented tests passed on the Android 16 `medium_phone` x86_64 emulator, with airplane mode enabled and Wi-Fi disabled. The WebView test used the registered Capacitor plugin and returned three positively scored native matches for `severe bleeding`.
- Persistence: the native index reopened with 421 points after importing a Unicode guide; its newer revision remained searchable. Separate test shards were removed after testing.
- Packaging: both native architectures are present. ELF load segments have 16,384-byte alignment; Android `zipalign -c -P 16 4` and `apksigner verify` passed.
- Deliverable: `RescueMemory-QdrantEdge-debug.apk`, version 1.8 (code 9), 39,925,106 bytes. SHA-256: `8eb445ef687c08edb01dfba24c9a9ef680b378bfde8961734ab966b5cb30d616`.
- Physical ARM64 phone execution remains untested. The ARM64 native library was compiled and packaged, while runtime verification used x86_64.

An initial whole-project test build encountered duplicate Kotlin classes in the generated Capacitor Cordova library's own test application. The documented app-scoped build/test commands avoid that unrelated test target. The first WebView test attempt paused at existing Android runtime permission prompts; its setup now grants the app's declared permissions on the test device before launch. The final app-scoped run completed successfully with no failed or skipped tests.

## Combined main release

The merged release preserves the admin data corrections and Bluetooth identity/retry fixes from main. Generated web assets and the APK were rebuilt after resolving the merge; the root `RescueMemory-debug.apk` is the combined deliverable, version **1.10**, code **11**. Install it as an update: the signing certificate matches the previous Bluetooth release.

Validated on 9 October 2026 after merging:

- All **61 frontend tests** and **28 Android unit tests** passed.
- All **four actual-engine instrumented tests** passed on the Android 16 `medium_phone` x86_64 emulator with airplane mode enabled and Wi-Fi disabled; none failed or were skipped.
- The production web build, Capacitor sync, app build and test APK build passed. All **55 packaged web assets** match the merged web build; the **420 bundled records** match the current backend reference source.
- Both `arm64-v8a` and `x86_64` native engines are packaged. ELF load-segment alignment, 16 KB APK alignment and APK signature verification passed.
- Root APK: **39,873,762 bytes**, SHA-256 `50228d2a97fd5ba32b60e4a6065b3999623d0920a908a0530151bbfd2ab48451`.

The earlier separately named Qdrant Edge APK above records the original branch validation. Use the root combined APK for the merged app. Physical ARM64 phone execution and two-phone Bluetooth radio testing remain separate from these emulator and automated checks.
