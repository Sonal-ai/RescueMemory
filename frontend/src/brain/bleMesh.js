import { Capacitor, registerPlugin } from '@capacitor/core';
import { getAllLocalReports, commitMeshReports, recordMeshSent, saveTransferSession } from './offlineStorage.js';
import { eligibleReports, reportHash, reportBatches, PROTOCOL_VERSION, mergePeerTelemetry } from './meshProtocol.js';
import { cachedMeshLocation, meshLocation } from './meshRadar.js';
import { meshTrace, meshError, getMeshTrace } from './meshDiagnostics.js';
import { nonce, ephemeralKey, transcript, sessionKey, seal, unseal, signingBytes,
  verifySignature, verifyResponder, verifySignedDocument, credentialTrustConfigured, cacheRevocations } from './meshSecurity.js';

const nativeBle = registerPlugin('RescueBle');
const onAndroid = Capacitor.getPlatform() === 'android';
export const RESCUE_BLE_SERVICE_UUID = '0000fe50-0000-1000-8000-00805f9b34fb';
export const CHAR_BEACON_UUID = '0000fe51-0000-1000-8000-00805f9b34fb';
export const CHAR_SYNC_RX_UUID = '0000fe52-0000-1000-8000-00805f9b34fb';
export const CHAR_SYNC_TX_UUID = '0000fe53-0000-1000-8000-00805f9b34fb';
const peers = new Map(), listeners = new Set(), sessions = new Map(), messageQueues = new Map();
let startup = null, attachment = null, attached = false, queue = Promise.resolve(), identityPromise = null;
let backgroundBusy = false;
export const isBleBackgroundBusy = () => backgroundBusy;
export const hasIncomingBleSession = () => sessions.size > 0;
const serialize = fn => { const work = queue.then(fn); queue = work.catch(() => {}); return work; };
const dispatch = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
const notify = () => listeners.forEach(fn => fn(getActiveBlePeers()));
export const isNativeBle = () => onAndroid;
export const isBluetoothSupported = () => onAndroid;
export const onBlePeersChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export async function getBleDiagnostics() {
  const native = onAndroid ? await nativeBle.getDiagnostics() : { ready: false, detail: 'Native BLE requires Android.' };
  return { native, javascript: getMeshTrace() };
}
export async function copyBleDiagnostics() {
  const text = JSON.stringify(await getBleDiagnostics(), null, 2);
  if (onAndroid) await nativeBle.copyDiagnostics({ text });
  else await navigator.clipboard.writeText(text);
}

export async function ensureMeshIdentity() {
  if (!onAndroid) return { node_id: localStorage.getItem('rescue.device_id') };
  if (!identityPromise) identityPromise = nativeBle.getIdentity({ nodeId: localStorage.getItem('rescue.device_id'),
    name: sessionStorage.getItem('rescue.reporterId') || 'RescueMemory phone' }).then(identity => {
    if (identity?.v !== PROTOCOL_VERSION || typeof identity.node_id !== 'string' || !identity.node_id || typeof identity.public_key !== 'string' || !identity.public_key)
      throw meshError('identity.initialize', new Error('Android returned incomplete phone identity. Retry initialization.'));
    localStorage.setItem('rescue.device_id', identity.node_id); return identity;
  }).catch(error => { identityPromise = null; throw error; });
  return identityPromise;
}

export async function getPhoneBattery() {
  if (onAndroid) return nativeBle.getBattery();
  if (navigator.getBattery) {
    const battery = await navigator.getBattery();
    return { battery: Math.round(battery.level * 100), charging: battery.charging, battery_measured_at: Date.now() };
  }
  return { battery: null };
}

export async function publishMeshLocation(value) {
  const location = meshLocation(value?.location || value);
  if (!location) return;
  const latest = cachedMeshLocation();
  if (latest && latest.timestamp > location.timestamp) return latest;
  localStorage.setItem('rescue.meshLocation', JSON.stringify(location));
  if (onAndroid) await nativeBle.setLocation({ location });
  return location;
}

export async function getPhoneTelemetry() {
  return { ...await getPhoneBattery(), location: cachedMeshLocation() };
}

export async function getResponderCredentialStatus() {
  const identity = await ensureMeshIdentity();
  const claims = identity.certificate ? await verifySignedDocument(identity.certificate).catch(() => null) : null;
  return { configured: credentialTrustConfigured(), enrolled: !!identity.certificate,
    verified: onAndroid && await verifyResponder(identity), expires: claims?.expires ? claims.expires * 1000 : null };
}

