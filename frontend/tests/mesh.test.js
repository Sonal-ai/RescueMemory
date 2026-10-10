import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import 'fake-indexeddb/auto';
import { eligibleReports, mergePeers, mergePeerTelemetry, reportBatches, reportHash } from '../src/brain/meshProtocol.js';
import { verifyResponder, toBase64, seal, unseal, ephemeralKey, sessionKey } from '../src/brain/meshSecurity.js';
import { meshLocation, peerRadarPosition } from '../src/brain/meshRadar.js';
import { saveOfflineReport, saveImportedReports, commitMeshReports, getAllLocalReports, recordMeshSent, getMeshHistory, getUnsyncedReports } from '../src/brain/offlineStorage.js';

globalThis.window = new EventTarget();
globalThis.localStorage = { values: new Map(), getItem(k) { return this.values.get(k) || null; }, setItem(k, v) { this.values.set(k, v); } };
const report = (id, extra = {}) => ({ id, text: 'Flooded gate सुरक्षित 🆘', kind: 'hazard', visibility: 'public',
  location: { lat: 0, lon: 0 }, severity: 'red', created_at: '2026-10-08T01:00:00Z', verified: false, ...extra });

test('merge Bluetooth/cloud/server identity, preserve real 0% battery and exclude self', () => {
  const now = Date.now();
  const merged = mergePeers([[{ node_id: 'A', source: 'native_ble', battery: 0, address: 'MAC-new', last_seen_epoch: now }],
    [{ node_id: 'A', source: 'cloud_mesh', battery: 80 }, { node_id: 'self', source: 'cloud_mesh' }],
    [{ node_id: 'A', source: 'server' }, { node_id: 'B', name: 'Same name', source: 'server' }]], 'self', now);
  assert.equal(merged.length, 2); assert.equal(merged[0].battery, 0); assert.equal(merged[0].address, 'MAC-new');
  assert.deepEqual(merged[0].transports, ['native_ble', 'cloud_mesh', 'server']);
  assert.equal(merged[0].available, true); assert.equal(merged[1].available, false);
  assert.equal(mergePeers([[{ node_id: 'A', source: 'native_ble', last_seen_epoch: now - 61000 }]], 'self', now)[0].available, false);
});

test('current sharing policy exports all scopes and SOS types without responder enrollment', () => {
  const reports = [report('public'), report('private', { visibility: 'responders' }), report('group', { visibility: 'group' })];
  assert.deepEqual(eligibleReports(reports).map(r => r.id), ['public', 'private', 'group']);
  assert.equal(eligibleReports([report('legacy', { kind: 'incident', visibility: undefined })]).length, 1);
});

test('identified address replaces its raw beacon and malformed observations are ignored', () => {
  const now = Date.now();
  const rows = mergePeers([[undefined, { node_id: 'unresolved_MAC', address: 'MAC', source: 'native_ble' },
    { node_id: 'phone-B', address: 'MAC', source: 'native_ble', battery: 65, last_seen_epoch: now }]], 'self', now);
  assert.equal(rows.length, 1); assert.equal(rows[0].node_id, 'phone-B'); assert.equal(rows[0].battery, 65);
});

test('scan and older telemetry retain the last real battery, including 0%', () => {
  const prior = { battery: 0, charging: true, battery_measured_at: 200 };
  for (const update of [{}, { battery: null }, { battery: 97, battery_measured_at: 100 }]) {
    assert.deepEqual(mergePeerTelemetry(prior, update), prior);
  }
  assert.equal(mergePeerTelemetry(prior, { battery: 1, battery_measured_at: 300 }).battery, 1);
});

test('unchanged cloud downlinks import once; revisions count once and preserve pending local edits', async () => {
  const remote = report('cloud-count-once', { synced: true });
  assert.equal(await saveImportedReports([remote]), 1);
  assert.equal(await saveImportedReports([{ ...remote, imported_at: 'new transfer time' }]), 0);
  assert.equal(await saveImportedReports([{ ...remote, text: 'Actual revised report' }]), 1);
  assert.equal(await saveImportedReports([{ ...remote, text: 'Actual revised report' }]), 0);
  assert.equal(await saveImportedReports([{ ...remote, text: 'Older cloud copy', observed_at: '2026-10-07T01:00:00Z' }]), 0);
  assert.equal((await getAllLocalReports()).find(r => r.id === remote.id).text, 'Actual revised report');
  await saveOfflineReport(report('cloud-local-pending'));
  assert.equal(await saveImportedReports([report('cloud-local-pending', { text: 'Remote overwrite' })]), 0);
});

test('more than four long Unicode reports survive byte-sized batching without truncation', async () => {
  const reports = Array.from({ length: 18 }, (_, i) => report(`long-${i}`, { text: '🆘 सहायता '.repeat(1000) }));
  const batches = reportBatches(reports);
  assert.ok(batches.length > 1); assert.deepEqual(batches.flat(), reports);
  assert.ok(batches.every(batch => new TextEncoder().encode(JSON.stringify(batch)).length <= 60000));
  assert.equal(await reportHash(reports[0]), await reportHash({ ...reports[0], imported_at: 'later', synced: true }));
  assert.throws(() => reportBatches([report('oversized', { text: 'x'.repeat(70000) })]), /remains pending/);
});

