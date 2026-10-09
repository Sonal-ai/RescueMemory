package com.rescuememory.app;

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.core.app.ActivityScenario;
import android.os.SystemClock;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Runs the real Rust engine from the APK, not a mock or HTTP backend. */
@RunWith(AndroidJUnit4.class)
public class QdrantEdgeInstrumentedTest {
    private Context context() { return InstrumentationRegistry.getInstrumentation().getTargetContext(); }
    private File root() { return new File(context().getFilesDir(), "edge-test-" + UUID.randomUUID()); }
    private JSONObject guide(int version) throws Exception {
        return new JSONObject().put("id", "native-roundtrip").put("kind", "protocol").put("version", version)
            .put("title", "Quartzmarker emergency 🆘 सहायता").put("summary", "Quartzmarker guidance revision " + version)
            .put("source", "Native offline test reference").put("instructions", new JSONArray().put("Quartzmarker reference step"));
    }

    @Test public void webViewBridgeCallsTheRealOfflineEngine() throws Exception {
        // The app starts its existing mesh runtime on launch. Permission dialogs
        // would pause ActivityScenario before this retrieval-only bridge check.
        grantTestPermission("android.permission.ACCESS_COARSE_LOCATION");
        grantTestPermission("android.permission.ACCESS_FINE_LOCATION");
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            grantTestPermission("android.permission.BLUETOOTH_SCAN");
            grantTestPermission("android.permission.BLUETOOTH_CONNECT");
            grantTestPermission("android.permission.BLUETOOTH_ADVERTISE");
        }
        if (android.os.Build.VERSION.SDK_INT >= 33) grantTestPermission("android.permission.POST_NOTIFICATIONS");
        try (ActivityScenario<MainActivity> activity = ActivityScenario.launch(MainActivity.class)) {
            long deadline = SystemClock.elapsedRealtime() + 60000;
            boolean started = false;
            String value = "null";
            while (SystemClock.elapsedRealtime() < deadline) {
                AtomicReference<String> result = new AtomicReference<>();
                CountDownLatch callback = new CountDownLatch(1);
                final boolean begin = !started;
                activity.onActivity(screen -> screen.getBridge().getWebView().evaluateJavascript(begin
                    ? "(function(){if(!window.Capacitor||!window.Capacitor.nativePromise)return false;"
                      + "window.__edgeBridgeTest=null;window.Capacitor.nativePromise('QdrantEdge','searchGuidance',{query:'severe bleeding',limit:3})"
                      + ".then(r=>window.__edgeBridgeTest=JSON.stringify(r)).catch(e=>window.__edgeBridgeTest=JSON.stringify({error:String(e)}));return true;})()"
                    : "window.__edgeBridgeTest", text -> { result.set(text); callback.countDown(); }));
                assertTrue("WebView evaluation timed out", callback.await(5, TimeUnit.SECONDS));
                value = result.get();
                if (!started) started = "true".equals(value);
                else if (value != null && !"null".equals(value)) break;
                SystemClock.sleep(200);
            }
            assertTrue("Native bridge was not ready", started);
            assertNotEquals("Native query did not finish", "null", value);
            String json = new JSONArray("[" + value + "]").getString(0);
            JSONObject response = new JSONObject(json);
            assertFalse(response.optString("error"), response.has("error"));
            assertEquals("qdrant-edge", response.getString("engine"));
            assertEquals("bm25", response.getString("retrieval"));
            assertTrue(response.getBoolean("on_device"));
            assertEquals(420, response.getInt("bundled_cards"));
            assertTrue(response.getJSONArray("cards").length() > 0);
            assertTrue(response.getJSONArray("cards").getJSONObject(0).getDouble("score") > 0);
        }
    }

    private void grantTestPermission(String permission) throws Exception {
        if (context().checkSelfPermission(permission) == android.content.pm.PackageManager.PERMISSION_GRANTED) return;
        android.os.ParcelFileDescriptor output = InstrumentationRegistry.getInstrumentation().getUiAutomation()
            .executeShellCommand("pm grant " + context().getPackageName() + " " + permission);
        try (InputStream stream = new android.os.ParcelFileDescriptor.AutoCloseInputStream(output)) {
            byte[] buffer = new byte[1024]; while (stream.read(buffer) != -1) { /* Drain shell completion. */ }
        }
        assertEquals(permission, android.content.pm.PackageManager.PERMISSION_GRANTED, context().checkSelfPermission(permission));
    }

    @Test public void realBm25SearchAndUnicodeGuidePersistAcrossShardReopen() throws Exception {
        File root = root();
        try {
            try (QdrantEdgeStore store = new QdrantEdgeStore(context(), root)) {
                assertEquals("qdrant-edge", store.status().getString("engine"));
                assertTrue(store.status().getInt("indexed_cards") >= store.status().getInt("bundled_cards"));
                assertTrue(store.search("severe bleeding", 3).getJSONArray("cards").length() > 0);
                assertEquals(0, store.search("zxqvvvxxuniquenoemergencytoken", 3).getJSONArray("cards").length());
                assertEquals(1, store.upsertGuides(new JSONArray().put(guide(2))));
                assertEquals(0, store.upsertGuides(new JSONArray().put(guide(1))));
                assertEquals(guide(2).getString("title"), store.search("quartzmarker", 1).getJSONArray("cards").getJSONObject(0).getString("title"));
            }
            try (QdrantEdgeStore reopened = new QdrantEdgeStore(context(), root)) {
                JSONObject hit = reopened.search("quartzmarker", 1).getJSONArray("cards").getJSONObject(0);
                assertEquals(2, hit.getInt("version"));
                assertEquals(guide(2).getString("title"), hit.getString("title"));
                assertTrue(hit.getDouble("score") > 0);
            }
        } finally { removeOwnedRoot(root); }
    }

    @Test public void malformedBatchDoesNotPartiallyIndexAndInvalidQueryFails() throws Exception {
        File root = root();
        try (QdrantEdgeStore store = new QdrantEdgeStore(context(), root)) {
            int before = store.status().getInt("indexed_cards");
            try { store.upsertGuides(new JSONArray().put(guide(1)).put(new JSONObject().put("id", "invalid"))); fail("Malformed batch accepted"); }
            catch (IllegalArgumentException expected) { assertEquals(before, store.status().getInt("indexed_cards")); }
            assertEquals(0, store.search("quartzmarker", 1).getJSONArray("cards").length());
            try { store.search("bad\0query", 2); fail("NUL query accepted"); }
            catch (IllegalArgumentException expected) { /* C-string truncation is rejected. */ }
        } finally { removeOwnedRoot(root); }
    }

    @Test public void failedLoadPreservesExistingShardDirectory() throws Exception {
        File root = root(); assertTrue(root.mkdirs());
        File marker = new File(root, "existing-data.txt");
        try (FileOutputStream output = new FileOutputStream(marker)) { output.write("preserve".getBytes(StandardCharsets.UTF_8)); }
        try {
            try (QdrantEdgeStore ignored = new QdrantEdgeStore(context(), root)) { fail("Invalid existing shard accepted"); }
            catch (IllegalStateException expected) { assertTrue(marker.exists()); assertEquals(8, marker.length()); }
        } finally { removeOwnedRoot(root); }
    }

    private void removeOwnedRoot(File root) throws Exception {
        String parent = context().getFilesDir().getCanonicalPath() + File.separator;
        if (!root.getCanonicalPath().startsWith(parent) || !root.getName().startsWith("edge-test-")) throw new IllegalArgumentException("Unexpected test cleanup path");
        remove(root);
    }
    private void remove(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) remove(child);
        assertTrue(!file.exists() || file.delete());
    }
}