export async function enrollResponder(baseUrl, secret, request) {
  if (!onAndroid) throw new Error('Enroll using the Android app on the responder phone.');
  if (!credentialTrustConfigured()) throw new Error('This APK needs the command issuer public key configured before enrollment.');
  if (!baseUrl.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:|\/|$)/.test(baseUrl))
    throw new Error('Responder enrollment requires HTTPS (or a local development backend).');
  const identity = await ensureMeshIdentity();
  const headers = { 'Content-Type': 'application/json', 'X-Credential-Admin-Key': secret };
  const endpoint = `${baseUrl.replace(/\/$/, '')}/api/responder-credentials`;
  const fetchJson = async (path, body) => {
    const res = await request(`${endpoint}${path}`, { method: 'POST', headers, body, timeout: 10000 });
    const data = await res.json(); if (!res.ok) throw new Error(data.detail || 'Responder enrollment failed.'); return data;
  };
  const challenge = await fetchJson('/challenge', { node_id: identity.node_id, public_key: identity.public_key });
  const proof = await nativeBle.sign({ data: challenge.challenge });
  const { certificate } = await fetchJson('/enroll', { challenge: challenge.challenge, signature: proof.signature });
  if (!await verifyResponder({ ...identity, certificate })) throw new Error('Credential is not signed by this APK’s trusted command issuer.');
  await nativeBle.setCredential({ certificate }); identityPromise = null;
  await refreshResponderRevocations(baseUrl, request);
  return getResponderCredentialStatus();
}

export async function refreshResponderRevocations(baseUrl, request) {
  if (!credentialTrustConfigured()) return;
  const response = await request(`${baseUrl.replace(/\/$/, '')}/api/responder-credentials/revocations`, { timeout: 5000 });
  if (!response.ok) throw new Error('Could not update responder revocations. Cached verification remains available.');
  await cacheRevocations(await response.json());
}

const sign = async text => {
  const proof = await nativeBle.sign({ data: signingBytes(text) });
  const identity = await ensureMeshIdentity();
  if (proof.public_key && proof.public_key !== identity.public_key) {
    identityPromise = null;
    throw new Error('This phone’s identity key changed. Close Mesh Sync, reopen it, and retry.');
  }
  return proof.signature;
};

async function verifyPhoneProof(publicKey, signature, text) {
  if (!onAndroid) return verifySignature(publicKey, signature, new TextEncoder().encode(text));
  const result = await nativeBle.verifyPhoneProof({ publicKey, signature, data: signingBytes(text) });
  return result.valid === true;
}
const resultFor = (id, peerId) => ({ id, peer_id: peerId, transport: 'bluetooth', sent: 0, received: 0,
  inventory_checked: false, phase: 'authenticating',
  duplicates: 0, conflicts: 0, pending: 0, status: 'syncing', started_at: new Date().toISOString() });

async function inventory(reports) {
  return Promise.all(reports.map(async r => ({ id: r.id, hash: await reportHash(r) })));
}
async function finishIncoming(address, error) {
  const session = sessions.get(address);
  if (!session) return;
  sessions.delete(address); clearTimeout(session.timer);
  if (session.authorized) {
    session.result.status = error || session.result.conflicts || session.result.pending ? 'partial' : 'complete';
    if (error) session.result.error = error;
    await saveTransferSession(session.result);
    const peer = peers.get(session.peerId);
    if (peer) { peer.last_sync = session.result; peer.error = error || null; notify(); }
    dispatch('rescue:ble-received', { imported: session.result.received, result: session.result });
  }
}

