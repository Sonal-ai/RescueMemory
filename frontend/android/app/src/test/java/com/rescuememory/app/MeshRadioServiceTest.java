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
        private byte[] publicKey;
        @Override byte[] identityPublicKey() throws Exception {
            if (publicKey == null) {
                java.security.KeyPairGenerator generator = java.security.KeyPairGenerator.getInstance("EC"); generator.initialize(256);
                publicKey = generator.generateKeyPair().getPublic().getEncoded();
            }
            return publicKey;
        }
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
        JSObject value; String error; volatile boolean completed;
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
    private JSObject identity(String proposed) throws Exception {
        Answer answer = new Answer(); radio.getIdentity(answer.call(new JSObject().put("nodeId", proposed)));
        long end = System.currentTimeMillis() + 3000;
        while (!answer.completed && System.currentTimeMillis() < end) Thread.sleep(10);
        assertTrue(answer.completed); assertNull(answer.error); return answer.value;
    }
    @Test public void restoredIdIsReboundBeforeMetadataAndProposedBrowserIdIsIgnored() throws Exception {
        android.content.SharedPreferences prefs = radio.getSharedPreferences("rescue.mesh", Context.MODE_PRIVATE);
        prefs.edit().putString("node_id", "copied-phone-id").putString("identity_key_fingerprint", "different-old-key").commit();
        String actual = identity("copied-phone-id").getString("node_id");
        assertEquals("node_" + MeshNodeIdentity.fingerprint(radio.identityPublicKey()), actual);
        assertEquals(actual, identity("another-copied-id").getString("node_id"));
        assertEquals(actual, prefs.getString("node_id", null));
    }
    @Test public void matchingLegacyResponderCredentialKeepsItsEnrolledNodeId() throws Exception {
        android.content.SharedPreferences prefs = radio.getSharedPreferences("rescue.mesh", Context.MODE_PRIVATE);
        String publicKey = android.util.Base64.encodeToString(radio.identityPublicKey(), android.util.Base64.NO_WRAP);
        JSObject claims = new JSObject().put("node_id", "enrolled-phone-id").put("public_key", publicKey);
        String payload = android.util.Base64.encodeToString(claims.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8), android.util.Base64.NO_WRAP);
        prefs.edit().putString("node_id", "enrolled-phone-id").putString("certificate", new JSObject().put("payload", payload).toString()).commit();
        assertEquals("enrolled-phone-id", identity("ignored-browser-id").getString("node_id"));
    }
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
    @Test public void minimumMtuConnectExchangesFramedIdentityAndBatteryInsteadOfParsing22Bytes() throws Exception {
        BluetoothDevice device = mock(BluetoothDevice.class); BluetoothGatt gatt = mock(BluetoothGatt.class);
        when(device.getAddress()).thenReturn("12:34:56:78:90:AB"); when(gatt.getDevice()).thenReturn(device);
        when(adapter.getRemoteDevice(device.getAddress())).thenReturn(device);
        when(device.connectGatt(any(Context.class), eq(false), any(BluetoothGattCallback.class), eq(BluetoothDevice.TRANSPORT_LE))).thenReturn(gatt);
        java.util.UUID serviceId = java.util.UUID.fromString("0000fe50-0000-1000-8000-00805f9b34fb");
        BluetoothGattService service = new BluetoothGattService(serviceId, BluetoothGattService.SERVICE_TYPE_PRIMARY);
        BluetoothGattCharacteristic rx = new BluetoothGattCharacteristic(java.util.UUID.fromString("0000fe52-0000-1000-8000-00805f9b34fb"), 8, 16);
        BluetoothGattCharacteristic tx = new BluetoothGattCharacteristic(java.util.UUID.fromString("0000fe53-0000-1000-8000-00805f9b34fb"), 2, 1);
        service.addCharacteristic(rx); service.addCharacteristic(tx); when(gatt.getService(serviceId)).thenReturn(service);
        final BluetoothGattCallback[] callback = new BluetoothGattCallback[1];
        final MeshFrames.Decoder decoder = new MeshFrames.Decoder();
        final java.util.ArrayDeque<byte[]> replies = new java.util.ArrayDeque<>();
        final List<String> requests = new ArrayList<>();
        String remote = "{\"v\":2,\"type\":\"presence\",\"node_id\":\"remote-phone\",\"name\":\"फोन 🆘\",\"battery\":97,\"charging\":true,\"battery_measured_at\":123456789}";
        when(gatt.writeCharacteristic(eq(rx), any(byte[].class), eq(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT))).thenAnswer(invocation -> {
            byte[] frame = invocation.getArgument(1); assertTrue(frame.length <= 20);
            byte[] complete = decoder.accept(frame);
            if (complete != null) {
                requests.add(new String(complete, java.nio.charset.StandardCharsets.UTF_8));
                Collections.addAll(replies, MeshFrames.encode(remote.getBytes(java.nio.charset.StandardCharsets.UTF_8), MeshFrames.id(frame), 21));
            }
            callback[0].onCharacteristicWrite(gatt, rx, BluetoothGatt.GATT_SUCCESS);
            return BluetoothStatusCodes.SUCCESS;
        });
        when(gatt.readCharacteristic(eq(tx))).thenAnswer(invocation -> {
            callback[0].onCharacteristicRead(gatt, tx, replies.removeFirst(), BluetoothGatt.GATT_SUCCESS); return true;
        });
        Answer answer = new Answer(); radio.connect(answer.call(new JSObject().put("address", device.getAddress()))); idle();
        ArgumentCaptor<BluetoothGattCallback> capture = ArgumentCaptor.forClass(BluetoothGattCallback.class);
        verify(device).connectGatt(any(Context.class), eq(false), capture.capture(), eq(BluetoothDevice.TRANSPORT_LE)); callback[0] = capture.getValue();
        callback[0].onServicesDiscovered(gatt, BluetoothGatt.GATT_SUCCESS); idle();
        assertTrue(answer.completed); assertNull(answer.error);
        assertEquals(97, answer.value.optInt("battery")); assertTrue(answer.value.optBoolean("charging"));
        assertEquals("फोन 🆘", answer.value.optString("name")); assertEquals("remote-phone", answer.value.optString("node_id"));
        assertEquals(1, requests.size()); assertEquals("presence", new JSObject(requests.get(0)).optString("type"));
        verify(gatt, atLeastOnce()).readCharacteristic(tx);
        assertEquals("remote-phone", state().optJSONArray("peers").getJSONObject(0).optString("node_id"));
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
