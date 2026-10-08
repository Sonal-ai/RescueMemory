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


import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.ECGenParameterSpec;
import java.util.*;

/** App-to-app BLE RPC. No OS bond; device keys stay in Android Keystore. */
public class MeshRadioService extends android.app.Service {
    static final String STOP = "com.rescuememory.app.STOP_MESH";
    private final java.util.concurrent.ExecutorService cryptoWorker = java.util.concurrent.Executors.newSingleThreadExecutor();
    private java.util.function.BiConsumer<String, JSObject> eventSink;
    private final Map<String, JSObject> knownPeers = new LinkedHashMap<>();
    private final Map<String, Long> pingedAt = new HashMap<>();
    private boolean running, backgroundOperation;
    private int generation;
    private final Runnable discovery = this::discoveryCycle;
    public final class LocalBinder extends Binder { MeshRadioService service() { return MeshRadioService.this; } }
    @Override public IBinder onBind(Intent intent) { return new LocalBinder(); }
    private Context thisContext() { return this; }
    boolean paused() { return preferences().getBoolean("paused", false); }
    void resumeMesh() { preferences().edit().putBoolean("paused", false).apply(); }
    void attach(java.util.function.BiConsumer<String, JSObject> sink) { eventSink = sink; }
    private void notifyListeners(String name, JSObject event) { if (eventSink != null) eventSink.accept(name, event); }
    private void emitReady(boolean ready) { JSObject event = new JSObject(); event.put("ready", ready); notifyListeners("state", event); }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && STOP.equals(intent.getAction())) {
            preferences().edit().putBoolean("paused", true).apply();
            running = false; handler.removeCallbacks(discovery);
            stop(new MeshCall(new JSObject(), (v, e) -> { emitReady(false); stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); }));
            return START_NOT_STICKY;
        }
        android.app.NotificationManager manager = getSystemService(android.app.NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new android.app.NotificationChannel("rescue_mesh", "Nearby mesh", android.app.NotificationManager.IMPORTANCE_LOW));
        android.app.PendingIntent open = android.app.PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_UPDATE_CURRENT);
        android.app.PendingIntent stop = android.app.PendingIntent.getService(this, 1, new Intent(this, MeshRadioService.class).setAction(STOP), android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_UPDATE_CURRENT);
        android.app.Notification notification = new androidx.core.app.NotificationCompat.Builder(this, "rescue_mesh")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth).setContentTitle("RescueMemory nearby mesh")
            .setContentText("Finding nearby phones and exchanging presence pings")
            .setContentIntent(open).setOngoing(true).addAction(0, "Stop mesh", stop).build();
        if (Build.VERSION.SDK_INT >= 29) {
            int type = android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE;
            // Android 10/11 treat BLE scanning as location access. Nearby devices
            // permissions replace that requirement on Android 12 and later.
            if (Build.VERSION.SDK_INT <= 30) type |= android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
            startForeground(50, notification, type);
        }
        else startForeground(50, notification);
        running = true; scheduleDiscovery(1000); return START_NOT_STICKY;
    }
    void manual(Runnable command) {
        handler.post(() -> {
            // A foreground operation takes priority over a discovery ping.
            if (backgroundOperation) {
                generation++; backgroundOperation = false;
                MeshCall scanning = scanCall; finishScan(); if (scanning != null) scanning.reject("Discovery yielded to foreground sync.");
                failClient("Discovery yielded to foreground sync.");
            }
            command.run();
        });
    }
    public void getPeers(MeshCall call) { handler.post(() -> {
        JSArray list = new JSArray(); long now = System.currentTimeMillis();
        knownPeers.entrySet().removeIf(e -> now - e.getValue().optLong("last_seen_epoch") > 300000);
        for (JSObject p : knownPeers.values()) list.put(p);
        JSObject result = new JSObject(); result.put("peers", list); result.put("ready", advertisement != null); result.put("paused", paused()); result.put("background_busy", backgroundOperation); call.resolve(result);
    }); }
    private void scheduleDiscovery(long delay) { handler.removeCallbacks(discovery); if (running) handler.postDelayed(discovery, delay); }
    private void discoveryCycle() {
        scheduleDiscovery(30000 + new SecureRandom().nextInt(5000));
        if (!running || !permitted() || advertisement == null || scanCall != null || client != null || !connectedClients.isEmpty() || backgroundOperation) return;
        backgroundOperation = true; final int token = ++generation;
        scan(new MeshCall(new JSObject(), (result, error) -> {
            if (generation != token) return;
            if (error != null) { backgroundOperation = false; return; }
            // Ping the least recently contacted phone, one per cycle to bound radio use.
            String address = found.keySet().stream().min(Comparator.comparingLong(a -> pingedAt.getOrDefault(a, 0L))).orElse(null);
            if (address == null || !connectedClients.isEmpty()) { backgroundOperation = false; return; }
            pingedAt.put(address, System.currentTimeMillis());
            JSObject args = new JSObject(); args.put("address", address);
            connect(new MeshCall(args, (meta, connectError) -> {
                if (generation != token) return;
                if (connectError != null) { backgroundOperation = false; return; }
                try {
                    JSObject ping = metadata(); ping.put("type", "presence");
                    JSObject request = new JSObject(); request.put("payload", ping.toString());
                    exchange(new MeshCall(request, (response, exchangeError) -> {
                        if (generation != token) return;
                        if (exchangeError == null) try { JSObject pong = new JSObject(response.getString("payload"));
                            if ("presence".equals(pong.optString("type"))) rememberPresence(pong, address, found.get(address), true);
                        } catch (Exception ignored) {}
                        closeClient(); backgroundOperation = false;
                    }));
                } catch (Exception e) { closeClient(); backgroundOperation = false; }
            }));
        }));
    }
    private void rememberPresence(JSObject meta, String address, JSObject observed, boolean outbound) {
        String id = meta.optString("node_id", "");
        if (id.isEmpty() || id.length() > 100 || id.equals(preferences().getString("node_id", ""))) return;
        JSObject previous = knownPeers.get(id);
        // Android may use different random addresses in its central/peripheral
        // roles. Keep a recently discovered connectable address on incoming pings.
        if (!outbound && previous != null && System.currentTimeMillis() - previous.optLong("connectable_at") < 120000) {
            address = previous.optString("address", address); meta.put("connectable_at", previous.optLong("connectable_at"));
        } else if (outbound) meta.put("connectable_at", System.currentTimeMillis());
        meta.put("address", address); meta.put("last_seen_epoch", System.currentTimeMillis());
        if (observed != null) meta.put("rssi", observed.optInt("rssi", -80));
        else { JSObject old = knownPeers.get(id); if (old != null && old.has("rssi")) meta.put("rssi", old.optInt("rssi")); }
        knownPeers.put(id, meta); if (knownPeers.size() > 64) knownPeers.remove(knownPeers.keySet().iterator().next());
        notifyListeners("presence", meta);
    }
    private boolean handlePresence(String address, int message, String payload) {
        try {
            JSObject ping = new JSObject(payload);
            if (!"presence".equals(ping.optString("type")) || ping.optInt("v") != 2) return false;
            // Presence is discovery telemetry only. It never authorizes report access.
            rememberPresence(ping, address, null, false);
            JSObject pong = metadata(); pong.put("type", "presence");
            responses.put(address, new ArrayDeque<>(Arrays.asList(MeshFrames.encode(pong.toString().getBytes(StandardCharsets.UTF_8), message, peerMtus.getOrDefault(address, 23) - 2))));
            return true;
        } catch (Exception e) { return false; }
    }
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
    private MeshCall startCall, scanCall, connectCall, exchangeCall;
    private BluetoothGatt client;
    private int mtu = 23, messageId, outgoingIndex;
    private boolean metadataReadStarted;
    private boolean bridgeActive = true;
    void setBridgeActive(boolean active) { handler.post(() -> bridgeActive = active); }
    private byte[][] outgoing;
    private MeshFrames.Decoder responseDecoder;
    private String deviceName = "RescueMemory phone";
    private volatile JSObject sharedLocation;
    private BroadcastReceiver adapterStateReceiver;

    @Override public void onCreate() {
        super.onCreate();
        adapterStateReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                int state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1);
                if (state == BluetoothAdapter.STATE_ON) { handler.post(() -> { if (running && permitted()) start(new MeshCall(new JSObject(), (v, e) -> {})); }); return; }
                if (state != BluetoothAdapter.STATE_OFF && state != BluetoothAdapter.STATE_TURNING_OFF) return;
                handler.post(() -> {
                    MeshCall scanning = scanCall, starting = startCall;
                    startCall = null; finishScan(); advertisement = null; closeServer(); failClient("Bluetooth was turned off.");
                    if (scanning != null) scanning.reject("Bluetooth was turned off.");
                    if (starting != null) starting.reject("Bluetooth was turned off.");
                    JSObject event = new JSObject(); event.put("ready", false); notifyListeners("state", event);
                });
            }
        };
        ContextCompat.registerReceiver(thisContext(), adapterStateReceiver, new IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED), ContextCompat.RECEIVER_EXPORTED);
    }

    private SharedPreferences preferences() { return thisContext().getSharedPreferences("rescue.mesh", Context.MODE_PRIVATE); }
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
        JSObject obj = new JSObject(); Intent state = thisContext().registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
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
    public void getIdentity(MeshCall call) {
        String name = call.getString("name"); if (name != null && !name.isEmpty()) deviceName = name.substring(0, Math.min(name.length(), 80));
        String proposed = call.getString("nodeId");
        if (!preferences().contains("node_id") && proposed != null && !proposed.isEmpty()) preferences().edit().putString("node_id", proposed).commit();
        cryptoWorker.execute(() -> { try { call.resolve(identity()); } catch (Exception e) { call.reject("Could not initialize device identity.", e); } });
    }
    public void getBattery(MeshCall call) { call.resolve(battery()); }
    public void setLocation(MeshCall call) {
        JSObject location = call.getObject("location");
        if (location == null) { sharedLocation = null; call.resolve(); return; }
        double lat = location.optDouble("lat", Double.NaN), lon = location.optDouble("lon", Double.NaN);
        long timestamp = location.optLong("timestamp", 0);
        if (!Double.isFinite(lat) || !Double.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || timestamp <= 0) {
            call.reject("Invalid GPS location."); return;
        }
        sharedLocation = location; call.resolve();
    }
    public void sign(MeshCall call) {
        cryptoWorker.execute(() -> { try {
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
    public void verifyPhoneProof(MeshCall call) {
        cryptoWorker.execute(() -> { try {
            byte[] publicKey = Base64.decode(call.getString("publicKey", ""), Base64.DEFAULT);
            byte[] signature = Base64.decode(call.getString("signature", ""), Base64.DEFAULT);
            byte[] bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
            JSObject result = new JSObject(); result.put("valid", MeshIdentityProof.verify(publicKey, signature, bytes)); call.resolve(result);
        } catch (Exception e) { call.reject("Android identity verifier could not read this phone's key or proof (" + e.getClass().getSimpleName() + "). Update both phones and retry.", e); } });
    }
    public void setCredential(MeshCall call) {
        JSObject cert = call.getObject("certificate");
        if (cert == null) preferences().edit().remove("certificate").commit(); else preferences().edit().putString("certificate", cert.toString()).commit();
        call.resolve();
    }
    private boolean ready(MeshCall call) {
        BluetoothManager manager = (BluetoothManager)thisContext().getSystemService(Context.BLUETOOTH_SERVICE);
        adapter = manager == null ? null : manager.getAdapter();
        if (adapter == null || !adapter.isEnabled()) { call.reject("Turn on Bluetooth in Android settings."); return false; }
        if (Build.VERSION.SDK_INT < 31) {
            android.location.LocationManager location = getSystemService(android.location.LocationManager.class);
            boolean enabled = location != null && (Build.VERSION.SDK_INT >= 28 ? location.isLocationEnabled() :
                location.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER) || location.isProviderEnabled(android.location.LocationManager.NETWORK_PROVIDER));
            if (!enabled) { call.reject("Enable Android Location services for Bluetooth discovery on this Android version."); return false; }
        }
        return true;
    }
    boolean permitted() {
        if (Build.VERSION.SDK_INT < 31) return ContextCompat.checkSelfPermission(thisContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        for (String p : new String[]{Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_ADVERTISE})
            if (ContextCompat.checkSelfPermission(thisContext(), p) != PackageManager.PERMISSION_GRANTED) return false;
        return true;
    }
    public void start(MeshCall call) {
        if (!permitted()) { call.reject("Nearby devices permission is required."); return; } if (!ready(call)) return;
        if (advertisement != null) { call.resolve(); return; } if (startCall != null) { call.reject("Bluetooth receiver is starting."); return; }
        BluetoothManager manager = (BluetoothManager)thisContext().getSystemService(Context.BLUETOOTH_SERVICE);
        advertiser = adapter.getBluetoothLeAdvertiser(); if (advertiser == null) { call.reject("This phone cannot advertise Bluetooth."); return; }
        server = manager.openGattServer(thisContext(), serverCallback); if (server == null) { call.reject("Could not open Bluetooth receiver."); return; }
        BluetoothGattService service = new BluetoothGattService(SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY);
        service.addCharacteristic(new BluetoothGattCharacteristic(META, BluetoothGattCharacteristic.PROPERTY_READ, BluetoothGattCharacteristic.PERMISSION_READ));
        service.addCharacteristic(new BluetoothGattCharacteristic(RX, BluetoothGattCharacteristic.PROPERTY_WRITE, BluetoothGattCharacteristic.PERMISSION_WRITE));
        service.addCharacteristic(new BluetoothGattCharacteristic(TX, BluetoothGattCharacteristic.PROPERTY_READ, BluetoothGattCharacteristic.PERMISSION_READ));
        startCall = call;
        if (!server.addService(service)) { startCall = null; closeServer(); call.reject("Could not register Bluetooth service."); }
    }
    private void advertise(int status) {
        MeshCall pending = startCall; startCall = null; if (pending == null) return;
        if (status != BluetoothGatt.GATT_SUCCESS) { pending.reject("Bluetooth service registration failed."); closeServer(); return; }
        advertisement = new AdvertiseCallback() {
            @Override public void onStartSuccess(AdvertiseSettings settings) { handler.post(() -> { pending.resolve(); scheduleDiscovery(1000); emitReady(true); }); }
            @Override public void onStartFailure(int code) { advertisement = null; closeServer(); pending.reject("Bluetooth advertising failed (" + code + ")."); }
        };
        try { advertiser.startAdvertising(new AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED).setConnectable(true).build(),
            new AdvertiseData.Builder().addServiceUuid(new ParcelUuid(SERVICE)).build(), advertisement); }
        catch (Exception e) { advertisement = null; closeServer(); pending.reject("Could not advertise Bluetooth.", e); }
    }
    public void scan(MeshCall call) { handler.post(() -> {
        if (!permitted()) { call.reject("Nearby devices permission is required."); return; } if (!ready(call)) return;
        if (scanCall != null || connectCall != null || exchangeCall != null) { call.reject("A Bluetooth operation is already running."); return; }
        scanner = adapter.getBluetoothLeScanner(); found.clear(); scanCall = call;
        if (scanner == null) { scanCall = null; call.reject("Bluetooth scanner unavailable."); return; }
        scanCallback = new ScanCallback() {
            @Override public void onScanResult(int type, ScanResult result) { handler.post(() -> {
                if (scanCall == null || found.size() >= 32) return; JSObject p = new JSObject(); p.put("address", result.getDevice().getAddress());
                p.put("rssi", result.getRssi()); p.put("name", "Nearby RescueMemory phone"); found.put(result.getDevice().getAddress(), p); }); }
            @Override public void onScanFailed(int code) { handler.post(() -> { MeshCall p = scanCall; finishScan(); if (p != null) p.reject("Bluetooth scan failed (" + code + ")."); }); }
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
    public void connect(MeshCall call) { handler.post(() -> {
        if (!permitted()) { call.reject("Nearby devices permission required."); return; } if (!ready(call)) return;
        if (scanCall != null || connectCall != null || exchangeCall != null) { call.reject("Bluetooth is busy."); return; }
        closeClient(); connectCall = call; mtu = 23; metadataReadStarted = false;
        try { client = adapter.getRemoteDevice(call.getString("address", "")).connectGatt(thisContext(), false, clientCallback, BluetoothDevice.TRANSPORT_LE); }
        catch (Exception e) { failClient("Could not connect to nearby phone."); }
        handler.postDelayed(() -> { if (connectCall == call) failClient("Nearby phone did not respond. Try again."); }, 15000);
    }); }
    public void ping(MeshCall call) { handler.post(() -> {
        try {
            JSObject ping = metadata(); ping.put("type", "presence");
            JSObject args = new JSObject(); args.put("payload", ping.toString());
            exchange(new MeshCall(args, (response, error) -> {
                if (error != null) { call.reject(error); return; }
                try {
                    JSObject pong = new JSObject(response.getString("payload"));
                    if (client != null && "presence".equals(pong.optString("type"))) rememberPresence(pong, client.getDevice().getAddress(), found.get(client.getDevice().getAddress()), true);
                    call.resolve();
                } catch (Exception e) { call.reject("Malformed presence reply."); }
            }));
        } catch (Exception e) { call.reject("Could not create presence ping.", e); }
    }); }
    public void exchange(MeshCall call) { handler.post(() -> {
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
        if (metadataReadStarted || connectCall == null) return;
        metadataReadStarted = true;
        BluetoothGattCharacteristic c = characteristic(META);
        if (c == null) { failClient("Update required: nearby phone uses the old transfer."); return; }
        if (!client.readCharacteristic(c)) failClient("Could not read nearby phone details.");
    }
    private void writeNext() {
        BluetoothGattCharacteristic c = characteristic(RX); if (c == null) { failClient("Nearby phone has no sync receiver."); return; }
        try {
            boolean ok;
            if (Build.VERSION.SDK_INT >= 33) ok = client.writeCharacteristic(c, outgoing[outgoingIndex], BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothStatusCodes.SUCCESS;
            else { c.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT); c.setValue(outgoing[outgoingIndex]); ok = client.writeCharacteristic(c); }
            if (!ok) failClient("Bluetooth write failed. Retry to continue.");
        } catch (Exception e) { failClient("Bluetooth write failed at MTU " + mtu + " (" + e.getClass().getSimpleName() + ")."); }
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
            if (!g.requestMtu(247)) readMetadata();
            else handler.postDelayed(() -> { if (g == client) readMetadata(); }, 2000); }); }
        @Override public void onMtuChanged(BluetoothGatt g, int value, int status) { handler.post(() -> {
            if (g != client) return; mtu = status == BluetoothGatt.GATT_SUCCESS ? Math.max(23, Math.min(value, 517)) : 23; readMetadata(); }); }
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
                rememberPresence(obj, g.getDevice().getAddress(), found.get(g.getDevice().getAddress()), true);
                MeshCall done = connectCall; connectCall = null; done.resolve(obj); return;
            }
            if (TX.equals(c.getUuid()) && exchangeCall != null) {
                if (value == null || value.length == 0) { handler.postDelayed(this::pollResponse, 120); return; }
                if (value.length < MeshFrames.HEADER || MeshFrames.id(value) != messageId) { failClient("Invalid sync response identity."); return; }
                byte[] payload = responseDecoder.accept(value);
                if (payload == null) pollResponse(); else { JSObject obj = new JSObject(); obj.put("payload", new String(payload, StandardCharsets.UTF_8));
                    MeshCall done = exchangeCall; exchangeCall = null; outgoing = null; responseDecoder = null; done.resolve(obj); }
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
        @Override public void onMtuChanged(BluetoothDevice d, int value) { handler.post(() -> peerMtus.put(d.getAddress(), Math.max(23, Math.min(value, 517)))); }
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
                    event.put("payload", new String(payload, StandardCharsets.UTF_8));
                    if (!handlePresence(address, MeshFrames.id(value), event.getString("payload"))) {
                        if (eventSink != null && bridgeActive) notifyListeners("message", event);
                        else {
                            JSObject error = new JSObject(); error.put("v", 2); error.put("error", "Nearby phone is in the background. Presence is active; open the app to exchange reports.");
                            responses.put(address, new ArrayDeque<>(Arrays.asList(MeshFrames.encode(error.toString().getBytes(StandardCharsets.UTF_8), MeshFrames.id(value), peerMtus.getOrDefault(address, 23) - 2))));
                        }
                    } }
            } catch (Exception e) { valid = false; incoming.remove(d.getAddress()); incomingAt.remove(d.getAddress()); }
            if (responseNeeded) server.sendResponse(d, requestId, valid ? BluetoothGatt.GATT_SUCCESS : BluetoothGatt.GATT_FAILURE, 0, null);
        }); }
    };
    public void reply(MeshCall call) { handler.post(() -> {
        String address = call.getString("address", ""); if (!connectedClients.contains(address)) { call.reject("Nearby phone disconnected before acknowledgement."); return; }
        // Keep reads shorter than MTU-1 so Android does not issue a long-read blob request.
        try { byte[][] frames = MeshFrames.encode(call.getString("payload", "").getBytes(StandardCharsets.UTF_8), call.getInt("messageId", 0), peerMtus.getOrDefault(address, 23) - 2);
            responses.put(address, new ArrayDeque<>(Arrays.asList(frames))); call.resolve();
        } catch (Exception e) { call.reject("Could not create Bluetooth response.", e); }
    }); }
    private void failClient(String message) {
        MeshCall c = connectCall, e = exchangeCall; connectCall = null; exchangeCall = null; closeClient(); if (c != null) c.reject(message); if (e != null) e.reject(message);
    }
    private void closeClient() { if (client != null) { BluetoothGatt g = client; client = null; try { g.disconnect(); g.close(); } catch (Exception ignored) {} } outgoing = null; responseDecoder = null; }
    private void closeServer() { if (server != null) { server.close(); server = null; } incoming.clear(); incomingAt.clear(); responses.clear(); peerMtus.clear(); metadataReads.clear(); connectedClients.clear(); }
    public void disconnect(MeshCall call) { handler.post(() -> { failClient("Bluetooth operation cancelled."); call.resolve(); }); }
    public void stop(MeshCall call) { handler.post(() -> {
        running = false; generation++; backgroundOperation = false; handler.removeCallbacks(discovery);
        MeshCall starting = startCall; startCall = null;
        if (starting != null) starting.reject("Bluetooth receiver stopped before startup completed.");
        MeshCall scanning = scanCall; finishScan(); if (scanning != null) scanning.reject("Bluetooth scan stopped.");
        if (advertiser != null && advertisement != null) try { advertiser.stopAdvertising(advertisement); } catch (Exception ignored) {}
        advertisement = null; closeServer(); failClient("Bluetooth receiver stopped."); call.resolve();
    }); }
    @Override public void onDestroy() {
        running = false; handler.removeCallbacksAndMessages(null); cryptoWorker.shutdownNow();
        if (adapterStateReceiver != null) try { thisContext().unregisterReceiver(adapterStateReceiver); } catch (Exception ignored) {}
        finishScan(); if (advertiser != null && advertisement != null) try { advertiser.stopAdvertising(advertisement); } catch (Exception ignored) {}
        closeServer(); failClient("Mesh service stopped."); super.onDestroy();
    }
}
