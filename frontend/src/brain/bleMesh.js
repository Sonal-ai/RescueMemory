import { Capacitor, registerPlugin } from '@capacitor/core';
import { getAllLocalReports, commitMeshReports, recordMeshSent, saveTransferSession } from './offlineStorage.js';
import { eligibleReports, reportHash, reportBatches, PROTOCOL_VERSION } from './meshProtocol.js';
import { cachedMeshLocation, meshLocation } from './meshRadar.js';
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

export async function ensureMeshIdentity() {
  if (!onAndroid) return { node_id: localStorage.getItem('rescue.device_id') };
  if (!identityPromise) identityPromise = nativeBle.getIdentity({ nodeId: localStorage.getItem('rescue.device_id'),
    name: sessionStorage.getItem('rescue.reporterId') || 'RescueMemory phone' }).then(identity => {
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
    session.timer = setTimeout(() => finishIncoming(address, 'Exchange timed out. Retry to continue.').catch(() => {}), 180000);
    sessions.set(address, session); return reply;
  }
  const session = sessions.get(address);
  if (!session) throw new Error('Sync session expired. Retry to continue.');
  const request = await unseal(session, message);
  if (request.action === 'authorize') {
    if (session.authorized || !await verifyPhoneProof(session.remoteIdentity.public_key, request.proof, session.text))
      throw new Error('Phone identity proof failed.');
    session.authorized = true;
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
        catch (error) { response = { v: 2, error: error.message }; await finishIncoming(address, error.message); }
        await nativeBle.reply({ address, messageId, payload: JSON.stringify(response) });
      }).catch(error => console.warn('[BLE] Response unavailable:', error.message));
      messageQueues.set(address, work);
      work.finally(() => { if (messageQueues.get(address) === work) messageQueues.delete(address); });
    });
    await nativeBle.addListener('disconnected', ({ address }) => {
      const work = messageQueues.get(address) || Promise.resolve();
      work.catch(() => {}).then(() => finishIncoming(address, 'Nearby phone disconnected. Retry to continue.')).catch(() => {});
    });
    await nativeBle.addListener('state', ({ ready }) => {
      if (!ready) { startup = null; dispatch('rescue:ble-state', { ready: false }); }
    });
    await nativeBle.addListener('presence', meta => {
      remember(meta, { address: meta.address, rssi: meta.rssi, last_seen_epoch: meta.last_seen_epoch });
    });
    attached = true;
    })().catch(error => { attachment = null; throw error; });
    await attachment;
  }
  if (!startup) startup = nativeBle.start({ automatic }).catch(error => { startup = null; throw error; });
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
  const id = meta.node_id || `unresolved_${observed.address}`;
  if (meta.node_id === localStorage.getItem('rescue.device_id')) return;
  peers.delete(`unresolved_${observed.address}`);
  const old = peers.get(id);
  const peer = { ...old, ...meta, node_id: id, address: observed.address, device_id: observed.address,
    first_seen_epoch: old?.first_seen_epoch || observed.last_seen_epoch || Date.now(),
    name: meta.name || observed.name, device_name: meta.name || observed.name, rssi: observed.rssi ?? old?.rssi,
    distance_m: rssiToDistance(observed.rssi ?? old?.rssi), last_seen_epoch: observed.last_seen_epoch || Date.now(), source: 'native_ble',
    is_online: true, sync_ready: meta.v === 2,
    device_ref: { native: true, id: observed.address } };
  peers.set(id, peer); notify(); return peer;
}

export async function scanForNearbyPhones() {
  if (!onAndroid) throw new Error('Nearby Bluetooth sync requires the Android app.');
  return serialize(async () => {
    await startBleReceiver(); const result = await nativeBle.scan(); const found = [];
    for (const observed of result.peers || []) {
      try {
        const meta = await nativeBle.connect({ address: observed.address });
        const peer = remember(meta, observed); if (peer) found.push(peer);
        // Native ping records this phone on the receiver even if its scan misses us.
        if (peer?.sync_ready) await nativeBle.ping().catch(() => {});
      } catch (error) {
        if (error.message?.includes('Update required')) { const peer = remember({ v: 1, error: error.message }, observed); if (peer) found.push(peer); }
        else {
          const existing = [...peers.values()].find(p => p.address === observed.address);
          if (existing) { existing.last_seen_epoch = Date.now(); existing.error = error.message; found.push(existing); }
        }
      } finally { await nativeBle.disconnect().catch(() => {}); }
    }
    notify(); return found;
  });
}

