package com.rescuememory.app;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothStatusCodes;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** One-time, app-to-app BLE discovery and SOS delivery. No OS bond is created. */
@CapacitorPlugin(name = "RescueBle", permissions = {
    @Permission(strings = {Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT,
        Manifest.permission.BLUETOOTH_ADVERTISE}, alias = "nearby"),
    @Permission(strings = {Manifest.permission.ACCESS_FINE_LOCATION}, alias = "legacyLocation")
})
public class RescueBlePlugin extends Plugin {
    private static final UUID SERVICE = UUID.fromString("0000fe50-0000-1000-8000-00805f9b34fb");
    private static final UUID RX = UUID.fromString("0000fe52-0000-1000-8000-00805f9b34fb");
    private static final int SCAN_MS = 8000;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Map<String, JSObject> found = new HashMap<>();
    private final Map<String, Incoming> incoming = new HashMap<>();
    private BluetoothManager manager;
    private BluetoothAdapter adapter;
    private BluetoothLeAdvertiser advertiser;
    private BluetoothLeScanner scanner;
    private BluetoothGattServer server;
    private AdvertiseCallback advertiseCallback;
    private ScanCallback scanCallback;
    private PluginCall scanCall;
    private BluetoothGatt sendingGatt;
    private PluginCall sendCall;
    private byte[][] outgoing;
    private int outgoingIndex;

    private static class Incoming {
        final byte[][] chunks;
        Incoming(int total) { chunks = new byte[total][]; }
    }

    private boolean ready(PluginCall call) {
        manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        adapter = manager == null ? null : manager.getAdapter();
        if (adapter == null) { call.reject("This phone has no Bluetooth adapter."); return false; }
        if (!adapter.isEnabled()) { call.reject("Turn on Bluetooth in Android settings, then try again."); return false; }
        return true;
    }

    private boolean permitted() {
        if (Build.VERSION.SDK_INT >= 31) {
            return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
                && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
                && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED;
        }
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void withPermission(PluginCall call, String callback) {
        if (permitted()) {
            if ("startAllowed".equals(callback)) startAllowed(call); else scanAllowed(call);
        } else {
            requestPermissionForAlias(Build.VERSION.SDK_INT >= 31 ? "nearby" : "legacyLocation", call, callback);
        }
    }

    @PermissionCallback
    private void startAllowed(PluginCall call) {
        if (!permitted()) { call.reject("Nearby devices permission is required for Bluetooth discovery."); return; }
        if (!ready(call)) return;
        if (advertiseCallback != null) { call.resolve(); return; }
        advertiser = adapter.getBluetoothLeAdvertiser();
        if (advertiser == null) { call.reject("This phone cannot advertise BLE to other phones."); return; }
        server = manager.openGattServer(getContext(), serverCallback);
        if (server == null) { call.reject("Could not open the BLE receiver on this phone."); return; }
        BluetoothGattService service = new BluetoothGattService(SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY);
        service.addCharacteristic(new BluetoothGattCharacteristic(RX,
            BluetoothGattCharacteristic.PROPERTY_WRITE,
            BluetoothGattCharacteristic.PERMISSION_WRITE));
        server.addService(service);
        AdvertiseSettings settings = new AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setConnectable(true).setTimeout(0).build();
        AdvertiseData data = new AdvertiseData.Builder().addServiceUuid(new ParcelUuid(SERVICE))
            .setIncludeDeviceName(false).build();
        advertiseCallback = new AdvertiseCallback() {
            @Override public void onStartSuccess(AdvertiseSettings inEffect) { call.resolve(); }
            @Override public void onStartFailure(int code) {
                advertiseCallback = null;
                if (server != null) { server.close(); server = null; }
                call.reject("BLE advertising failed (code " + code + ").");
            }
        };
        try { advertiser.startAdvertising(settings, data, advertiseCallback); }
        catch (Exception e) { advertiseCallback = null; server.close(); server = null; call.reject(e.getMessage()); }
    }

    @PluginMethod
    public void start(PluginCall call) { withPermission(call, "startAllowed"); }

    @PermissionCallback
    private void scanAllowed(PluginCall call) {
        if (!permitted()) { call.reject("Nearby devices permission is required for Bluetooth discovery."); return; }
        if (!ready(call)) return;
        if (scanCall != null) { call.reject("A Bluetooth scan is already running."); return; }
        scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) { call.reject("Bluetooth scanner is unavailable."); return; }
        found.clear();
        scanCall = call;
        scanCallback = new ScanCallback() {
            @Override public void onScanResult(int callbackType, ScanResult result) {
                BluetoothDevice device = result.getDevice();
                if (device == null) return;
                JSObject peer = new JSObject();
                peer.put("address", device.getAddress());
                String name = device.getName();
                peer.put("name", name == null || name.isEmpty() ? "Nearby RescueMemory phone" : name);
                peer.put("rssi", result.getRssi());
                found.put(device.getAddress(), peer);
            }
            @Override public void onScanFailed(int code) {
                if (scanCall != null) { PluginCall pending = scanCall; finishScan(); pending.reject("BLE scan failed (code " + code + ")."); }
            }
        };
        try {
            scanner.startScan(Arrays.asList(new ScanFilter.Builder().setServiceUuid(new ParcelUuid(SERVICE)).build()),
                new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanCallback);
            handler.postDelayed(() -> {
                if (scanCall == call) {
                    JSArray peers = new JSArray();
                    for (JSObject peer : found.values()) peers.put(peer);
                    JSObject result = new JSObject();
                    result.put("peers", peers);
                    finishScan();
                    call.resolve(result);
                }
            }, SCAN_MS);
        } catch (Exception e) { finishScan(); call.reject(e.getMessage()); }
    }

