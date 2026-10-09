# Android Qdrant Edge audit and implementation plan

Audit date: 9 October 2026. Requirement clarified by the user: genuine on-phone Qdrant Edge BM25 retrieval is sufficient; a neural embedding model is not required for this submission.

This records the application **before native integration**. Implementation on `codex/android-qdrant-edge` is documented in [android-qdrant-edge.md](android-qdrant-edge.md), including build and validation results. Some other audited app paths have also changed concurrently; the observations below describe the inspected baseline.

## Decision

The original Android APK did **not** meet the stated requirement. It contained an offline React application and Java Bluetooth implementation, but no Qdrant Edge runtime. Keep the existing React/Capacitor application and add an Android Capacitor plugin backed by the official Qdrant Edge Rust crate. Use Edge's built-in BM25 to index and query emergency guidance locally.

The proposal below informed the implemented native integration. Physical submission-phone testing remains a separate check from emulator validation.

## Evidence and scope

Reviewed the frontend API dispatcher and offline brain, offline persistence, cloud synchronization, Bluetooth protocol/runtime/security, survivor and command flows, native Android configuration, backend application/service/memory/sync/cloud code, export scripts, build workflow, and existing tests. Inspected both available debug APKs as ZIP archives. This is an architecture and functionality audit focused on submission readiness, not an exhaustive security penetration test or clinical validation of the guidance.

- The root and Gradle debug APKs were both 7,025,327 bytes. Neither contained entries under `lib/` nor ONNX/TFLite models.
- `frontend/android/app/src/main/java/com/rescuememory/app/MainActivity.java:9` registers only `RescueBlePlugin`.
- `frontend/android/app/build.gradle` has no Qdrant/JNI build integration.
- `frontend/src/brain/offlineBrain.js:289` implements assistant retrieval with synonym expansion and weighted substring matches at lines 338–342. It does not generate a query embedding, invoke an Edge shard, or implement BM25 despite the header's description.
- The phone pack has 419 cards: 416 protocols and 3 checkpoints. Its vector map has 423 entries, all 384-dimensional, including four hazard profiles. The backend source has 420 cards; `water_tanker_4` is missing from the phone pack.
- `backend/app/memory.py` is the real active Edge implementation: `qdrant_edge.EdgeShard`, persistent `reference/events/groups/receipts` shards, dense MiniLM embeddings, BM25 sparse vectors, geo indexes, and RRF search.
- `backend/app/engine/qdrant_engine.py:44` is a separate facade using `QdrantClient(path=...)`. That is Qdrant client local mode, and must not be presented as proof that Qdrant Edge runs in Android. The active FastAPI service uses `Memory`, not this facade.

## Current versus required execution

Current phone assistant:

```text
React UI -> api.js -> cached response / remote FastAPI if reachable
                    -> offlineBrain.js -> JavaScript card scan
Reports / guides / Bluetooth receipts -> IndexedDB
```

Required phone assistant:

```text
React UI -> local retrieval adapter -> Capacitor QdrantEdge plugin
         -> Java worker -> JNI -> Qdrant Edge Rust library
         -> local BM25 query -> persistent reference shard -> cited cards

Internet -> optional enrichment and synchronization
Bluetooth -> received records -> durable outbox -> local Edge indexing
```

Both the BM25 query vector and the search must execute on the phone. Merely downloading JSON vectors, calling a laptop on a hotspot, or accessing Qdrant Cloud does not establish on-phone Edge retrieval. Qdrant officially documents the Rust and Python APIs and built-in offline BM25 [1, 2].

## Findings requiring action

### Submission blocker: missing native Edge engine

Add the library, JNI boundary, Capacitor plugin, persistent shard initialization, local query implementation, and a UI call path that actually reaches that plugin. A dependency appearing in a manifest is insufficient; the running APK must query the engine.

### High priority: online and cached responses can bypass local retrieval

`frontend/src/api.js:243` currently favors cached or remote responses; local execution is a fallback. Make native emergency guidance local-first even when internet is available. Return explicit engine provenance such as `engine: 'qdrant-edge'`, `retrieval: 'bm25'`, library version, actual indexed count, and document-pack version. Keep browser keyword retrieval labeled separately. If native initialization fails, report that failure; a fallback must not keep an Edge label.

### High priority: synthetic locations and statuses are presented as real

`api.js:495` creates a shelter by adding offsets to the user's position; line 537 does the same for a water point. The radar branch at line 739 adds baseline positions around every user. The first entity-timeline branch fabricates a compromised status and observation. A second entity branch later in the function is unreachable because the earlier branch returns. `offlineBrain.js:209` can return a hardcoded shelter and score when no candidate exists.

Replace these outputs with actual stored checkpoints and observations. Track source, verification, time, expiry, and conflict state. Return unknown/no supported result when data is absent. Vector arithmetic alone does not establish route safety; operational status and current hazard observations must constrain facility selection. The existing `MapPanel` is a schematic display, not evidence of an offline street-map or routing dataset.

