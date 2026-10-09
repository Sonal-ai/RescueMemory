package com.rescuememory.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import org.json.JSONArray;

/** Bounded device-local diagnostics. Never stores SOS bodies, keys or proofs. */
final class MeshTrace {
    private final SharedPreferences storage;
    private final JSONArray events;
    MeshTrace(Context context) {
        storage = context.getSharedPreferences("rescue.mesh.diagnostics", Context.MODE_PRIVATE);
        JSONArray saved;
        try { saved = new JSONArray(storage.getString("events", "[]")); } catch (Exception e) { saved = new JSONArray(); }
        events = saved;
    }
    synchronized void record(String stage, String code, String detail, JSObject fields) {
        JSObject event = new JSObject(); event.put("at", System.currentTimeMillis()); event.put("stage", stage);
        event.put("code", code); event.put("detail", detail); if (fields != null) event.put("context", fields);
        while (events.length() >= 120) events.remove(0);
        events.put(event); storage.edit().putString("events", events.toString()).apply();
        Log.i("RescueMesh", stage + " [" + code + "] " + detail + (fields == null ? "" : " " + fields));
    }
    void exception(String stage, String code, Exception error) {
        record(stage, code, error.getClass().getSimpleName() + ": " + error.getMessage(), null);
        Log.e("RescueMesh", stage + " [" + code + "]", error);
    }
    synchronized JSArray snapshot() { try { return new JSArray(events.toString()); } catch (Exception e) { return new JSArray(); } }
}
