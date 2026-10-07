/**
 * RescueMemory Bluetooth Low Energy (BLE) Mesh Engine
 * 
 * Android BLE service discovery and one-way SOS delivery, with Web Bluetooth
 * helpers retained for supported peripheral browsers.
 */

import { saveImportedReports } from './offlineStorage.js';
import { Capacitor, registerPlugin } from '@capacitor/core';

const nativeBle = registerPlugin('RescueBle');
const onAndroid = Capacitor.getPlatform() === 'android';
let nativeStarted = false;
let nativeListener = null;

// Dedicated 16-bit/128-bit RescueMemory BLE Service & Characteristic UUIDs
export const RESCUE_BLE_SERVICE_UUID = '0000fe50-0000-1000-8000-00805f9b34fb';
export const CHAR_BEACON_UUID = '0000fe51-0000-1000-8000-00805f9b34fb';      // Read/Notify: Node metadata & GPS
export const CHAR_SYNC_RX_UUID = '0000fe52-0000-1000-8000-00805f9b34fb';     // Write/WriteWithoutResponse: Packet Ingest
export const CHAR_SYNC_TX_UUID = '0000fe53-0000-1000-8000-00805f9b34fb';     // Read/Notify: Outgoing Packet Stream

// In-memory cache of discovered Bluetooth peers
const activeBlePeers = new Map();
const activeConnections = new Map();
const listeners = new Set();

/**
 * Checks whether Bluetooth Low Energy (Web Bluetooth / native BLE) is supported on this platform.
 */
export function isBluetoothSupported() {
  if (typeof window === 'undefined') return false;
  return onAndroid;
}

export function isNativeBle() { return onAndroid; }

export async function startBleReceiver() {
  if (!onAndroid) return false;
  if (!nativeListener) {
    nativeListener = await nativeBle.addListener('packet', async ({ payload }) => {
      try {
        const packet = JSON.parse(payload);
        if (packet.k !== 'rm_ble_packet' || !Array.isArray(packet.e)) return;
        const reports = packet.e.filter(e => e && e.id && Array.isArray(e.l)).map(e => ({
          id: e.id,
          kind: e.k || 'sos',
          text: e.t || '',
          location: { lat: e.l[0], lon: e.l[1] },
          severity: e.v || 'red',
          status: e.s || 'needs_help',
          created_at: e.ts || new Date().toISOString(),
          reporter_id: packet.s || 'ble-peer'
        }));
        const imported = await saveImportedReports(reports, { markForRelay: true });
        window.dispatchEvent(new CustomEvent('rescue:ble-received', { detail: { imported } }));
      } catch (error) {
        console.warn('[BLE] Rejected malformed incoming SOS packet:', error);
      }
    });
  }
  if (!nativeStarted) {
    await nativeBle.start();
    nativeStarted = true;
  }
  return true;
}

/** A real, finite BLE scan on Android; Web Bluetooth uses its permission chooser. */
export async function scanForNearbyPhones() {
  if (onAndroid) {
    await startBleReceiver();
    const result = await nativeBle.scan();
    for (const peer of result.peers || []) {
      handleDiscoveredDevice({ id: peer.address, name: peer.name, native: true }, { rssi: peer.rssi });
    }
    return result.peers || [];
  }
  throw new Error('Phone-to-phone BLE discovery is available in the Android app. Use QR transfer in a browser.');
}

/**
 * Subscribe to BLE peer list updates.
 */
export function onBlePeersChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notifyListeners() {
  const list = Array.from(activeBlePeers.values());
  for (const cb of listeners) {
    try {
      cb(list);
    } catch {
      // ignore
    }
  }
}

/**
 * Converts Bluetooth RSSI signal strength (dBm) to an estimated distance in meters.
 * Path loss model: Distance = 10 ^ ((Measured Power (-59) - RSSI) / (10 * N (2.5)))
 */
export function rssiToDistance(rssi = -65) {
  if (rssi == null || Number.isNaN(rssi)) return 15;
  const measuredPower = -59; // RSSI at 1 meter for typical mobile BLE
  const pathLossFactor = 2.4;
  const ratio = (measuredPower - rssi) / (10 * pathLossFactor);
  const dist = Math.pow(10, ratio);
  return Math.max(1, Math.min(150, Math.round(dist)));
}

