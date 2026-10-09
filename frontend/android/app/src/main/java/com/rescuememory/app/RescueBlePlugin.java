package com.rescuememory.app;

import android.Manifest;
import android.content.*;
import android.os.*;
import androidx.core.content.ContextCompat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import com.getcapacitor.annotation.Permission;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/** The bridge attaches to a service; navigating or suspending the WebView does not stop BLE. */
@CapacitorPlugin(name = "RescueBle", permissions = {
    @Permission(strings = {Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_ADVERTISE}, alias = "nearby"),
    @Permission(strings = {Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION}, alias = "legacyLocation"),
    @Permission(strings = {Manifest.permission.POST_NOTIFICATIONS}, alias = "notifications")
})
public class RescueBlePlugin extends Plugin {
    private MeshRadioService radio;
    private boolean bound;
    private boolean foreground = true;
    private final List<Consumer<MeshRadioService>> waiting = new ArrayList<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ServiceConnection connection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) {
            radio = ((MeshRadioService.LocalBinder)binder).service(); radio.attach((event, data) -> notifyListeners(event, data));
            radio.setBridgeActive(foreground);
            for (Consumer<MeshRadioService> work : new ArrayList<>(waiting)) work.accept(radio); waiting.clear();
        }
        @Override public void onServiceDisconnected(ComponentName name) { radio = null; }
    };
    @Override public void load() { bound = getContext().bindService(new Intent(getContext(), MeshRadioService.class), connection, Context.BIND_AUTO_CREATE); }
    private void withRadio(PluginCall call, Consumer<MeshRadioService> work) {
        handler.post(() -> {
            Consumer<MeshRadioService> safe = r -> { try { work.accept(r); } catch (Exception e) { call.reject("[bridge/COMMAND_EXCEPTION] " + e.getClass().getSimpleName() + ": " + e.getMessage(), e); } };
            if (radio != null) safe.accept(radio);
            else if (bound) {
                waiting.add(safe);
                handler.postDelayed(() -> { if (waiting.remove(safe)) call.reject("[bridge/BIND_TIMEOUT] Native mesh service did not bind within the deadline."); }, 10000);
            }
            else call.reject("[bridge/BIND_FAILED] Could not bind nearby mesh service. Reopen the app.");
        });
    }
    @PluginMethod public void start(PluginCall call) {
        String alias = Build.VERSION.SDK_INT >= 31 ? "nearby" : "legacyLocation";
        android.content.SharedPreferences prefs = getContext().getSharedPreferences("rescue.mesh", Context.MODE_PRIVATE);
        if (getPermissionState(alias) != PermissionState.GRANTED) {
            if (call.getBoolean("automatic", false) && prefs.getBoolean("asked_nearby", false)) { call.reject("Allow Nearby devices in Android settings, or use Find & sync to retry permission."); return; }
            prefs.edit().putBoolean("asked_nearby", true).apply();
            requestPermissionForAlias(alias, call, "startAllowed");
        } else startAllowed(call);
    }
    @PermissionCallback private void startAllowed(PluginCall call) {
        String required = Build.VERSION.SDK_INT >= 31 ? "nearby" : "legacyLocation";
        if (getPermissionState(required) != PermissionState.GRANTED) { call.reject("[permission/NEARBY_DENIED] Allow Nearby devices and precise Location in Android settings."); return; }
        // Request coarse and fine together so Android 12+ offers precise Location.
        if (Build.VERSION.SDK_INT >= 31 && getPermissionState("legacyLocation") != PermissionState.GRANTED) {
            android.content.SharedPreferences prefs = getContext().getSharedPreferences("rescue.mesh", Context.MODE_PRIVATE);
            if (call.getBoolean("automatic", false) && prefs.getBoolean("asked_mesh_location", false)) { call.reject("[permission/PRECISE_LOCATION_DENIED] Allow precise Location for Bluetooth scanning and radar, or use Find & sync to retry permission."); return; }
            prefs.edit().putBoolean("asked_mesh_location", true).apply();
            requestPermissionForAlias("legacyLocation", call, "locationAllowed"); return;
        }
        locationAllowed(call);
    }
    @PermissionCallback private void locationAllowed(PluginCall call) {
        if (getPermissionState("legacyLocation") != PermissionState.GRANTED) { call.reject("[permission/PRECISE_LOCATION_DENIED] Precise Location is required for Bluetooth scanning and radar range."); return; }
        android.content.SharedPreferences prefs = getContext().getSharedPreferences("rescue.mesh", Context.MODE_PRIVATE);
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED && !prefs.getBoolean("asked_notifications", false)) {
            prefs.edit().putBoolean("asked_notifications", true).apply();
            requestPermissionForAlias("notifications", call, "beginMesh");
        } else beginMesh(call);
    }
    @PermissionCallback private void beginMesh(PluginCall call) {
        withRadio(call, r -> {
            if (!r.permitted()) { call.reject("Nearby devices permission is required."); return; }
            if (call.getBoolean("automatic", false) && r.paused()) { call.resolve(); return; }
            r.resumeMesh();
            try { ContextCompat.startForegroundService(getContext(), new Intent(getContext(), MeshRadioService.class)); r.start(new MeshCall(call)); }
            catch (Exception e) { call.reject("[service/FOREGROUND_START_EXCEPTION] " + e.getClass().getSimpleName() + ": " + e.getMessage(), e); }
        });
    }
    @PluginMethod public void getIdentity(PluginCall c) { withRadio(c, r -> r.getIdentity(new MeshCall(c))); }
    @PluginMethod public void getBattery(PluginCall c) { withRadio(c, r -> r.getBattery(new MeshCall(c))); }
    @PluginMethod public void setLocation(PluginCall c) { withRadio(c, r -> r.setLocation(new MeshCall(c))); }
    @PluginMethod public void sign(PluginCall c) { withRadio(c, r -> r.sign(new MeshCall(c))); }
    @PluginMethod public void verifyPhoneProof(PluginCall c) { withRadio(c, r -> r.verifyPhoneProof(new MeshCall(c))); }
    @PluginMethod public void setCredential(PluginCall c) { withRadio(c, r -> r.setCredential(new MeshCall(c))); }
    @PluginMethod public void getPeers(PluginCall c) { withRadio(c, r -> r.getPeers(new MeshCall(c))); }
    @PluginMethod public void getDiagnostics(PluginCall c) { withRadio(c, r -> r.getDiagnostics(new MeshCall(c))); }
    @PluginMethod public void copyDiagnostics(PluginCall c) { withRadio(c, r -> r.copyDiagnostics(new MeshCall(c))); }
    @PluginMethod public void scan(PluginCall c) { withRadio(c, r -> r.manual(() -> r.scan(new MeshCall(c)))); }
    @PluginMethod public void connect(PluginCall c) { withRadio(c, r -> r.manual(() -> r.connect(new MeshCall(c)))); }
    @PluginMethod public void exchange(PluginCall c) { withRadio(c, r -> r.exchange(new MeshCall(c))); }
    @PluginMethod public void ping(PluginCall c) { withRadio(c, r -> r.ping(new MeshCall(c))); }
    @PluginMethod public void reply(PluginCall c) { withRadio(c, r -> r.reply(new MeshCall(c))); }
    @PluginMethod public void disconnect(PluginCall c) { withRadio(c, r -> r.disconnect(new MeshCall(c))); }
    @PluginMethod public void stop(PluginCall c) { withRadio(c, r -> { r.stop(new MeshCall(c)); getContext().startService(new Intent(getContext(), MeshRadioService.class).setAction(MeshRadioService.STOP)); }); }
    @Override protected void handleOnPause() { foreground = false; if (radio != null) radio.setBridgeActive(false); }
    @Override protected void handleOnResume() { foreground = true; if (radio != null) radio.setBridgeActive(true); }
    @Override protected void handleOnDestroy() {
        if (radio != null) radio.attach(null);
        if (bound) getContext().unbindService(connection);
        bound = false; radio = null; waiting.clear();
    }
}