test('storage commits receipts, deduplicates retries, preserves local edits and cloud pending state', async () => {
  const original = await saveOfflineReport(report('storage-own'));
  const context = { sessionId: 's-one', peerId: 'B' };
  const received = await commitMeshReports([report('storage-remote'), original], context);
  assert.equal(received.received, 1); assert.equal(received.duplicates, 1);
  const duplicate = await commitMeshReports([report('storage-remote')], context);
  assert.equal(duplicate.received, 0); assert.equal(duplicate.duplicates, 1);
  const conflict = await commitMeshReports([report('storage-own', { text: 'different content' })], context);
  assert.equal(conflict.conflicts, 1); assert.deepEqual(conflict.acceptedIds, []);
  await recordMeshSent(['storage-own'], 's-two', 'B');
  const history = await getMeshHistory(); assert.equal(history.receipts.length, 3);
  assert.ok((await getUnsyncedReports()).some(r => r.id === 'storage-own'));
  assert.equal((await getAllLocalReports()).find(r => r.id === 'storage-own').text, original.text);
});

test('malformed batches reject atomically without inserting valid siblings', async () => {
  await assert.rejects(commitMeshReports([report('atomic-public'), report('atomic-invalid', { visibility: 'invalid' })],
    { sessionId: 'invalid', peerId: 'B' }), /Malformed/);
  assert.ok(!(await getAllLocalReports()).some(r => r.id.startsWith('atomic-')));
  await assert.rejects(commitMeshReports([report('invalid', { location: { lat: 999, lon: 0 } })], { sessionId: 'invalid', peerId: 'B' }));
});

test('fresh GPS positions use real distance and north-up bearing, including zero coordinates', () => {
  const now = Date.now(), local = { lat: 0, lon: 0, timestamp: now, accuracy: 4 };
  const north = peerRadarPosition(local, { node_id: 'B', location: { ...local, lat: 0.001, accuracy: 6 } }, now);
  assert.equal(north.source, 'gps'); assert.ok(Math.abs(north.distance_m - 111.195) < 0.1);
  assert.equal(north.bearing_deg, 0); assert.equal(north.accuracy_m, 10);
  const east = peerRadarPosition(local, { location: { ...local, lon: 0.001 } }, now);
  assert.equal(east.bearing_deg, 90);
  const same = peerRadarPosition(local, { location: local }, now);
  assert.equal(same.distance_m, 0); assert.equal(same.bearing_deg, null);
});

test('missing, stale or future GPS uses signal range with no claimed direction', () => {
  const now = Date.now(), local = { lat: 28, lon: 77, timestamp: now };
  for (const location of [null, { ...local, timestamp: now - 120001 }, { ...local, timestamp: now + 10000 }]) {
    const position = peerRadarPosition(local, { node_id: 'B', location, distance_m: 9 }, now);
    assert.equal(position.source, 'signal'); assert.equal(position.distance_m, 9); assert.equal(position.bearing_deg, null);
  }
  assert.equal(meshLocation({ ...local, isFallback: true }), null);
  assert.equal(meshLocation({ ...local, lat: 999 }), null);
});

test('issuer signatures bind role, device key, expiry and cached revocations', async () => {
  const issuer = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKey = issuer.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const document = claims => { const bytes = Buffer.from(JSON.stringify(claims)); return { payload: bytes.toString('base64'), signature: sign('sha256', bytes, issuer.privateKey).toString('base64') }; };
  const now = Date.now();
  const claims = { version: 1, role: 'responder', issuer: 'rescuememory-command', node_id: 'B', public_key: 'device-key',
    serial: 'serial-one', not_before: Math.floor(now / 1000) - 1, expires: Math.floor(now / 1000) + 86400 };
  const identity = { node_id: 'B', public_key: 'device-key', certificate: document(claims) };
  assert.equal(await verifyResponder(identity, now, publicKey), true);
  assert.equal(await verifyResponder({ ...identity, node_id: 'copied-device' }, now, publicKey), false);
  assert.equal(await verifyResponder({ ...identity, public_key: 'copied-key' }, now, publicKey), false);
  assert.equal(await verifyResponder({ ...identity, certificate: document({ ...claims, expires: claims.not_before }) }, now, publicKey), false);
  assert.equal(await verifyResponder({ ...identity, certificate: { ...identity.certificate, payload: toBase64(Buffer.from('tampered')) } }, now, publicKey), false);
  localStorage.setItem('rescue.responder_revocations', JSON.stringify(document({ serials: ['serial-one'], issued_at: Math.floor(now / 1000) })));
  assert.equal(await verifyResponder(identity, now, publicKey), false);
});

test('encrypted session rejects tampering, wrong direction, and replay', async () => {
  const a = await ephemeralKey(), b = await ephemeralKey();
  const left = { id: 'session', localId: 'A', peerId: 'B', outbound: 0, inbound: 0,
    key: await sessionKey(a.privateKey, b.public_key, 'bound transcript') };
  const right = { id: 'session', localId: 'B', peerId: 'A', outbound: 0, inbound: 0,
    key: await sessionKey(b.privateKey, a.public_key, 'bound transcript') };
  const encrypted = await seal(left, { private: 'SOS' });
  assert.equal(encrypted.data.includes('SOS'), false);
  assert.deepEqual(await unseal(right, encrypted), { private: 'SOS' });
  await assert.rejects(unseal(right, encrypted), /replayed/);
  const next = await seal(left, { private: 'second SOS' });
  await assert.rejects(unseal(right, { ...next, data: next.data.slice(0, -4) + 'AAAA' }));
  await assert.rejects(unseal({ ...right, peerId: 'wrong-phone' }, next));
  assert.deepEqual(await unseal(right, next), { private: 'second SOS' });
});