/**
 * Converts RSSI to a human-readable signal quality string.
 */
export function rssiToQuality(rssi = -65) {
  if (rssi >= -60) return { label: 'Strong', color: 'emerald', bars: 3 };
  if (rssi >= -78) return { label: 'Good', color: 'cyan', bars: 2 };
  return { label: 'Weak', color: 'amber', bars: 1 };
}

/**
 * Formats a compact BLE mesh payload for rapid transfer.
 */
export function createBlePacket(reports = [], myNodeId = 'node', myLoc = { lat: 28.7041, lon: 77.1025 }) {
  return {
    k: 'rm_ble_packet',
    s: myNodeId,
    t: Date.now(),
    l: [Number((myLoc.lat || 28.7041).toFixed(5)), Number((myLoc.lon || 77.1025).toFixed(5))],
    e: (reports || []).map((r) => ({
      id: r.id,
      k: r.kind || 'sos',
      t: r.text || '',
      l: [
        Number((r.location?.lat || myLoc.lat || 28.7041).toFixed(5)),
        Number((r.location?.lon || myLoc.lon || 77.1025).toFixed(5))
      ],
      v: r.severity || 'red',
      s: r.status || 'needs_help',
      ts: r.created_at || new Date().toISOString()
    }))
  };
}

/**
 * Splits a packet into MTU-safe chunks (240 bytes) with a 4-byte header:
 * [packetId (2B), chunkIndex (1B), totalChunks (1B), payload (<=236B)]
 */
export function chunkData(dataString, chunkSize = 236) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(dataString);
  const totalChunks = Math.ceil(bytes.length / chunkSize);
  const chunks = [];
  const packetId = Math.floor(Math.random() * 65535);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const slice = bytes.subarray(start, start + chunkSize);
    const chunk = new Uint8Array(4 + slice.length);
    chunk[0] = (packetId >> 8) & 0xff;
    chunk[1] = packetId & 0xff;
    chunk[2] = i;
    chunk[3] = totalChunks;
    chunk.set(slice, 4);
    chunks.push(chunk);
  }

  return chunks;
}

/**
 * Reassembles packet chunks into full data string.
 */
export class PacketReassembler {
  constructor() {
    this.buffer = new Map(); // packetId -> { total, chunks: Map<idx, Uint8Array> }
  }

  addChunk(chunkBytes) {
    if (chunkBytes.length < 4) return null;
    const packetId = (chunkBytes[0] << 8) | chunkBytes[1];
    const index = chunkBytes[2];
    const total = chunkBytes[3];
    const payload = chunkBytes.subarray(4);

    let session = this.buffer.get(packetId);
    if (!session) {
      session = { total, chunks: new Map(), createdAt: Date.now() };
      this.buffer.set(packetId, session);
    }

    session.chunks.set(index, payload);

    if (session.chunks.size === total) {
      // Reassemble complete packet
      let totalLength = 0;
      for (let i = 0; i < total; i++) {
        totalLength += session.chunks.get(i).length;
      }
      const fullBytes = new Uint8Array(totalLength);
      let offset = 0;
      for (let i = 0; i < total; i++) {
        const part = session.chunks.get(i);
        fullBytes.set(part, offset);
        offset += part.length;
      }
      this.buffer.delete(packetId);
      const decoder = new TextDecoder();
      return decoder.decode(fullBytes);
    }

    // Cleanup stale incomplete packets (> 30s)
    const now = Date.now();
    for (const [pid, s] of this.buffer.entries()) {
      if (now - s.createdAt > 30000) this.buffer.delete(pid);
    }

    return null;
  }
}

const reassembler = new PacketReassembler();

/**
 * Initiates user-gesture Bluetooth scan dialog and pairs with nearby BLE devices.
 */