export async function syncWithBlePeer(peer) {
  if (!onAndroid || !peer.sync_ready) throw new Error('Update required on both Android phones.');
  return serialize(async () => {
    let result, session;
    try {
      await startBleReceiver();
      const meta = await nativeBle.connect({ address: peer.address });
      await nativeBle.ping();
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
      await rpc({ action: 'authorize', proof: await sign(text) });
      Object.assign(peer, meta, reply.metadata, { node_id: reply.identity.node_id, last_seen_epoch: Date.now(), error: null });
      peers.set(peer.node_id, peer); notify();
      const local = eligibleReports(await getAllLocalReports());
      const localInventory = new Map((await inventory(local)).map(item => [item.id, item.hash]));
      const remote = [];
      for (let offset = 0; ; offset += 128) { const page = await rpc({ action: 'inventory', offset });
        if (!Array.isArray(page.items) || remote.length > 100000) throw new Error('Invalid remote inventory.');
        remote.push(...page.items); if (!page.more) break;
      }
      const remoteIds = new Map(remote.map(item => [item.id, item.hash]));
      result.duplicates = remote.filter(item => localInventory.get(item.id) === item.hash).length;
      const confirmed = remote.filter(item => localInventory.get(item.id) === item.hash).map(item => item.id);
      if (confirmed.length) await recordMeshSent(confirmed, session.id, peer.node_id, 'confirmed');
      result.conflicts = remote.filter(item => localInventory.has(item.id) && localInventory.get(item.id) !== item.hash).length;
      const outgoing = local.filter(r => !remoteIds.has(r.id));
      const needed = remote.filter(item => !localInventory.has(item.id)).map(item => item.id);
      result.pending = outgoing.length + needed.length; await saveTransferSession(result);
      for (const batch of reportBatches(outgoing)) {
        const ack = await rpc({ action: 'put', reports: batch });
        if (!Array.isArray(ack.acceptedIds) || ack.acceptedIds.some(id => !batch.some(r => r.id === id))) throw new Error('Invalid storage acknowledgement.');
        await recordMeshSent(ack.acceptedIds, session.id, peer.node_id);
        result.sent += ack.acceptedIds.length; result.pending -= ack.acceptedIds.length; result.conflicts += ack.conflicts || 0;
        await saveTransferSession(result);
      }
      while (needed.length) {
        const requested = needed.slice(0, 32), data = await rpc({ action: 'get', ids: requested });
        if (!data.reports?.length || data.reports.some(r => !requested.includes(r.id))) throw new Error('Incomplete remote report response.');
        const committed = await commitMeshReports(data.reports, { sessionId: session.id, peerId: peer.node_id });
        await rpc({ action: 'ack', ids: committed.acceptedIds });
        const returned = new Set(data.reports.map(r => r.id));
        for (let i = needed.length - 1; i >= 0; i--) if (returned.has(needed[i])) needed.splice(i, 1);
        result.received += committed.received; result.duplicates += committed.duplicates; result.conflicts += committed.conflicts;
        result.pending -= committed.acceptedIds.length; await saveTransferSession(result);
      }
      await rpc({ action: 'done' }); result.status = result.pending || result.conflicts ? 'partial' : 'complete';
      peer.last_sync = result; await saveTransferSession(result); notify();
      dispatch('rescue:ble-received', { imported: result.received, result });
      return { ...result, success: result.status === 'complete', synced: result.sent, imported: result.received, mode: 'bluetooth_ble' };
    } catch (error) {
      peer.error = error.message;
      if (result) { result.status = 'partial'; result.error = error.message; await saveTransferSession(result); }
      notify(); throw error;
    } finally { await nativeBle.disconnect().catch(() => {}); }
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