async function handleMessage(address, message) {
  if (message.v !== PROTOCOL_VERSION) throw new Error('Update required on both phones.');
  if (message.type === 'hello') {
    if (document.hidden) throw new Error('Nearby phone is in the background. Presence is active; open the app to exchange reports.');
    if (sessions.size >= 32 || !message.identity?.node_id || typeof message.nonce !== 'string' || typeof message.ephemeral !== 'string')
      throw new Error('Invalid handshake or too many connections.');
    await finishIncoming(address, 'A new connection replaced the previous exchange.');
    const identity = await ensureMeshIdentity();
    if (message.identity.node_id === identity.node_id) throw new Error('Cannot sync this phone with itself.');
    const ephemeral = await ephemeralKey();
    const reply = { v: 2, type: 'hello', session_id: crypto.randomUUID(), identity, nonce: nonce(), ephemeral: ephemeral.public_key,
      metadata: await getPhoneTelemetry() };
    const text = transcript(message, reply); reply.proof = await sign(text);
    const session = { id: reply.session_id, peerId: message.identity.node_id, localId: identity.node_id,
      key: await sessionKey(ephemeral.privateKey, message.ephemeral, text), inbound: 0, outbound: 0, text,
      remoteIdentity: message.identity, remoteMetadata: message.metadata, authorized: false,
      result: resultFor(reply.session_id, message.identity.node_id), offered: new Set() };
    session.timer = setTimeout(() => finishIncoming(address, 'Exchange timed out. Retry to continue.').catch(error => meshTrace('incoming.timeout', 'CLEANUP_FAILED', error.message, { address })), 180000);
    sessions.set(address, session); return reply;
  }
  const session = sessions.get(address);
  if (!session) throw new Error('Sync session expired. Retry to continue.');
  const request = await unseal(session, message);
  if (request.action === 'authorize') {
    if (session.authorized || !await verifyPhoneProof(session.remoteIdentity.public_key, request.proof, session.text))
      throw new Error('Phone identity proof failed.');
    session.authorized = true;
    session.result.phase = 'connected';
    session.reports = eligibleReports(await getAllLocalReports());
    session.inventory = await inventory(session.reports);
    const previous = peers.get(session.peerId);
    const connectable = previous?.connectable_at && Date.now() - previous.connectable_at < 120000;
    remember({ ...session.remoteMetadata, ...session.remoteIdentity, v: 2 }, { address: connectable ? previous.address : address, rssi: previous?.rssi });
    await saveTransferSession(session.result);
    return seal(session, { authorized: true });
  }
  if (!session.authorized) throw new Error('Phone is not authorized.');
  let response;
  switch (request.action) {
    case 'inventory': {
      session.result.inventory_checked = true; session.result.phase = 'inventory';
      const offset = Number.isSafeInteger(request.offset) && request.offset >= 0 ? request.offset : 0;
      response = { items: session.inventory.slice(offset, offset + 128), more: offset + 128 < session.inventory.length }; break;
    }
    case 'get': {
      if (!Array.isArray(request.ids) || request.ids.length > 32) throw new Error('Invalid report request.');
      const ids = new Set(request.ids);
      const reports = session.reports.filter(r => ids.has(r.id));
      // Return one byte-bounded batch; the caller requests the remaining IDs again.
      const batch = reportBatches(reports)[0] || [];
      batch.forEach(r => session.offered.add(r.id)); response = { reports: batch }; break;
    }
    case 'put': {
      if (!Array.isArray(request.reports) || request.reports.length > 128) throw new Error('Invalid report batch.');
      response = await commitMeshReports(request.reports, { sessionId: session.id, peerId: session.peerId });
      session.result.inventory_checked = true; session.result.phase = 'receiving';
      session.result.received += response.received; session.result.duplicates += response.duplicates; session.result.conflicts += response.conflicts;
      await saveTransferSession(session.result); break;
    }
    case 'ack': {
      if (!Array.isArray(request.ids) || request.ids.some(id => !session.offered.has(id))) throw new Error('Invalid receipt.');
      await recordMeshSent(request.ids, session.id, session.peerId);
      request.ids.forEach(id => session.offered.delete(id)); session.result.sent += request.ids.length;
      await saveTransferSession(session.result); response = { acknowledged: true }; break;
    }
    case 'done': response = { complete: true }; break;
    default: throw new Error('Unknown sync operation.');
  }
  const envelope = await seal(session, response);
  if (request.action === 'done') await finishIncoming(address);
  return envelope;
}

