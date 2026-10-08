package com.rescuememory.app;

import android.Manifest;
import android.bluetooth.*;
import android.bluetooth.le.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.*;
import android.security.keystore.*;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import com.getcapacitor.annotation.Permission;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.ECGenParameterSpec;
import java.util.*;

/** App-to-app BLE RPC. No OS bond; device keys stay in Android Keystore. */
@CapacitorPlugin(name = "RescueBle", permissions = {
    @Permission(strings = {Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT,
        Manifest.permission.BLUETOOTH_ADVERTISE}, alias = "nearby"),
    @Permission(strings = {Manifest.permission.ACCESS_FINE_LOCATION}, alias = "legacyLocation")
})
public class RescueBlePlugin extends Plugin {
    private static final UUID SERVICE = UUID.fromString("0000fe50-0000-1000-8000-00805f9b34fb"),
        META = UUID.fromString("0000fe51-0000-1000-8000-00805f9b34fb"),
        RX = UUID.fromString("0000fe52-0000-1000-8000-00805f9b34fb"),
        TX = UUID.fromString("0000fe53-0000-1000-8000-00805f9b34fb");
    private static final String KEY_ALIAS = "rescue.mesh.identity.v2";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Map<String, JSObject> found = new HashMap<>();
    private final Map<String, MeshFrames.Decoder> incoming = new HashMap<>();
    private final Map<String, Long> incomingAt = new HashMap<>();
    private final Map<String, ArrayDeque<byte[]>> responses = new HashMap<>();
    private final Map<String, Integer> peerMtus = new HashMap<>();
    private final Map<String, byte[]> metadataReads = new HashMap<>();
    private final Set<String> connectedClients = new HashSet<>();
    private BluetoothAdapter adapter;
    private BluetoothGattServer server;
    private BluetoothLeAdvertiser advertiser;
    private BluetoothLeScanner scanner;
    private AdvertiseCallback advertisement;
    private ScanCallback scanCallback;
    private PluginCall startCall, scanCall, connectCall, exchangeCall;
    private BluetoothGatt client;
    private int mtu = 23, messageId, outgoingIndex;
    private byte[][] outgoing;
    private MeshFrames.Decoder responseDecoder;
    private String deviceName = "RescueMemory phone";
    private volatile JSObject sharedLocation;
    private BroadcastReceiver adapterStateReceiver;

