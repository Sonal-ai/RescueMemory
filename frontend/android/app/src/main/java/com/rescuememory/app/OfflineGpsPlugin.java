package com.rescuememory.app;

import android.Manifest;
import android.content.Context;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.HashMap;
import java.util.Map;

/** Satellite fixes directly from Android; no network or Google location service. */
@CapacitorPlugin(name = "OfflineGps", permissions = {
    @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION })
})
public class OfflineGpsPlugin extends Plugin {
    private final Map<String, LocationListener> watches = new HashMap<>();
    private final Map<String, PluginCall> calls = new HashMap<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private LocationManager manager;

    @Override public void load() {
        manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
    }

    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    public void watchPosition(PluginCall call) { authorize(call); }

    @PluginMethod public void getCurrentPosition(PluginCall call) { authorize(call); }

    private void authorize(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "locationAllowed");
        } else locationAllowed(call);
    }

    @PermissionCallback private void locationAllowed(PluginCall call) {
        if (!hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)) {
            call.reject("Allow precise Location permission for offline satellite GPS.");
            return;
        }
        getActivity().runOnUiThread(() -> begin(call));
    }

    private void begin(PluginCall call) {
        if (manager == null || !manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
            call.reject("Turn on device Location/GPS. Satellite GPS works without internet.");
            return;
        }
        final String id = call.getCallbackId();
        final boolean once = "getCurrentPosition".equals(call.getMethodName());
        final boolean[] received = { false };
        if (!once) call.setKeepAlive(true);
        LocationListener listener = new LocationListener() {
            @Override public void onLocationChanged(Location location) {
                if (!watches.containsKey(id)) return;
                received[0] = true;
                JSObject coords = new JSObject();
                coords.put("latitude", location.getLatitude());
                coords.put("longitude", location.getLongitude());
                coords.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : null);
                coords.put("speed", location.hasSpeed() ? location.getSpeed() : null);
                coords.put("heading", location.hasBearing() ? location.getBearing() : null);
                JSObject result = new JSObject();
                result.put("coords", coords);
                result.put("timestamp", location.getTime());
                call.resolve(result);
                if (once) clear(id);
            }
            @Override public void onProviderDisabled(String provider) {
                if (once) { call.reject("Device GPS was turned off."); clear(id); }
                else report(call, "Device GPS is off. Turn Location on; the map remains available.");
            }
            @Override public void onProviderEnabled(String provider) {}
            @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
        };
        watches.put(id, listener);
        calls.put(id, call);
        try {
            manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, listener, Looper.getMainLooper());
            handler.postDelayed(() -> {
                if (!watches.containsKey(id) || received[0]) return;
                if (once) { call.reject("No satellite fix yet. Move outdoors and keep Location enabled."); clear(id); }
                else report(call, "Acquiring satellite GPS. Move outdoors; no internet is needed.");
            }, 90000L);
        } catch (RuntimeException error) {
            call.reject("Satellite GPS could not start: " + error.getMessage());
            clear(id);
        }
    }

    private void report(PluginCall call, String message) {
        JSObject error = new JSObject(); error.put("message", message); error.put("code", "GPS_UNAVAILABLE");
        JSObject response = new JSObject(); response.put("error", error); call.resolve(response);
    }

    private void clear(String id) {
        LocationListener listener = watches.remove(id);
        if (listener != null && manager != null) manager.removeUpdates(listener);
        PluginCall previous = calls.remove(id);
        if (previous != null) { previous.setKeepAlive(false); bridge.releaseCall(previous); }
    }

    @PluginMethod public void clearWatch(PluginCall call) {
        getActivity().runOnUiThread(() -> { clear(call.getString("id", "")); call.resolve(); });
    }

    @Override protected void handleOnDestroy() {
        for (String id : watches.keySet().toArray(new String[0])) clear(id);
        handler.removeCallbacksAndMessages(null);
    }
}