export async function requestBleDevice() {
  if (!isBluetoothSupported()) {
    throw new Error('Bluetooth is not supported or disabled on this browser/device.');
  }

  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [RESCUE_BLE_SERVICE_UUID] },
        { namePrefix: 'Rescue' },
        { namePrefix: 'Android' }
      ],
      optionalServices: [RESCUE_BLE_SERVICE_UUID, 'battery_service', 'device_information']
    });

    handleDiscoveredDevice(device);
    return device;
  } catch (err) {
    // If filtered scan fails (e.g. device without pre-advertised service), allow scanning all devices
    if (err.name === 'NotFoundError' || err.message?.includes('User cancelled')) {
      throw err;
    }

    try {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [RESCUE_BLE_SERVICE_UUID, 'battery_service', 'device_information']
      });
      handleDiscoveredDevice(device);
      return device;
    } catch (fallbackErr) {
      throw fallbackErr;
    }
  }
}

/**
 * Internal handler to register a discovered Bluetooth device.
 */
function handleDiscoveredDevice(device, customMeta = {}) {
  if (!device || !device.id) return;

  const nodeId = `ble_${device.id.slice(0, 12).replace(/[^a-zA-Z0-9]/g, '')}`;
  const now = Date.now();
  const rssi = customMeta.rssi ?? -62;
  const dist = rssiToDistance(rssi);

  const peer = {
    node_id: nodeId,
    device_id: device.id,
    name: device.name || `BLE Node (${device.id.slice(-4)})`,
    device_name: device.name || `BLE Node (${device.id.slice(-4)})`,
    role: customMeta.role || 'survivor',
    status: 'active',
    battery: customMeta.battery != null ? customMeta.battery : undefined,
    rssi: customMeta.rssi,
    distance_m: customMeta.rssi == null ? undefined : (customMeta.distance_m ?? dist),
    bearing_deg: customMeta.bearing_deg,
    cardinal: customMeta.cardinal,
    last_seen_epoch: now,
    is_online: true,
    source: device.native ? 'native_ble' : 'web_ble',
    device_ref: device
  };

  activeBlePeers.set(nodeId, peer);

  // Monitor disconnection event
  if (device.addEventListener) {
    device.addEventListener('gattserverdisconnected', () => {
      peer.is_online = false;
      activeConnections.delete(nodeId);
      notifyListeners();
    });
  }

  notifyListeners();
  return peer;
}

/**
 * Connects to a target BLE device's GATT server and performs lightning-fast report sync.
 */