    @Override public void load() {
        adapterStateReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                int state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1);
                if (state != BluetoothAdapter.STATE_OFF && state != BluetoothAdapter.STATE_TURNING_OFF) return;
                handler.post(() -> {
                    PluginCall scanning = scanCall, starting = startCall;
                    startCall = null; finishScan(); advertisement = null; closeServer(); failClient("Bluetooth was turned off.");
                    if (scanning != null) scanning.reject("Bluetooth was turned off.");
                    if (starting != null) starting.reject("Bluetooth was turned off.");
                    JSObject event = new JSObject(); event.put("ready", false); notifyListeners("state", event);
                });
            }
        };
        ContextCompat.registerReceiver(getContext(), adapterStateReceiver, new IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED), ContextCompat.RECEIVER_EXPORTED);
    }

    private SharedPreferences preferences() { return getContext().getSharedPreferences("rescue.mesh", Context.MODE_PRIVATE); }
    private synchronized KeyStore keyStore() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(KEY_ALIAS)) {
            KeyPairGenerator gen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
            gen.initialize(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
                .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).build());
            gen.generateKeyPair();
        }
        return store;
    }
    private JSObject identity() throws Exception {
        String id = preferences().getString("node_id", null);
        if (id == null) { id = "node_" + UUID.randomUUID(); preferences().edit().putString("node_id", id).commit(); }
        JSObject obj = new JSObject(); obj.put("node_id", id); obj.put("name", deviceName); obj.put("v", 2);
        obj.put("public_key", Base64.encodeToString(keyStore().getCertificate(KEY_ALIAS).getPublicKey().getEncoded(), Base64.NO_WRAP));
        String cert = preferences().getString("certificate", null); if (cert != null) obj.put("certificate", new JSObject(cert));
        return obj;
    }
    private JSObject battery() {
        JSObject obj = new JSObject(); Intent state = getContext().registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        int level = state == null ? -1 : state.getIntExtra(BatteryManager.EXTRA_LEVEL, -1), scale = state == null ? -1 : state.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
        if (level >= 0 && scale > 0) obj.put("battery", Math.round(level * 100f / scale));
        int status = state == null ? -1 : state.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
        obj.put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL);
        obj.put("battery_measured_at", System.currentTimeMillis()); return obj;
    }
    private JSObject metadata() throws Exception {
        JSObject obj = battery(); obj.put("v", 2); obj.put("node_id", identity().getString("node_id")); obj.put("name", deviceName);
        if (sharedLocation != null) obj.put("location", sharedLocation);
        obj.put("capabilities", "exchange-v2"); return obj;
    }
    @PluginMethod public void getIdentity(PluginCall call) {
        String name = call.getString("name"); if (name != null && !name.isEmpty()) deviceName = name.substring(0, Math.min(name.length(), 80));
        String proposed = call.getString("nodeId");
        if (!preferences().contains("node_id") && proposed != null && !proposed.isEmpty()) preferences().edit().putString("node_id", proposed).commit();
        getBridge().execute(() -> { try { call.resolve(identity()); } catch (Exception e) { call.reject("Could not initialize device identity.", e); } });
    }
    @PluginMethod public void getBattery(PluginCall call) { call.resolve(battery()); }
    @PluginMethod public void setLocation(PluginCall call) {
        JSObject location = call.getObject("location");
        if (location == null) { sharedLocation = null; call.resolve(); return; }
        double lat = location.optDouble("lat", Double.NaN), lon = location.optDouble("lon", Double.NaN);
        long timestamp = location.optLong("timestamp", 0);
        if (!Double.isFinite(lat) || !Double.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || timestamp <= 0) {
            call.reject("Invalid GPS location."); return;
        }
        sharedLocation = location; call.resolve();
    }
    @PluginMethod public void sign(PluginCall call) {
        getBridge().execute(() -> { try {
            byte[] bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
            if (bytes.length > 8192) throw new IllegalArgumentException("Signing input too large");
            KeyStore store = keyStore();
            Signature sig = Signature.getInstance("SHA256withECDSA"); sig.initSign((PrivateKey)store.getKey(KEY_ALIAS, null)); sig.update(bytes);
            byte[] signature = sig.sign(), publicKey = store.getCertificate(KEY_ALIAS).getPublicKey().getEncoded();
            if (!MeshIdentityProof.verify(publicKey, signature, bytes)) throw new SignatureException("Local Keystore proof verification failed");
            JSObject obj = new JSObject(); obj.put("signature", Base64.encodeToString(signature, Base64.NO_WRAP));
            obj.put("public_key", Base64.encodeToString(publicKey, Base64.NO_WRAP)); call.resolve(obj);
        } catch (Exception e) { call.reject("Device signing failed.", e); } });
    }
    @PluginMethod public void verifyPhoneProof(PluginCall call) {
        getBridge().execute(() -> { try {
            byte[] publicKey = Base64.decode(call.getString("publicKey", ""), Base64.DEFAULT);
            byte[] signature = Base64.decode(call.getString("signature", ""), Base64.DEFAULT);
            byte[] bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
            JSObject result = new JSObject(); result.put("valid", MeshIdentityProof.verify(publicKey, signature, bytes)); call.resolve(result);
        } catch (Exception e) { call.reject("Android identity verifier could not read this phone's key or proof (" + e.getClass().getSimpleName() + "). Update both phones and retry.", e); } });
    }
    @PluginMethod public void setCredential(PluginCall call) {
        JSObject cert = call.getObject("certificate");
        if (cert == null) preferences().edit().remove("certificate").commit(); else preferences().edit().putString("certificate", cert.toString()).commit();
        call.resolve();
    }
    private boolean ready(PluginCall call) {
        BluetoothManager manager = (BluetoothManager)getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        adapter = manager == null ? null : manager.getAdapter();
        if (adapter == null || !adapter.isEnabled()) { call.reject("Turn on Bluetooth in Android settings."); return false; } return true;
    }
    private boolean permitted() {
        if (Build.VERSION.SDK_INT < 31) return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        for (String p : new String[]{Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_ADVERTISE})
            if (ContextCompat.checkSelfPermission(getContext(), p) != PackageManager.PERMISSION_GRANTED) return false;
        return true;
    }
    @PluginMethod public void start(PluginCall call) {
        if (!permitted()) requestPermissionForAlias(Build.VERSION.SDK_INT >= 31 ? "nearby" : "legacyLocation", call, "startAllowed"); else startAllowed(call);
    }
    @PermissionCallback private void startAllowed(PluginCall call) {
        if (!permitted()) { call.reject("Nearby devices permission is required."); return; } if (!ready(call)) return;
        if (advertisement != null) { call.resolve(); return; } if (startCall != null) { call.reject("Bluetooth receiver is starting."); return; }
        BluetoothManager manager = (BluetoothManager)getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        advertiser = adapter.getBluetoothLeAdvertiser(); if (advertiser == null) { call.reject("This phone cannot advertise Bluetooth."); return; }
        server = manager.openGattServer(getContext(), serverCallback); if (server == null) { call.reject("Could not open Bluetooth receiver."); return; }
        BluetoothGattService service = new BluetoothGattService(SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY);
        service.addCharacteristic(new BluetoothGattCharacteristic(META, BluetoothGattCharacteristic.PROPERTY_READ, BluetoothGattCharacteristic.PERMISSION_READ));
        service.addCharacteristic(new BluetoothGattCharacteristic(RX, BluetoothGattCharacteristic.PROPERTY_WRITE, BluetoothGattCharacteristic.PERMISSION_WRITE));
        service.addCharacteristic(new BluetoothGattCharacteristic(TX, BluetoothGattCharacteristic.PROPERTY_READ, BluetoothGattCharacteristic.PERMISSION_READ));
        startCall = call;
        if (!server.addService(service)) { startCall = null; closeServer(); call.reject("Could not register Bluetooth service."); }
    }
    private void advertise(int status) {
        PluginCall pending = startCall; startCall = null; if (pending == null) return;
        if (status != BluetoothGatt.GATT_SUCCESS) { pending.reject("Bluetooth service registration failed."); closeServer(); return; }
        advertisement = new AdvertiseCallback() {
            @Override public void onStartSuccess(AdvertiseSettings settings) { pending.resolve(); }
            @Override public void onStartFailure(int code) { advertisement = null; closeServer(); pending.reject("Bluetooth advertising failed (" + code + ")."); }
        };
        try { advertiser.startAdvertising(new AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_POWER).setConnectable(true).build(),
            new AdvertiseData.Builder().addServiceUuid(new ParcelUuid(SERVICE)).build(), advertisement); }
        catch (Exception e) { advertisement = null; closeServer(); pending.reject("Could not advertise Bluetooth.", e); }
    }
    @PluginMethod public void scan(PluginCall call) { handler.post(() -> {
        if (!permitted()) { call.reject("Nearby devices permission is required."); return; } if (!ready(call)) return;
        if (scanCall != null || connectCall != null || exchangeCall != null) { call.reject("A Bluetooth operation is already running."); return; }
        scanner = adapter.getBluetoothLeScanner(); found.clear(); scanCall = call;
        if (scanner == null) { scanCall = null; call.reject("Bluetooth scanner unavailable."); return; }
        scanCallback = new ScanCallback() {
            @Override public void onScanResult(int type, ScanResult result) { handler.post(() -> {
                if (scanCall == null || found.size() >= 32) return; JSObject p = new JSObject(); p.put("address", result.getDevice().getAddress());
                p.put("rssi", result.getRssi()); p.put("name", "Nearby RescueMemory phone"); found.put(result.getDevice().getAddress(), p); }); }
            @Override public void onScanFailed(int code) { handler.post(() -> { PluginCall p = scanCall; finishScan(); if (p != null) p.reject("Bluetooth scan failed (" + code + ")."); }); }
        };
        try { scanner.startScan(Collections.singletonList(new ScanFilter.Builder().setServiceUuid(new ParcelUuid(SERVICE)).build()),
            new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanCallback);
            handler.postDelayed(() -> { if (scanCall != call) return; JSArray peers = new JSArray(); for (JSObject p : found.values()) peers.put(p);
                JSObject obj = new JSObject(); obj.put("peers", peers); finishScan(); call.resolve(obj); }, 8000);
        } catch (Exception e) { finishScan(); call.reject("Could not scan Bluetooth.", e); }
    }); }
    private void finishScan() {
        if (scanner != null && scanCallback != null) try { scanner.stopScan(scanCallback); } catch (Exception ignored) {} scanCall = null; scanCallback = null;
    }
    @PluginMethod public void connect(PluginCall call) { handler.post(() -> {
        if (!permitted()) { call.reject("Nearby devices permission required."); return; } if (!ready(call)) return;
        if (scanCall != null || connectCall != null || exchangeCall != null) { call.reject("Bluetooth is busy."); return; }
        closeClient(); connectCall = call; mtu = 23;
        try { client = adapter.getRemoteDevice(call.getString("address", "")).connectGatt(getContext(), false, clientCallback, BluetoothDevice.TRANSPORT_LE); }
        catch (Exception e) { failClient("Could not connect to nearby phone."); }
        handler.postDelayed(() -> { if (connectCall == call) failClient("Nearby phone did not respond. Try again."); }, 15000);
    }); }
    @PluginMethod public void exchange(PluginCall call) { handler.post(() -> {
        if (client == null || connectCall != null || exchangeCall != null) { call.reject("Bluetooth connection is unavailable or busy."); return; }
        try { messageId = new SecureRandom().nextInt();
            byte[][] frames = MeshFrames.encode(call.getString("payload", "").getBytes(StandardCharsets.UTF_8), messageId, mtu - 3);
            outgoing = frames; outgoingIndex = 0; responseDecoder = new MeshFrames.Decoder(); exchangeCall = call; writeNext();
            handler.postDelayed(() -> { if (exchangeCall == call) failClient("Sync response timed out. Retry to continue."); }, 45000);
        } catch (Exception e) { if (exchangeCall == call) failClient("Invalid sync request."); else call.reject("Invalid or oversized sync request."); }
    }); }
    private BluetoothGattCharacteristic characteristic(UUID uuid) {
        return client == null || client.getService(SERVICE) == null ? null : client.getService(SERVICE).getCharacteristic(uuid);
    }
    private void readMetadata() {
        BluetoothGattCharacteristic c = characteristic(META);
        if (c == null) { failClient("Update required: nearby phone uses the old transfer."); return; }
        if (!client.readCharacteristic(c)) failClient("Could not read nearby phone details.");
    }
    private void writeNext() {
        BluetoothGattCharacteristic c = characteristic(RX); if (c == null) { failClient("Nearby phone has no sync receiver."); return; }
        boolean ok;
        if (Build.VERSION.SDK_INT >= 33) ok = client.writeCharacteristic(c, outgoing[outgoingIndex], BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothStatusCodes.SUCCESS;
        else { c.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT); c.setValue(outgoing[outgoingIndex]); ok = client.writeCharacteristic(c); }
        if (!ok) failClient("Bluetooth write failed.");
    }
    private void pollResponse() {
        if (exchangeCall == null || client == null) return; BluetoothGattCharacteristic c = characteristic(TX);
        if (c == null || !client.readCharacteristic(c)) failClient("Could not read sync response.");
    }
    private final BluetoothGattCallback clientCallback = new BluetoothGattCallback() {
        @Override public void onConnectionStateChange(BluetoothGatt g, int status, int state) { handler.post(() -> {
            if (g != client) return;
            if (status != BluetoothGatt.GATT_SUCCESS || state == BluetoothProfile.STATE_DISCONNECTED) { failClient("Nearby phone disconnected. Retry to continue."); return; }
            if (state == BluetoothProfile.STATE_CONNECTED && !g.discoverServices()) failClient("Could not discover nearby phone service."); }); }
        @Override public void onServicesDiscovered(BluetoothGatt g, int status) { handler.post(() -> {
            if (g != client) return; if (status != BluetoothGatt.GATT_SUCCESS || characteristic(TX) == null) { failClient("Update required on nearby phone."); return; }
            if (!g.requestMtu(247)) readMetadata(); }); }
        @Override public void onMtuChanged(BluetoothGatt g, int value, int status) { handler.post(() -> {
            if (g != client) return; mtu = status == BluetoothGatt.GATT_SUCCESS ? Math.min(value, 517) : 23; readMetadata(); }); }
        @Override public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic c, int status) { handler.post(() -> {
            if (g != client || exchangeCall == null) return; if (status != BluetoothGatt.GATT_SUCCESS) { failClient("Bluetooth transfer interrupted."); return; }
            if (++outgoingIndex < outgoing.length) writeNext(); else pollResponse(); }); }
        @Override public void onCharacteristicRead(BluetoothGatt g, BluetoothGattCharacteristic c, byte[] value, int status) { readResult(g, c, value, status); }
        @Override public void onCharacteristicRead(BluetoothGatt g, BluetoothGattCharacteristic c, int status) {
            if (Build.VERSION.SDK_INT < 33) readResult(g, c, c.getValue(), status);
        }
    };
    private void readResult(BluetoothGatt g, BluetoothGattCharacteristic c, byte[] value, int status) { handler.post(() -> {
        if (g != client) return; if (status != BluetoothGatt.GATT_SUCCESS) { failClient("Could not read Bluetooth response."); return; }
        try {
            if (META.equals(c.getUuid()) && connectCall != null) {
                JSObject obj = new JSObject(new String(value, StandardCharsets.UTF_8)); obj.put("address", g.getDevice().getAddress());
                PluginCall done = connectCall; connectCall = null; done.resolve(obj); return;
            }
            if (TX.equals(c.getUuid()) && exchangeCall != null) {
                if (value == null || value.length == 0) { handler.postDelayed(this::pollResponse, 120); return; }
                if (value.length < MeshFrames.HEADER || MeshFrames.id(value) != messageId) { failClient("Invalid sync response identity."); return; }
                byte[] payload = responseDecoder.accept(value);
                if (payload == null) pollResponse(); else { JSObject obj = new JSObject(); obj.put("payload", new String(payload, StandardCharsets.UTF_8));
                    PluginCall done = exchangeCall; exchangeCall = null; outgoing = null; responseDecoder = null; done.resolve(obj); }
            }
        } catch (Exception e) { failClient("Malformed Bluetooth response."); }
    }); }
    private final BluetoothGattServerCallback serverCallback = new BluetoothGattServerCallback() {
        @Override public void onServiceAdded(int status, BluetoothGattService service) { handler.post(() -> advertise(status)); }
        @Override public void onConnectionStateChange(BluetoothDevice d, int status, int state) { handler.post(() -> {
            if (state == BluetoothProfile.STATE_CONNECTED) connectedClients.add(d.getAddress());
            else { connectedClients.remove(d.getAddress()); responses.remove(d.getAddress()); peerMtus.remove(d.getAddress()); metadataReads.remove(d.getAddress()); incoming.remove(d.getAddress()); incomingAt.remove(d.getAddress());
                JSObject event = new JSObject(); event.put("address", d.getAddress()); notifyListeners("disconnected", event); }
        }); }
        @Override public void onMtuChanged(BluetoothDevice d, int value) { handler.post(() -> peerMtus.put(d.getAddress(), Math.min(value, 517))); }
        @Override public void onCharacteristicReadRequest(BluetoothDevice d, int requestId, int offset, BluetoothGattCharacteristic c) { handler.post(() -> {
            if (server == null) return;
            try { byte[] value;
                if (META.equals(c.getUuid())) {
                    if (offset == 0) metadataReads.put(d.getAddress(), metadata().toString().getBytes(StandardCharsets.UTF_8));
                    byte[] full = metadataReads.get(d.getAddress());
                    if (full == null) { server.sendResponse(d, requestId, BluetoothGatt.GATT_FAILURE, offset, null); return; }
                    if (offset > full.length) { server.sendResponse(d, requestId, BluetoothGatt.GATT_INVALID_OFFSET, offset, null); return; }
                    value = Arrays.copyOfRange(full, offset, Math.min(full.length, offset + peerMtus.getOrDefault(d.getAddress(), 23) - 1));
                } else if (TX.equals(c.getUuid()) && offset == 0) {
                    ArrayDeque<byte[]> queue = responses.get(d.getAddress()); value = queue == null || queue.isEmpty() ? new byte[0] : queue.removeFirst();
                } else { server.sendResponse(d, requestId, BluetoothGatt.GATT_FAILURE, offset, null); return; }
                server.sendResponse(d, requestId, BluetoothGatt.GATT_SUCCESS, offset, value);
            } catch (Exception e) { server.sendResponse(d, requestId, BluetoothGatt.GATT_FAILURE, offset, null); }
        }); }
        @Override public void onCharacteristicWriteRequest(BluetoothDevice d, int requestId, BluetoothGattCharacteristic c, boolean prepared, boolean responseNeeded, int offset, byte[] value) { handler.post(() -> {
            if (server == null) return; boolean valid = !prepared && offset == 0 && RX.equals(c.getUuid());
            try {
                if (!valid) throw new IllegalArgumentException(); String address = d.getAddress();
                incomingAt.entrySet().removeIf(e -> { if (System.currentTimeMillis() - e.getValue() < 45000) return false; incoming.remove(e.getKey()); return true; });
                if (!incoming.containsKey(address) && incoming.size() >= 32) throw new IllegalArgumentException();
                MeshFrames.Decoder decoder = incoming.computeIfAbsent(address, key -> new MeshFrames.Decoder());
                incomingAt.put(address, System.currentTimeMillis()); byte[] payload = decoder.accept(value);
                if (payload != null) { incoming.remove(address); incomingAt.remove(address); responses.remove(address);
                    JSObject event = new JSObject(); event.put("address", address); event.put("message_id", MeshFrames.id(value));
                    event.put("payload", new String(payload, StandardCharsets.UTF_8)); notifyListeners("message", event); }
            } catch (Exception e) { valid = false; incoming.remove(d.getAddress()); incomingAt.remove(d.getAddress()); }
            if (responseNeeded) server.sendResponse(d, requestId, valid ? BluetoothGatt.GATT_SUCCESS : BluetoothGatt.GATT_FAILURE, 0, null);
        }); }
    };
    @PluginMethod public void reply(PluginCall call) { handler.post(() -> {
        String address = call.getString("address", ""); if (!connectedClients.contains(address)) { call.reject("Nearby phone disconnected before acknowledgement."); return; }
        // Keep reads shorter than MTU-1 so Android does not issue a long-read blob request.
        try { byte[][] frames = MeshFrames.encode(call.getString("payload", "").getBytes(StandardCharsets.UTF_8), call.getInt("messageId", 0), peerMtus.getOrDefault(address, 23) - 2);
            responses.put(address, new ArrayDeque<>(Arrays.asList(frames))); call.resolve();
        } catch (Exception e) { call.reject("Could not create Bluetooth response.", e); }
    }); }
    private void failClient(String message) {
        PluginCall c = connectCall, e = exchangeCall; connectCall = null; exchangeCall = null; closeClient(); if (c != null) c.reject(message); if (e != null) e.reject(message);
    }
    private void closeClient() { if (client != null) { BluetoothGatt g = client; client = null; try { g.disconnect(); g.close(); } catch (Exception ignored) {} } outgoing = null; responseDecoder = null; }
    private void closeServer() { if (server != null) { server.close(); server = null; } incoming.clear(); incomingAt.clear(); responses.clear(); peerMtus.clear(); metadataReads.clear(); connectedClients.clear(); }
    @PluginMethod public void disconnect(PluginCall call) { handler.post(() -> { failClient("Bluetooth operation cancelled."); call.resolve(); }); }
    @PluginMethod public void stop(PluginCall call) { handler.post(() -> {
        PluginCall starting = startCall; startCall = null;
        if (starting != null) starting.reject("Bluetooth receiver stopped before startup completed.");
        PluginCall scanning = scanCall; finishScan(); if (scanning != null) scanning.reject("Bluetooth scan stopped.");
        if (advertiser != null && advertisement != null) try { advertiser.stopAdvertising(advertisement); } catch (Exception ignored) {}
        advertisement = null; closeServer(); failClient("Bluetooth receiver stopped."); call.resolve();
    }); }
    @Override protected void handleOnDestroy() {
        if (adapterStateReceiver != null) try { getContext().unregisterReceiver(adapterStateReceiver); } catch (Exception ignored) {}
        finishScan(); if (advertiser != null && advertisement != null) try { advertiser.stopAdvertising(advertisement); } catch (Exception ignored) {}
        closeServer(); failClient("App closed.");
    }
}
