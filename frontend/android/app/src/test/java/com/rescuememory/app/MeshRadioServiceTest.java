package com.rescuememory.app;

import android.Manifest;
import android.bluetooth.*;
import android.bluetooth.le.*;
import android.content.Context;
import android.os.Looper;
import com.getcapacitor.JSObject;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Collections;
import android.os.ParcelUuid;
import org.junit.Before;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.ArgumentCaptor;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;
import static org.junit.Assert.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.robolectric.Shadows.shadowOf;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
@LooperMode(LooperMode.Mode.PAUSED)
public class MeshRadioServiceTest {
    public static class TestRadio extends MeshRadioService {
        BluetoothManager bluetooth;
        @Override public Object getSystemService(String name) {
            return Context.BLUETOOTH_SERVICE.equals(name) ? bluetooth : super.getSystemService(name);
        }
    }
    private TestRadio radio;
    private BluetoothManager manager;
    private BluetoothAdapter adapter;
    private BluetoothLeAdvertiser advertiser;
    private BluetoothLeScanner scanner;
    private BluetoothGattServer server;
    private BluetoothGattServerCallback serverCallback;
    private final List<String> events = new ArrayList<>();
    private static final class Answer {
        JSObject value; String error; boolean completed;
        MeshCall call(JSObject args) { return new MeshCall(args, (v, e) -> { value = v; error = e; completed = true; }); }
    }
    @Before public void setup() {
        shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_ADVERTISE);
        radio = Robolectric.buildService(TestRadio.class).create().get();
        shadowOf(radio.getSystemService(android.location.LocationManager.class)).setLocationEnabled(true);
        manager = mock(BluetoothManager.class); adapter = mock(BluetoothAdapter.class);
        advertiser = mock(BluetoothLeAdvertiser.class); scanner = mock(BluetoothLeScanner.class); server = mock(BluetoothGattServer.class);
        radio.bluetooth = manager;
        when(manager.getAdapter()).thenReturn(adapter); when(adapter.isEnabled()).thenReturn(true);
        when(adapter.getBluetoothLeAdvertiser()).thenReturn(advertiser); when(adapter.getBluetoothLeScanner()).thenReturn(scanner);
        when(manager.openGattServer(any(Context.class), any(BluetoothGattServerCallback.class))).thenAnswer(invocation -> { serverCallback = invocation.getArgument(1); return server; });
        when(server.addService(any(BluetoothGattService.class))).thenReturn(true);
        radio.attach((name, value) -> events.add(name + ":" + value));
    }
    private void idle() { shadowOf(Looper.getMainLooper()).idle(); }
    @After public void cleanup() { if (radio != null) radio.onDestroy(); }
    private JSObject state() { Answer answer = new Answer(); radio.getPeers(answer.call(new JSObject())); idle(); return answer.value; }
    private AdvertiseCallback register() {
        Answer start = new Answer(); radio.start(start.call(new JSObject())); idle();
        assertFalse(start.completed);
        serverCallback.onServiceAdded(BluetoothGatt.GATT_SUCCESS, new BluetoothGattService(java.util.UUID.randomUUID(), 0)); idle();
        ArgumentCaptor<AdvertiseCallback> callback = ArgumentCaptor.forClass(AdvertiseCallback.class);
        verify(advertiser).startAdvertising(any(AdvertiseSettings.class), any(AdvertiseData.class), callback.capture());
        return callback.getValue();
    }
    @Test public void readyRequiresAdvertisingSuccessRatherThanAllocatedCallback() {
        AdvertiseCallback callback = register();
        assertFalse(state().optBoolean("ready"));
        callback.onStartSuccess(new AdvertiseSettings.Builder().build()); idle();
        assertTrue(state().optBoolean("ready"));
    }
    @Test public void advertisingFailureExposesAndroidCodeAndKeepsReadyFalse() {
        AdvertiseCallback callback = register();
        callback.onStartFailure(AdvertiseCallback.ADVERTISE_FAILED_TOO_MANY_ADVERTISERS); idle();
        assertFalse(state().optBoolean("ready"));
        assertTrue(events.stream().anyMatch(e -> e.contains("ANDROID_ADVERTISE_2")));
        verify(server).close();
    }
    @Test public void missingStartupCallbackTimesOutInsteadOfHanging() {
        Answer start = new Answer(); radio.start(start.call(new JSObject())); idle();
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(10));
        assertTrue(start.completed); assertTrue(start.error.contains("START_TIMEOUT")); assertFalse(state().optBoolean("ready"));
    }
    @Test public void deniedLocationStopsScanningWithPermissionError() {
        shadowOf(RuntimeEnvironment.getApplication()).denyPermissions(Manifest.permission.ACCESS_FINE_LOCATION);
        Answer answer = new Answer(); radio.scan(answer.call(new JSObject())); idle();
        assertTrue(answer.error.contains("NEARBY_DENIED")); verifyNoInteractions(scanner);
        assertFalse(state().optBoolean("precise_location_permission"));
    }
    @Test public void disabledBluetoothCannotShowReadyOrStartAdvertising() {
        when(adapter.isEnabled()).thenReturn(false);
        Answer answer = new Answer(); radio.start(answer.call(new JSObject())); idle();
        assertTrue(answer.error.contains("BLUETOOTH_OFF")); assertFalse(state().optBoolean("ready")); verifyNoInteractions(advertiser);
    }
    @Test public void disabledLocationReportsExplicitScanPrerequisite() {
        shadowOf(radio.getSystemService(android.location.LocationManager.class)).setLocationEnabled(false);
        Answer answer = new Answer(); radio.scan(answer.call(new JSObject())); idle();
        assertTrue(answer.error.contains("LOCATION_SERVICES_OFF")); verifyNoInteractions(scanner);
    }
    private ScanCallback scan(Answer answer) {
        radio.scan(answer.call(new JSObject())); idle();
        ArgumentCaptor<ScanCallback> callback = ArgumentCaptor.forClass(ScanCallback.class);
        verify(scanner).startScan(anyList(), any(ScanSettings.class), callback.capture());
        return callback.getValue();
    }
    @Test public void scanObservationIsEmittedBeforeWindowCompletes() {
        Answer answer = new Answer(); ScanCallback callback = scan(answer);
        BluetoothDevice device = mock(BluetoothDevice.class); when(device.getAddress()).thenReturn("12:34:56:78:90:AB");
        ScanResult result = mock(ScanResult.class); when(result.getDevice()).thenReturn(device); when(result.getRssi()).thenReturn(-51);
        callback.onScanResult(ScanSettings.CALLBACK_TYPE_ALL_MATCHES, result); idle();
        assertFalse(answer.completed); assertTrue(events.stream().anyMatch(e -> e.startsWith("discovered:") && e.contains("12:34:56:78:90:AB")));
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(8));
        assertEquals(1, answer.value.optJSONArray("peers").length());
    }
    @Test public void scannerFailureIsNotReportedAsEmptySuccessfulScan() {
        Answer answer = new Answer(); scan(answer).onScanFailed(ScanCallback.SCAN_FAILED_APPLICATION_REGISTRATION_FAILED); idle();
        assertTrue(answer.completed); assertNull(answer.value); assertTrue(answer.error.contains("ANDROID_SCAN_2"));
    }
    @Test public void noAdvertisementsLeavesDiagnosticEvidenceWithoutFabricatingPeer() {
        Answer answer = new Answer(); scan(answer); shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(8));
        assertEquals(0, answer.value.optJSONArray("peers").length());
        assertTrue(events.stream().anyMatch(e -> e.contains("NO_APP_ADVERTISEMENTS")));
    }
    @Test public void androidConnectionFailureRetainsStatusAndReleasesGatt() {
        BluetoothDevice device = mock(BluetoothDevice.class); BluetoothGatt gatt = mock(BluetoothGatt.class);
        when(adapter.getRemoteDevice("12:34:56:78:90:AB")).thenReturn(device);
        when(device.connectGatt(any(Context.class), eq(false), any(BluetoothGattCallback.class), eq(BluetoothDevice.TRANSPORT_LE))).thenReturn(gatt);
        Answer answer = new Answer(); JSObject args = new JSObject(); args.put("address", "12:34:56:78:90:AB"); radio.connect(answer.call(args)); idle();
        ArgumentCaptor<BluetoothGattCallback> callback = ArgumentCaptor.forClass(BluetoothGattCallback.class);
        verify(device).connectGatt(any(Context.class), eq(false), callback.capture(), eq(BluetoothDevice.TRANSPORT_LE));
        callback.getValue().onConnectionStateChange(gatt, 133, BluetoothProfile.STATE_DISCONNECTED); idle();
        assertTrue(answer.error.contains("ANDROID_GATT_133")); verify(gatt).close();
    }
    @Test public void foregroundCompatibilityScanStillCountsOnlyAppAdvertisements() {
        Answer first = new Answer(); scan(first); shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(8));
        clearInvocations(scanner);
        Answer second = new Answer(); ScanCallback callback = scan(second);
        ArgumentCaptor<List<ScanFilter>> filters = ArgumentCaptor.forClass(List.class);
        verify(scanner).startScan(filters.capture(), any(ScanSettings.class), any(ScanCallback.class));
        assertTrue(filters.getValue().isEmpty());
        ScanRecord unrelated = mock(ScanRecord.class); when(unrelated.getServiceUuids()).thenReturn(Collections.singletonList(new ParcelUuid(java.util.UUID.randomUUID())));
        ScanResult unrelatedResult = mock(ScanResult.class); when(unrelatedResult.getScanRecord()).thenReturn(unrelated);
        callback.onScanResult(1, unrelatedResult); idle();
        ScanRecord app = mock(ScanRecord.class); when(app.getServiceUuids()).thenReturn(Collections.singletonList(ParcelUuid.fromString("0000fe50-0000-1000-8000-00805f9b34fb")));
        BluetoothDevice device = mock(BluetoothDevice.class); when(device.getAddress()).thenReturn("12:34:56:78:90:AB");
        ScanResult appResult = mock(ScanResult.class); when(appResult.getScanRecord()).thenReturn(app); when(appResult.getDevice()).thenReturn(device); when(appResult.getRssi()).thenReturn(-62);
        callback.onScanResult(1, appResult); idle(); shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(8));
        assertEquals(1, second.value.optJSONArray("peers").length());
    }
    @Test public void backgroundPresenceIdentifiesTheSenderWithoutWebViewOrReportSession() throws Exception {
        register(); radio.setBridgeActive(false); idle();
        BluetoothDevice device = mock(BluetoothDevice.class); when(device.getAddress()).thenReturn("12:34:56:78:90:AB");
        serverCallback.onConnectionStateChange(device, BluetoothGatt.GATT_SUCCESS, BluetoothProfile.STATE_CONNECTED); idle();
        BluetoothGattCharacteristic rx = new BluetoothGattCharacteristic(java.util.UUID.fromString("0000fe52-0000-1000-8000-00805f9b34fb"), BluetoothGattCharacteristic.PROPERTY_WRITE, BluetoothGattCharacteristic.PERMISSION_WRITE);
        byte[] payload = "{\"v\":2,\"type\":\"presence\",\"node_id\":\"remote-phone\",\"battery\":54}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        byte[][] frames = MeshFrames.encode(payload, 123, 20);
        for (byte[] frame : frames) { serverCallback.onCharacteristicWriteRequest(device, 1, rx, false, true, 0, frame); idle(); }
        JSObject snapshot = state();
        assertEquals(1, snapshot.optJSONArray("peers").length());
        assertEquals(54, snapshot.optJSONArray("peers").getJSONObject(0).optInt("battery"));
        assertEquals("remote-phone", snapshot.optJSONArray("peers").getJSONObject(0).optString("node_id"));
        assertFalse(events.stream().anyMatch(e -> e.startsWith("message:")));
        verify(server, times(frames.length)).sendResponse(eq(device), eq(1), eq(BluetoothGatt.GATT_SUCCESS), eq(0), isNull());
    }
}