export async function startBleReceiver({ automatic = false } = {}) {
  if (!onAndroid) return false;
  await ensureMeshIdentity();
  const location = cachedMeshLocation();
  if (location) await nativeBle.setLocation({ location });
  if (!attached) {
    if (!attachment) attachment = (async () => {
    await nativeBle.addListener('message', ({ address, message_id: messageId, payload }) => {
      const work = (messageQueues.get(address) || Promise.resolve()).catch(() => {}).then(async () => {
        let response;
        try { response = await handleMessage(address, JSON.parse(payload)); }
        catch (error) {
          meshTrace('incoming.request', 'REJECTED', error.message, { address, message_id: messageId });
          response = { v: 2, error: error.message }; await finishIncoming(address, error.message);
        }
        await nativeBle.reply({ address, messageId, payload: JSON.stringify(response) });
      }).catch(error => meshTrace('incoming.reply', 'FAILED', error.message, { address, message_id: messageId }));
      messageQueues.set(address, work);
      work.finally(() => { if (messageQueues.get(address) === work) messageQueues.delete(address); });
    });
    await nativeBle.addListener('disconnected', ({ address }) => {
      const work = messageQueues.get(address) || Promise.resolve();
      work.catch(() => {}).then(() => finishIncoming(address, 'Nearby phone disconnected. Retry to continue.')).catch(error => meshTrace('incoming.disconnect', 'CLEANUP_FAILED', error.message, { address }));
    });
    await nativeBle.addListener('state', ({ ready }) => {
      if (!ready) startup = null;
      dispatch('rescue:ble-state', { ready: ready === true });
    });
    await nativeBle.addListener('diagnostic', event => meshTrace(`native.${event.stage}`, event.code, event.detail));
    await nativeBle.addListener('discovered', observed => {
      const existing = [...peers.values()].find(peer => peer.address === observed.address);
      if (existing) remember(existing, observed); else remember({ sync_phase: 'detected' }, observed);
      dispatch('rescue:ble-discovered', observed);
    });
    await nativeBle.addListener('discoveryIdle', () => dispatch('rescue:ble-idle', {}));
    await nativeBle.addListener('presence', meta => {
      remember(meta, { address: meta.address, rssi: meta.rssi, last_seen_epoch: meta.last_seen_epoch });
    });
    attached = true;
    })().catch(error => { attachment = null; throw error; });
    await attachment;
  }
  if (!startup) startup = nativeBle.start({ automatic }).catch(error => { startup = null; throw meshError('receiver.start', error); });
  await startup;
  const state = await nativeBle.getPeers();
  backgroundBusy = state.background_busy === true;
  for (const meta of state.peers || []) remember(meta, { address: meta.address, rssi: meta.rssi, last_seen_epoch: meta.last_seen_epoch });
  dispatch('rescue:ble-state', { ready: state.ready !== false });
  if (state.ready === false) { startup = null; return false; }
  return true;
}

export async function stopBleReceiver() {
  if (!onAndroid) return;
  return serialize(async () => {
    for (const address of sessions.keys()) await finishIncoming(address, 'Nearby mesh stopped.');
    await nativeBle.stop(); startup = null;
  });
}

function remember(meta, observed) {
  if (!meta || typeof meta !== 'object' || !observed?.address)
    throw new Error('Incomplete Bluetooth identity or address.');
  const id = meta.node_id || `unresolved_${observed.address}`;
  if (meta.node_id === localStorage.getItem('rescue.device_id')) return;
  // Address rotation and a native identity migration must not leave stale rows.
  for (const [oldId, oldPeer] of peers) if (oldPeer.address === observed.address && oldId !== id) peers.delete(oldId);
  const old = peers.get(id);
  const peer = { ...mergePeerTelemetry(old, meta), node_id: id, address: observed.address, device_id: observed.address,
    first_seen_epoch: old?.first_seen_epoch || observed.last_seen_epoch || Date.now(),
    name: meta.name || observed.name, device_name: meta.name || observed.name, rssi: observed.rssi ?? old?.rssi,
    distance_m: rssiToDistance(observed.rssi ?? old?.rssi), last_seen_epoch: observed.last_seen_epoch || Date.now(), source: 'native_ble',
    is_online: true, sync_ready: meta.v === 2,
    device_ref: { native: true, id: observed.address } };
  peers.set(id, peer); notify(); return peer;
}

function identifyConnectedPeer(meta, observed) {
  if (meta?.v !== PROTOCOL_VERSION || typeof meta.node_id !== 'string' || !meta.node_id || meta.node_id.length > 100)
    throw Object.assign(new Error('Nearby phone returned incomplete app metadata. Update both phones; automatic retry will continue.'), { code: 'INVALID_METADATA' });
  const identified = remember(meta, observed);
  if (!identified)
    throw Object.assign(new Error('Both phones have the same mesh identity. Install the latest APK on both phones to repair restored device IDs.'), { code: 'DUPLICATE_NODE_ID' });
  return identified;
}