### High priority: offline endpoint behavior differs from backend behavior

`assessCasualty()` calls `/api/assess`, but `handleOfflineFallback` has no corresponding assessment branch. It reaches the generic success-like object at `api.js:935`. The nearby-map fallback returns all reports rather than applying the requested geographic radius. These need explicit local handlers and contract checks. The clinical rules in Python do not automatically execute in an APK when native search is added; port only the required rules deliberately, or return retrieved source guidance without claiming the full backend assessment feature.

### High priority: sensitive data boundaries differ between phone and backend

`cloudSync.js:11` embeds a cloud API credential in distributable code. Its current server-side privileges were not exercised during this audit. Rotate the exposed credential and route cloud writes/reads through authenticated backend endpoints with authorization; moving a secret into a Java class does not protect it from extraction.

`meshProtocol.js:32` exports all valid report scopes, including responder and group records. Existing tests explicitly expect exchange between unenrolled phones. The backend has different group/responder restrictions. The native storage migration must preserve an explicitly chosen access policy; adding shards or encrypting the Bluetooth channel does not itself enforce who may read private records.

### Medium priority: vector generation is inconsistent

`Memory` uses `sentence-transformers/all-MiniLM-L6-v2`, whereas `export_browser_shard.py:31` uses `BAAI/bge-small-en-v1.5`. Both output 384 values, but the embedding spaces are different. `cloudSync.js:107` creates pseudorandom vectors from a text seed rather than learned semantic embeddings. Those vectors must not be mixed with neural embeddings for semantic search.

BM25 avoids the dense-model requirement for the submission path. Leave the existing cloud schema alone during the first native prototype; later remove placeholder-vector assumptions or have the backend produce consistent dense embeddings. If dense mobile retrieval is added later, pin the same model, tokenizer, pooling, normalization, and preprocessing for documents and queries, then regenerate the index.

### Medium priority: updates can be stored without becoming searchable

`initOfflineBrain` starts with nonempty imported static cards and merges IndexedDB guides only on a forced reload or empty cache. Cloud sync saves guides but does not force that merge. Phone cloud/HTTP pulls also use fixed-size first pages rather than complete pagination. A downloaded guide can therefore be absent from search or never downloaded.

Define an explicit native indexing queue after committed guide/report imports, and perform startup reconciliation. Paginate downloads, handle revisions and deletions, and reject untrusted guide updates. The native reference pack must be generated from the same current source used by the backend, with hashes and a version manifest.

### Medium priority: background and browser claims need separate validation

The native Bluetooth radio service exists; the JavaScript exchange scheduler skips work when the document is hidden. Do not infer complete background indexing/exchange from radio availability. Test screen-off and process-restart behavior on devices.

The browser service worker does not explicitly precache the vector chunk or every frontend asset. Browser cache behavior and first-offline-open readiness are a separate concern from APK assets. Packaging native Edge will improve Android retrieval, not automatically add Edge to the PWA.

## Recommended implementation sequence

### 1. Prove Android compatibility first

Create a small Rust `cdylib` linked to a pinned, tested `qdrant-edge` release and expose a minimal JNI interface. Build for `aarch64-linux-android` / `arm64-v8a` with the Android NDK, respecting the app's API-24 minimum. Add `x86_64` only for emulator testing when needed. Run a tiny create → BM25 upsert → search → flush → process restart → load → search test on the target phone before connecting the UI.

The current shell PATH exposes Python and Node but not Cargo/Rust; the inspected Android SDK directory has no NDK installation. Extend the existing APK build script and GitHub workflow with the pinned Rust/NDK build or verified native artifact retrieval. Build and check native alignment for Android 16 KB page-size devices [5].

A third-party React Native Qdrant Edge module reports Android native builds and a C FFI layer [3]. It provides useful implementation precedent, but its React Native/Nitro entry point does not plug directly into Capacitor. Avoid a UI framework migration merely to use it. Inspect its lower-level FFI/build code and licensing if adapting anything, and verify any binary's engine version and architecture independently.

There is an upstream report of Edge shard reload failures on Android F2FS [4]. Test the pinned build on the submission device. If affected, use a verified upstream fix or a narrowly maintained build patch. Never respond to a load failure by deleting reports and recreating the shard.

### 2. Add the native plugin and reference shard

Suggested new files:

- `frontend/native/qdrant-edge-bridge/Cargo.toml` and `src/lib.rs`: Edge integration and JNI entry points.
- `frontend/android/app/src/main/java/com/rescuememory/app/QdrantEdgePlugin.java`: Capacitor methods and a serialized background executor.
- `frontend/src/brain/qdrantEdge.js`: platform detection and typed response/error adapter.
- `backend/scripts/export_android_edge_pack.py`: current cards, BM25 configuration, content hashes, stable IDs, and pack manifest.