    @PluginMethod
    public void scan(PluginCall call) { withPermission(call, "scanAllowed"); }

    private void finishScan() {
        if (scanner != null && scanCallback != null) {
            try { scanner.stopScan(scanCallback); } catch (Exception ignored) {}
        }
        scanCallback = null;
        scanCall = null;
    }

    @PluginMethod
    public void send(PluginCall call) {
        if (!permitted()) { call.reject("Nearby devices permission is required."); return; }
        if (!ready(call)) return;
        if (sendCall != null) { call.reject("Another BLE transfer is in progress."); return; }
        String address = call.getString("address");
        String payload = call.getString("payload");
        if (address == null || payload == null) { call.reject("Missing peer or SOS payload."); return; }
        byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);
        int count = (bytes.length + 15) / 16;
        if (count == 0 || count > 255) { call.reject("SOS packet must contain 1 to 4080 bytes."); return; }
        outgoing = new byte[count][];
        int id = (int) (System.currentTimeMillis() & 0xffff);
        for (int i = 0; i < count; i++) {
            int length = Math.min(16, bytes.length - i * 16);
            byte[] chunk = new byte[length + 4];
            chunk[0] = (byte) (id >> 8); chunk[1] = (byte) id;
            chunk[2] = (byte) i; chunk[3] = (byte) count;
            System.arraycopy(bytes, i * 16, chunk, 4, length);
            outgoing[i] = chunk;
        }
        outgoingIndex = 0;
        sendCall = call;
        handler.postDelayed(() -> {
            if (sendCall == call) failSend("Nearby phone did not respond within 20 seconds.");
        }, 20000);
        try { sendingGatt = adapter.getRemoteDevice(address).connectGatt(getContext(), false, clientCallback); }
        catch (Exception e) { failSend(e.getMessage()); }
    }

    private final BluetoothGattCallback clientCallback = new BluetoothGattCallback() {
        @Override public void onConnectionStateChange(BluetoothGatt gatt, int status, int state) {
            if (status != BluetoothGatt.GATT_SUCCESS || state == BluetoothProfile.STATE_DISCONNECTED) {
                failSend("Nearby phone disconnected before SOS delivery."); return;
            }
            if (state == BluetoothProfile.STATE_CONNECTED) gatt.discoverServices();
        }
        @Override public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS || gatt.getService(SERVICE) == null) {
                failSend("Nearby phone does not expose RescueMemory BLE service."); return;
            }
            writeNext(gatt);
        }
        @Override public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) { failSend("SOS transfer failed during BLE write."); return; }
            outgoingIndex++;
            if (outgoingIndex >= outgoing.length) {
                PluginCall completed = sendCall;
                clearSend();
                if (completed != null) completed.resolve();
            } else writeNext(gatt);
        }
    };

    private void writeNext(BluetoothGatt gatt) {
        BluetoothGattCharacteristic characteristic = gatt.getService(SERVICE).getCharacteristic(RX);
        if (characteristic == null) { failSend("Nearby phone has no SOS receiver."); return; }
        boolean accepted;
        if (Build.VERSION.SDK_INT >= 33) {
            accepted = gatt.writeCharacteristic(characteristic, outgoing[outgoingIndex],
                BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothStatusCodes.SUCCESS;
        } else {
            characteristic.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
            characteristic.setValue(outgoing[outgoingIndex]);
            accepted = gatt.writeCharacteristic(characteristic);
        }
        if (!accepted) failSend("SOS transfer could not write to nearby phone.");
    }

    private void failSend(String message) {
        PluginCall failed = sendCall;
        clearSend();
        if (failed != null) failed.reject(message == null ? "BLE transfer failed." : message);
    }

    private void clearSend() {
        sendCall = null;
        outgoing = null;
        if (sendingGatt != null) { sendingGatt.close(); sendingGatt = null; }
    }

    private final BluetoothGattServerCallback serverCallback = new BluetoothGattServerCallback() {
        @Override public void onCharacteristicWriteRequest(BluetoothDevice device, int requestId,
            BluetoothGattCharacteristic characteristic, boolean preparedWrite, boolean responseNeeded, int offset, byte[] value) {
            boolean valid = !preparedWrite && offset == 0 && RX.equals(characteristic.getUuid()) && value != null && value.length >= 5;
            if (valid) receiveChunk(device.getAddress(), value);
            if (responseNeeded && server != null) server.sendResponse(device, requestId,
                valid ? BluetoothGatt.GATT_SUCCESS : BluetoothGatt.GATT_FAILURE, 0, null);
        }
    };

    private void receiveChunk(String address, byte[] chunk) {
        int id = ((chunk[0] & 0xff) << 8) | (chunk[1] & 0xff);
        int index = chunk[2] & 0xff;
        int total = chunk[3] & 0xff;
        if (total == 0 || index >= total) return;
        String key = address + ":" + id;
        Incoming entry = incoming.get(key);
        if (entry == null || entry.chunks.length != total) {
            entry = new Incoming(total);
            incoming.put(key, entry);
        }
        entry.chunks[index] = Arrays.copyOfRange(chunk, 4, chunk.length);
        for (byte[] part : entry.chunks) if (part == null) return;
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        for (byte[] part : entry.chunks) output.write(part, 0, part.length);
        incoming.remove(key);
        JSObject event = new JSObject();
        event.put("address", address);
        event.put("payload", new String(output.toByteArray(), StandardCharsets.UTF_8));
        notifyListeners("packet", event);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        finishScan();
        if (advertiser != null && advertiseCallback != null) advertiser.stopAdvertising(advertiseCallback);
        advertiseCallback = null;
        if (server != null) { server.close(); server = null; }
        call.resolve();
    }

    @Override protected void handleOnDestroy() {
        finishScan();
        if (advertiser != null && advertiseCallback != null) advertiser.stopAdvertising(advertiseCallback);
        if (server != null) server.close();
        clearSend();
    }
}