export async function syncWithBlePeer(peerOrDevice, localReports = [], myNodeId = 'local_node', myLoc = { lat: 28.7041, lon: 77.1025 }) {
  const device = peerOrDevice.device_ref || peerOrDevice;
  if (device.native && onAndroid) {
    await startBleReceiver();
    const latestReports = [...localReports].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')).slice(-4);
    const packet = createBlePacket(latestReports.map(report => ({
      ...report, text: (report.text || '').slice(0, 220)
    })), myNodeId, myLoc);
    await nativeBle.send({ address: device.id, payload: JSON.stringify(packet) });
    return { success: true, synced: packet.e.length, imported: 0, peer_name: device.name, speed: undefined };
  }
  if (!device || !device.gatt) {
    throw new Error('Invalid Bluetooth device reference');
  }

  let server = null;
  let importedCount = 0;
  let sentCount = 0;

  try {
    // 1. Connect GATT Server
    if (!device.gatt.connected) {
      server = await device.gatt.connect();
    } else {
      server = device.gatt;
    }

    // Attempt to read standard GATT Battery Service if available
    try {
      const battService = await server.getPrimaryService('battery_service');
      const battChar = await battService.getCharacteristic('battery_level');
      const val = await battChar.readValue();
      const battPct = val.getUint8(0);
      if (typeof battPct === 'number' && !Number.isNaN(battPct)) {
        if (peerOrDevice && typeof peerOrDevice === 'object') {
          peerOrDevice.battery = battPct;
        }
        const cached = activeBlePeers.get(`ble_${device.id.slice(0, 12).replace(/[^a-zA-Z0-9]/g, '')}`);
        if (cached) {
          cached.battery = battPct;
        }
        notifyListeners();
      }
    } catch {
      // standard battery service not supported on this peripheral
    }

    // 2. Discover RescueMemory Primary Service
    let service = null;
    try {
      service = await server.getPrimaryService(RESCUE_BLE_SERVICE_UUID);
    } catch {
      // If custom service not exposed on remote GATT, use fallback transmission
    }

    if (service) {
      // 3. Write unsynced reports to RX characteristic with MTU chunk streaming
      if (localReports.length > 0) {
        try {
          const rxChar = await service.getCharacteristic(CHAR_SYNC_RX_UUID);
          const payload = JSON.stringify(createBlePacket(localReports, myNodeId, myLoc));
          const chunks = chunkData(payload, 236);

          for (const chunk of chunks) {
            if (rxChar.writeValueWithoutResponse) {
              await rxChar.writeValueWithoutResponse(chunk);
            } else {
              await rxChar.writeValue(chunk);
            }
          }
          sentCount = localReports.length;
        } catch (txErr) {
          console.warn('[BLE Mesh] TX characteristic write notice:', txErr);
        }
      }

      // 4. Read incoming reports from TX characteristic
      try {
        const txChar = await service.getCharacteristic(CHAR_SYNC_TX_UUID);
        const dataView = await txChar.readValue();
        const rawBytes = new Uint8Array(dataView.buffer);
        const assembledJson = reassembler.addChunk(rawBytes);

        if (assembledJson) {
          const parsed = JSON.parse(assembledJson);
          if (Array.isArray(parsed.e)) {
            const eventsToSave = parsed.e.map((ev) => ({
              id: ev.id,
              kind: ev.k || 'sos',
              text: ev.t || '',
              location: Array.isArray(ev.l) ? { lat: ev.l[0], lon: ev.l[1] } : myLoc,
              severity: ev.v || 'red',
              status: ev.s || 'needs_help',
              created_at: ev.ts || new Date().toISOString(),
              reporter_id: parsed.s || 'ble-peer'
            }));
            importedCount = await saveImportedReports(eventsToSave);
          }
        }
      } catch (rxErr) {
        console.warn('[BLE Mesh] RX characteristic read notice:', rxErr);
      }
    } else {
      throw new Error('This Bluetooth device does not run RescueMemory and cannot receive SOS reports.');
    }

    // Update peer last seen & status
    const nodeId = peerOrDevice.node_id || `ble_${device.id?.slice(0, 8)}`;
    const existing = activeBlePeers.get(nodeId);
    if (existing) {
      existing.last_seen_epoch = Date.now();
      existing.is_online = true;
      existing.rssi = -55; // Upgraded signal after successful handshake
      notifyListeners();
    }

    return {
      success: true,
      synced: sentCount,
      imported: importedCount,
      peer_name: device.name || 'Bluetooth Device',
      speed: undefined
    };
  } finally {
    // Keep connection alive for mesh relay, or disconnect gracefully
  }
}

/**
 * Returns all active discovered Bluetooth peers.
 */
export function getActiveBlePeers() {
  const now = Date.now();
  const list = [];
  for (const [id, peer] of activeBlePeers.entries()) {
    // Expire devices not seen in 5 minutes
    if (now - peer.last_seen_epoch < 300000) {
      list.push(peer);
    } else {
      activeBlePeers.delete(id);
    }
  }
  return list;
}

/**
 * Registers an autonomous synthetic or simulated local Bluetooth beacon.
 * Enables zero-hardware development & testing on laptops / simulators.
 */
export function registerSimulatedBlePeer(peerMeta = {}) {
  const id = peerMeta.node_id || `ble_sim_${Math.random().toString(36).slice(2, 7)}`;
  const peer = {
    node_id: id,
    device_id: id,
    name: peerMeta.name || `Survivor BLE (${id.slice(-4)})`,
    device_name: peerMeta.name || `Survivor BLE (${id.slice(-4)})`,
    role: peerMeta.role || 'survivor',
    status: 'active',
    battery: peerMeta.battery ?? 84,
    rssi: peerMeta.rssi ?? -58,
    distance_m: peerMeta.distance_m ?? 18,
    bearing_deg: peerMeta.bearing_deg ?? 42,
    cardinal: peerMeta.cardinal ?? 'NE',
    last_seen_epoch: Date.now(),
    is_online: true,
    source: 'ble_mesh',
    location: peerMeta.location || { lat: 28.7055, lon: 77.1035 }
  };
  activeBlePeers.set(id, peer);
  notifyListeners();
  return peer;
}