Register the plugin in `MainActivity`, package the `.so` through Gradle `jniLibs`/native build integration, and bundle the complete card pack as APK assets. Use app-private persistent storage such as `filesDir/qdrant/reference`; assets are an input pack, not a writable database.

Expose `initialize`, `searchGuidance`, `upsertGuides`, and `getStatus` initially. Keep database work off Android's UI thread. Use one controlled shard owner, serialized writes, bounded reads, explicit error responses, and deliberate flush/lifecycle behavior. Start with a named sparse vector `bm25` and the IDF modifier. Use Edge BM25's document embedder for indexing and query embedder for queries; those functions are not interchangeable [2].

Use stable native point IDs and retain the original string card ID in the payload. If using uint64 IDs, keep them as strings across the JS bridge; backend IDs can exceed JavaScript's safe-integer range. Include title, keywords, summary, instructions, warnings, applicability, and sources in the searchable/returned pack. Native seeding must be resumable and versioned; mark ready only after indexing the expected record count.

### 3. Connect the actual assistant to native search

On Android, call `QdrantEdge.searchGuidance` for emergency card queries before remote API attempts. Render the returned source cards with the existing UI and grounded deterministic formatting. Preserve greeting and navigation intents, but resolve locations from stored records. Add explicit empty/low-relevance behavior rather than attaching the first arbitrary cards when nothing matches.

The minimum submission deliverable is a persistent native reference shard plus real local BM25 assistant retrieval. An LLM is not required for that path. Semantic embeddings and hybrid RRF can be a later addition.

### 4. Index reports and synchronize deliberately

Add an `events` shard after guidance search works. Keep IndexedDB as the initial canonical outbox and transfer-receipt store; project committed reports into native Edge through a durable indexing queue. There is no cross-database atomic transaction between IndexedDB and JNI, so reconcile at startup and retain pending jobs after failures. A full storage migration can follow later.

Bluetooth/cloud import should acknowledge durable receipt storage, enqueue indexing, and become searchable after that queue commits. Define idempotent IDs, revision ordering, provenance, expiry, deletion/tombstone handling, and scope filters. Groups and receipts can remain in their existing store for the first submission version; four native vector shards are not necessary merely to prove on-phone guidance retrieval.

### 5. Demonstrate and document the requirement

Acceptance evidence:

1. The installable APK contains the expected native Edge library for the device ABI and a versioned local card pack.
2. Fresh installation launches and indexes bundled data with Wi-Fi/mobile data disabled and the backend stopped. No first-run downloads are required.
3. Several non-preselected emergency queries produce ranked, cited BM25 results through the native plugin. Capture native query logs and actual shard counts.
4. Force-stop/relaunch and reboot preserve the shard and reproduce results; test the target filesystem and page-size configuration.
5. A guide update changes search results without restarting; a received report becomes searchable once local indexing completes.
6. Failure to initialize Edge visibly identifies the degraded retrieval mode. No fabricated counts, routes, or verification labels appear.
7. A paired-phone BLE test can run in airplane mode with Bluetooth explicitly re-enabled. Network synchronization remains optional.

Update README, implementation/deployment guides, demo captions, and status UI to distinguish native Android Edge, backend Edge, browser fallback, and optional cloud synchronization. Record latency, storage, memory and battery measurements on the submission phone instead of promising unmeasured performance.

## Verification from this audit

- Frontend test suite: **35 passed**, 0 failed.
- Source/test-only lint: **144 warnings**, 0 errors; the broader lint command also scans generated bundles, making its output noisy.
- Targeted backend checks: **5 passed**, covering distance calculation, discovery packet handling, signed enrollment, rejection of the wrong device key, and expired challenges.
- Full backend suite: started but interrupted after an extended run without a test result; not marked passed. Separate broader discovery/credential runs also stopped at API tests without completing. The cause of the stall was not established in this audit.
- APK contents: confirmed no native libraries or packaged embedding models in the two inspected artifacts.
- Native Qdrant execution and physical-device behavior: **not tested**, because this APK has no engine to execute.

Existing source changes were preserved. This audit adds documentation only.

## Primary references

1. [Qdrant Edge overview and supported APIs](https://qdrant.tech/documentation/edge/) — in-process engine, Rust/Python integration; beta status.
2. [Qdrant Edge BM25 guide](https://qdrant.tech/documentation/edge/edge-bm25/) — built-in offline sparse embedding, IDF configuration, document/query API distinction.
3. [React Native Qdrant Edge module](https://github.com/rust-dd/react-native-qdrant-edge) — third-party mobile integration precedent, native Android binaries and C FFI architecture; not a Capacitor SDK.
4. [Qdrant issue 10307](https://github.com/qdrant/qdrant/issues/10307) — reported shard-loading failure on Android F2FS; validate against the chosen release/device.
5. [Android native 16 KB page-size guidance](https://developer.android.com/guide/practices/page-sizes) — native library alignment and device verification.
