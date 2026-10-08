package com.rescuememory.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.function.BiConsumer;

/** The service can run discovery without a WebView or a JavaScript call. */
final class MeshCall {
    private final PluginCall bridge;
    private final JSObject args;
    private final BiConsumer<JSObject, String> completion;
    private boolean finished;
    MeshCall(PluginCall bridge) { this.bridge = bridge; args = bridge.getData(); completion = null; }
    MeshCall(JSObject args, BiConsumer<JSObject, String> completion) { bridge = null; this.args = args; this.completion = completion; }
    String getString(String key) { return args.optString(key, null); }
    String getString(String key, String fallback) { return args.optString(key, fallback); }
    int getInt(String key, int fallback) { return args.optInt(key, fallback); }
    JSObject getObject(String key) { try { return JSObject.fromJSONObject(args.getJSONObject(key)); } catch (Exception e) { return null; } }
    void resolve() { resolve(new JSObject()); }
    synchronized void resolve(JSObject value) {
        if (finished) return; finished = true;
        if (bridge != null) bridge.resolve(value); else completion.accept(value, null);
    }
    synchronized void reject(String error) {
        if (finished) return; finished = true;
        if (bridge != null) bridge.reject(error); else completion.accept(null, error);
    }
    void reject(String error, Exception cause) { reject(error + " (" + cause.getClass().getSimpleName() + ")"); }
}
