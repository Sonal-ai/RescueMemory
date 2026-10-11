package com.rescuememory.app;

import android.content.Context;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Looper;
import androidx.appcompat.app.AppCompatActivity;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.PluginCall;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.ArgumentCaptor;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;
import static org.junit.Assert.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
@LooperMode(LooperMode.Mode.PAUSED)
public class OfflineGpsPluginTest {
    private LocationManager manager;
    private OfflineGpsPlugin plugin;
    private Bridge bridge;
    private boolean precise = true;

    @Before public void setup() {
        manager = mock(LocationManager.class);
        Context context = mock(Context.class);
        when(context.getSystemService(Context.LOCATION_SERVICE)).thenReturn(manager);
        AppCompatActivity activity = Robolectric.buildActivity(AppCompatActivity.class).get();
        bridge = mock(Bridge.class);
        plugin = new OfflineGpsPlugin() {
            @Override public Context getContext() { return context; }
            @Override public AppCompatActivity getActivity() { return activity; }
            @Override public PermissionState getPermissionState(String alias) { return PermissionState.GRANTED; }
            @Override public boolean hasPermission(String permission) { return precise; }
        };
        plugin.setBridge(bridge);
        plugin.load();
        when(manager.isProviderEnabled(LocationManager.GPS_PROVIDER)).thenReturn(true);
    }

    @Test public void satelliteWatchWorksWithoutNetworkAndClearReleasesIt() throws Exception {
        PluginCall watch = mock(PluginCall.class);
        when(watch.getCallbackId()).thenReturn("watch");
        when(watch.getMethodName()).thenReturn("watchPosition");
        plugin.watchPosition(watch);
        ArgumentCaptor<LocationListener> listener = ArgumentCaptor.forClass(LocationListener.class);
        verify(manager).requestLocationUpdates(eq(LocationManager.GPS_PROVIDER), eq(1000L), eq(0f), listener.capture(), eq(Looper.getMainLooper()));
        verify(watch).setKeepAlive(true);
        Location fix = new Location(LocationManager.GPS_PROVIDER);
        fix.setLatitude(0); fix.setLongitude(0); fix.setAccuracy(3); fix.setTime(123456789);
        listener.getValue().onLocationChanged(fix);
        ArgumentCaptor<JSObject> response = ArgumentCaptor.forClass(JSObject.class);
        verify(watch).resolve(response.capture());
        assertEquals(0, response.getValue().getJSObject("coords").getDouble("latitude"), 0);
        assertEquals(123456789L, response.getValue().getLong("timestamp"));
        PluginCall clear = mock(PluginCall.class);
        when(clear.getString("id", "")).thenReturn("watch");
        plugin.clearWatch(clear);
        verify(manager).removeUpdates(listener.getValue());
        verify(bridge).releaseCall(watch);
    }

    @Test public void disabledGpsAndDeniedPrecisePermissionDoNotInventLocations() {
        PluginCall call = mock(PluginCall.class);
        when(manager.isProviderEnabled(LocationManager.GPS_PROVIDER)).thenReturn(false);
        plugin.watchPosition(call);
        verify(call).reject(contains("Turn on device Location"));
        verify(call, never()).resolve(any(JSObject.class));
        precise = false;
        PluginCall denied = mock(PluginCall.class);
        plugin.watchPosition(denied);
        verify(denied).reject(contains("precise Location"));
        verify(manager, never()).requestLocationUpdates(anyString(), anyLong(), anyFloat(), any(LocationListener.class), any(Looper.class));
    }
}