export async function scanForNearbyPhones() {
  if (!onAndroid) throw new Error('Nearby Bluetooth sync requires the Android app.');
  return serialize(async () => {
    await startBleReceiver(); const result = await nativeBle.scan(); const found = [];
    for (const observed of result.peers || []) {
      try {
        const meta = await nativeBle.connect({ address: observed.address });
        const peer = identifyConnectedPeer(meta, observed); found.push(peer);
        // Native ping records this phone on the receiver even if its scan misses us.
        if (peer?.sync_ready) await nativeBle.ping().catch(error => meshTrace('discovery.ping', 'FAILED', error.message, { peer: peer.node_id }));
      } catch (error) {
        if (error.message?.includes('Update required')) { const peer = remember({ v: 1, error: error.message }, observed); if (peer) found.push(peer); }
        else {
          const existing = [...peers.values()].find(p => p.address === observed.address) || remember({ sync_phase: 'detected' }, observed);
          const detailed = meshError('discovery.metadata', error, { address: observed.address });
          if (existing) { existing.error = detailed.message; found.push(existing); }
        }
      } finally { await nativeBle.disconnect().catch(error => meshTrace('discovery.disconnect', 'FAILED', error.message)); }
    }
    notify(); return found;
  });
}

export async function syncWithBlePeer(peer) {
  if (!peer?.address || typeof peer.node_id !== 'string') throw meshError('peer.select', new Error('No detected Bluetooth phone is available to connect.'));
  if (!onAndroid || (!peer.sync_ready && !peer.node_id.startsWith('unresolved_'))) throw new Error('Update required on both Android phones.');
  return serialize(async () => {
    let result, session, stage = 'receiver.start';
    try {
      await startBleReceiver();
      stage = 'gatt.connect'; meshTrace(stage, 'CONNECTING', 'Connecting to detected advertisement.', { address: peer.address });
      const meta = await nativeBle.connect({ address: peer.address });
      stage = 'gatt.metadata';
      peer = identifyConnectedPeer(meta, { address: peer.address, rssi: peer.rssi });
      stage = 'presence.ping';
      await nativeBle.ping();
      stage = 'handshake.hello';
      const identity = await ensureMeshIdentity(), ephemeral = await ephemeralKey();
      const hello = { v: 2, type: 'hello', identity, nonce: nonce(), ephemeral: ephemeral.public_key,
        metadata: await getPhoneTelemetry() };
      const exchange = async message => {
        const response = await nativeBle.exchange({ payload: JSON.stringify(message) });
        const reply = JSON.parse(response.payload); if (reply.error) throw new Error(reply.error); return reply;
      };
      const reply = await exchange(hello);
      if (reply.type !== 'hello' || reply.identity?.node_id !== peer.node_id || reply.identity.node_id === identity.node_id)
        throw new Error('Nearby phone identity changed. Scan again.');
      const text = transcript(hello, reply);
      if (!await verifyPhoneProof(reply.identity.public_key, reply.proof, text)) throw new Error('Nearby phone identity proof failed. Update both phones and retry.');
      session = { id: reply.session_id, localId: identity.node_id, peerId: reply.identity.node_id,
        inbound: 0, outbound: 0, key: await sessionKey(ephemeral.privateKey, reply.ephemeral, text) };
      result = resultFor(session.id, peer.node_id); await saveTransferSession(result);
      const rpc = async message => unseal(session, await exchange(await seal(session, message)));
      stage = 'handshake.authorize';
      await rpc({ action: 'authorize', proof: await sign(text) });
      result.phase = 'inventory';
      Object.assign(peer, meta, reply.metadata, { node_id: reply.identity.node_id, last_seen_epoch: Date.now(), error: null });
      peers.set(peer.node_id, peer); notify();
      const local = eligibleReports(await getAllLocalReports());
      const localInventory = new Map((await inventory(local)).map(item => [item.id, item.hash]));
      const remote = [];
      stage = 'inventory.compare';
      for (let offset = 0; ; offset += 128) { const page = await rpc({ action: 'inventory', offset });
        if (!Array.isArray(page.items) || remote.length > 100000) throw new Error('Invalid remote inventory.');
        remote.push(...page.items); if (!page.more) break;
      }
      const remoteIds = new Map(remote.map(item => [item.id, item.hash]));
      result.inventory_checked = true;
      meshTrace(stage, 'CHECKED', 'Authenticated report inventories compared.', { peer: peer.node_id, local_reports: local.length, remote_reports: remote.length });
      result.duplicates = remote.filter(item => localInventory.get(item.id) === item.hash).length;
      const confirmed = remote.filter(item => localInventory.get(item.id) === item.hash).map(item => item.id);
      if (confirmed.length) await recordMeshSent(confirmed, session.id, peer.node_id, 'confirmed');
      result.conflicts = remote.filter(item => localInventory.has(item.id) && localInventory.get(item.id) !== item.hash).length;
      const outgoing = local.filter(r => !remoteIds.has(r.id));
      const needed = remote.filter(item => !localInventory.has(item.id)).map(item => item.id);
      result.pending = outgoing.length + needed.length; await saveTransferSession(result);
      for (const batch of reportBatches(outgoing)) {
        stage = 'reports.send'; result.phase = 'sending';
        const ack = await rpc({ action: 'put', reports: batch });
        if (!Array.isArray(ack.acceptedIds) || ack.acceptedIds.some(id => !batch.some(r => r.id === id))) throw new Error('Invalid storage acknowledgement.');
        await recordMeshSent(ack.acceptedIds, session.id, peer.node_id);
        result.sent += ack.acceptedIds.length; result.pending -= ack.acceptedIds.length; result.conflicts += ack.conflicts || 0;
        meshTrace(stage, 'RECEIVER_COMMITTED', 'Receiver acknowledged stored reports.', { peer: peer.node_id, reports: ack.acceptedIds.length });
        await saveTransferSession(result);
      }
      while (needed.length) {
        stage = 'reports.receive'; result.phase = 'receiving';
        const requested = needed.slice(0, 32), data = await rpc({ action: 'get', ids: requested });
        if (!data.reports?.length || data.reports.some(r => !requested.includes(r.id))) throw new Error('Incomplete remote report response.');
        const committed = await commitMeshReports(data.reports, { sessionId: session.id, peerId: peer.node_id });
        await rpc({ action: 'ack', ids: committed.acceptedIds });
        const returned = new Set(data.reports.map(r => r.id));
        for (let i = needed.length - 1; i >= 0; i--) if (returned.has(needed[i])) needed.splice(i, 1);
        result.received += committed.received; result.duplicates += committed.duplicates; result.conflicts += committed.conflicts;
        meshTrace(stage, 'LOCAL_COMMITTED', 'Reports committed to this phone.', { peer: peer.node_id, reports: committed.received });
        result.pending -= committed.acceptedIds.length; await saveTransferSession(result);
      }
      stage = 'session.finish';
      await rpc({ action: 'done' }); result.status = result.pending || result.conflicts ? 'partial' : 'complete'; result.phase = 'finished';
      result.duration_ms = Date.now() - Date.parse(result.started_at);
      meshTrace(stage, result.status.toUpperCase(), 'Peer exchange finished.', { peer: peer.node_id, duration_ms: result.duration_ms });
      peer.last_sync = result; await saveTransferSession(result); notify();
      dispatch('rescue:ble-received', { imported: result.received, result });
      return { ...result, success: result.status === 'complete', synced: result.sent, imported: result.received, mode: 'bluetooth_ble' };
    } catch (error) {
      const detailed = meshError(stage, error, { peer: peer.node_id, address: peer.address });
      peer.error = detailed.message;
      peers.set(peer.node_id, peer);
      if (result) { result.status = 'partial'; result.error = detailed.message; result.phase = stage;
        await saveTransferSession(result).catch(storageError => meshTrace('session.persist', 'FAILED', storageError.message, { peer: peer.node_id })); }
      notify(); throw detailed;
    } finally { await nativeBle.disconnect().catch(error => meshTrace('session.disconnect', 'FAILED', error.message)); }
  });
}

export function getActiveBlePeers() {
  for (const [id, peer] of peers) if (Date.now() - peer.last_seen_epoch >= 300000) peers.delete(id);
  return [...peers.values()].map(p => ({ ...p, available: Date.now() - p.last_seen_epoch < 60000, is_online: Date.now() - p.last_seen_epoch < 60000 }));
}
export function rssiToDistance(rssi) {
  if (!Number.isFinite(rssi)) return undefined;
  return Math.max(1, Math.min(150, Math.round(10 ** ((-59 - rssi) / 24))));
}
export function rssiToQuality(rssi) { return rssi >= -60 ? { label: 'Strong', bars: 3 } : rssi >= -78 ? { label: 'Good', bars: 2 } : { label: 'Weak', bars: 1 }; }
export const requestBleDevice = scanForNearbyPhones;
export function registerSimulatedBlePeer() { throw new Error('Simulated phones are not included in real device discovery.'); }
