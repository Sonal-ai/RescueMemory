package com.rescuememory.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "QdrantEdge")
public class QdrantEdgePlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private QdrantEdgeStore store;
    private interface Operation { JSONObject run() throws Exception; }
    private void execute(PluginCall call, Operation operation) {
        try {
            worker.execute(() -> {
                try {
                    if (store == null) store = new QdrantEdgeStore(getContext(), new File(getContext().getFilesDir(), "qdrant/reference"));
                    call.resolve(JSObject.fromJSONObject(operation.run()));
                } catch (Throwable error) {
                    call.reject("On-device Qdrant Edge failed: " + (error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage()), "QDRANT_EDGE_UNAVAILABLE");
                }
            });
        } catch (java.util.concurrent.RejectedExecutionException stopped) {
            call.reject("Qdrant Edge worker is closed", "QDRANT_EDGE_UNAVAILABLE");
        }
    }
    @PluginMethod public void initialize(PluginCall call) { execute(call, () -> store.status()); }
    @PluginMethod public void getStatus(PluginCall call) { execute(call, () -> store.status()); }
    @PluginMethod public void searchGuidance(PluginCall call) {
        execute(call, () -> store.search(call.getString("query", ""), call.getInt("limit", 5)));
    }
    @PluginMethod public void upsertGuides(PluginCall call) {
        execute(call, () -> {
            JSONArray guides = call.getArray("guides");
            if (guides == null) throw new IllegalArgumentException("Guides are required");
            int updated = store.upsertGuides(guides);
            return store.status().put("updated", updated);
        });
    }
    @Override protected void handleOnDestroy() {
        worker.execute(() -> { if (store != null) store.close(); store = null; });
        worker.shutdown();
    }
}
