import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { generateKeyPairSync, sign } from 'node:crypto';

function pair(t, verifiedB = false, options = {}) {
  const issuer = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const issuerPublic = issuer.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const workers = new Map(), requests = new Map(), ready = [];
  let commandId = 0, failNextPut = false;
  for (const [id, peer] of [['A', 'B'], ['B', 'A']]) {
    const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicKey = key.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const bytes = Buffer.from(JSON.stringify({ version: 1, role: 'responder', issuer: 'rescuememory-command', node_id: id,
      public_key: publicKey, serial: id, not_before: Math.floor(Date.now() / 1000) - 1, expires: Math.floor(Date.now() / 1000) + 3600 }));
    const certificate = id === 'B' && verifiedB ? { payload: bytes.toString('base64'), signature: sign('sha256', bytes, issuer.privateKey).toString('base64') } : undefined;
    const worker = new Worker(new URL('./meshWorker.js', import.meta.url), {
      workerData: { id, peer, publicKey, certificate, battery: id === 'A' ? 0 : 54, peerBattery: { battery: id === 'A' ? 54 : 0 },
        signatureFormat: options.signatureFormat, webviewRejectsEcdsa: options.webviewRejectsEcdsa,
        corruptProof: options.corruptPhone === id,
        rotateKeyOnSign: options.rotatePhone === id,
        scanBlind: options.scanBlindPhone === id,
        privateKey: key.privateKey.export({ type: 'pkcs8', format: 'pem' }) },
      env: { ...process.env, MESH_TEST_ISSUER: issuerPublic },
    });
    workers.set(id, worker);
    ready.push(new Promise((resolve, reject) => {
      worker.on('error', reject);
      worker.on('message', message => {
        if (message.type === 'ready') resolve();
        if (message.type === 'native-request') {
          if (failNextPut && message.id === 4) { failNextPut = false;
            // Commit on the receiving phone, but lose the acknowledgement.
            requests.set(`drop-${message.from}-${message.id}`, true);
          }
          workers.get(message.to).postMessage({ type: 'native-event', name: 'message', event: {
            address: message.from, message_id: message.id, payload: message.payload } });
        }
        if (message.type === 'native-reply') {
          const drop = requests.get(`drop-${message.to}-${message.id}`);
          workers.get(message.to).postMessage({ type: 'native-response', id: message.id,
            payload: message.payload, error: drop ? 'Connection lost after receiver commit' : undefined });
        }
        if (message.type === 'native-disconnect') workers.get(message.to)?.postMessage({ type: 'native-event', name: 'disconnected', event: { address: message.from } });
        if (message.type === 'native-presence') workers.get(message.to)?.postMessage({ type: 'native-event', name: 'presence', event: message.event });
        if (message.type === 'command-result') {
          const promise = requests.get(message.id); requests.delete(message.id);
          if (message.error) promise?.reject(new Error(message.error)); else promise?.resolve(message.result);
        }
      });
    }));
  }
  t.after(async () => { await Promise.all([...workers.values()].map(worker => worker.terminate())); });
  const command = async (id, action, extra = {}) => {
    await Promise.all(ready);
    const cmd = ++commandId;
    return new Promise((resolve, reject) => {
      requests.set(cmd, { resolve, reject }); workers.get(id).postMessage({ type: 'command', id: cmd, action, ...extra });
    });
  };
  return { command, dropAcknowledgement() { failNextPut = true; } };
}
const report = (id, visibility = 'public') => ({ id, kind: visibility === 'responders' ? 'incident' : 'hazard', visibility,
  text: `Report ${id} 🆘 सहायता `.repeat(300), severity: 'red', location: { lat: 0, lon: 0 }, created_at: '2026-10-08T01:00:00Z' });

test('one-way scan announces the scanning phone back to a background peer without sharing reports', { timeout: 30000 }, async t => {
  const { command } = pair(t, false, { scanBlindPhone: 'B' });
  await command('A', 'seed', { reports: [report('not-a-presence-payload')] });
  await command('B', 'hidden', { hidden: true });
  assert.equal((await command('B', 'scan')).length, 0);
  assert.equal((await command('A', 'scan'))[0].node_id, 'B');
  const b = await command('B', 'read');
  assert.equal(b.peers[0].node_id, 'A'); assert.equal(b.peers[0].battery, 0);
  assert.equal(b.reports.length, 0); assert.equal(b.history.receipts.length, 0);
  await command('B', 'hidden', { hidden: false });
  const result = await command('A', 'sync');
  assert.equal(result.status, 'complete'); assert.equal(result.sent, 1);
});

test('app-owned runtime transfers reports without a Mesh page and discovery survives runtime detach', { timeout: 30000 }, async t => {
  const { command } = pair(t);
  await command('A', 'seed', { reports: [report('from-home-screen')] });
  await command('A', 'startRuntime');
  await command('A', 'scan');
  const end = Date.now() + 8000;
  let b;
  do {
    b = await command('B', 'read');
    if (b.reports.length) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < end);
  assert.equal(b.reports[0]?.id, 'from-home-screen');
  await command('A', 'detachRuntime');
  await command('B', 'scan');
  assert.equal((await command('A', 'read')).peers[0].node_id, 'B');
});

test('phone exchange succeeds when WebView ECDSA import fails, for DER and raw provider signatures', { timeout: 30000 }, async t => {
  for (const signatureFormat of ['der', 'ieee-p1363']) {
    await t.test(signatureFormat, async t => {
      const { command } = pair(t, false, { signatureFormat, webviewRejectsEcdsa: true });
      await command('A', 'seed', { reports: [report('A-medical', 'responders')] });
      await command('B', 'seed', { reports: [report('B-sos', 'responders')] });
      const result = await command('A', 'sync');
      assert.equal(result.status, 'complete'); assert.equal(result.sent, 1); assert.equal(result.received, 1);
    });
  }
});

test('invalid phone proof is rejected before any data or transfer receipts are shared', { timeout: 30000 }, async t => {
  for (const corruptPhone of ['A', 'B']) {
    await t.test(corruptPhone, async t => {
      const { command } = pair(t, false, { corruptPhone });
      await command('A', 'seed', { reports: [report('must-stay-local', 'responders')] });
      await assert.rejects(command('A', 'sync'), /identity proof failed/);
      assert.equal((await command('B', 'read')).reports.length, 0);
      assert.equal((await command('A', 'read')).history.receipts.length, 0);
    });
  }
});

test('stale cached device key fails explicitly and the next exchange reloads the real key', { timeout: 30000 }, async t => {
  const { command } = pair(t, false, { rotatePhone: 'B' });
  await command('A', 'seed', { reports: [report('preserve-key-retry', 'responders')] });
  await assert.rejects(command('A', 'sync'), /identity key changed/);
  assert.equal((await command('B', 'read')).reports.length, 0);
  const retry = await command('A', 'sync');
  assert.equal(retry.status, 'complete'); assert.equal(retry.sent, 1);
  assert.equal((await command('B', 'read')).reports.length, 1);
});

test('actual engine exchanges every report both ways and retry transfers nothing', { timeout: 30000 }, async t => {
  const { command } = pair(t);
  await command('A', 'seed', { reports: [...Array.from({ length: 12 }, (_, i) => report(`A-${i}`)), report('A-private', 'responders')] });
  await command('B', 'seed', { reports: Array.from({ length: 6 }, (_, i) => report(`B-${i}`)) });
  const result = await command('A', 'sync');
  assert.equal(result.sent, 13); assert.equal(result.received, 6); assert.equal(result.status, 'complete');
  const a = await command('A', 'read'), b = await command('B', 'read');
  assert.equal(a.reports.length, 19); assert.equal(b.reports.length, 19);
  assert.ok(b.reports.some(r => r.id === 'A-private'));
  assert.equal(b.history.transfers[0].status, 'complete');
  assert.equal(b.peers[0].last_sync.status, 'complete');
  const repeated = await command('A', 'sync');
  assert.equal(repeated.sent, 0); assert.equal(repeated.received, 0); assert.equal(repeated.duplicates, 19);
});

test('unenrolled phones exchange private, medical and group SOS in both directions', { timeout: 30000 }, async t => {
  const { command } = pair(t);
  await command('A', 'seed', { reports: [report('A-private', 'responders'), { ...report('A-group', 'group'), kind: 'sos', group_id: 'family' }] });
  await command('B', 'seed', { reports: [report('B-medical', 'responders'), report('B-public')] });
  const result = await command('A', 'sync');
  assert.equal(result.sent, 2); assert.equal(result.received, 2);
  const a = await command('A', 'read'), b = await command('B', 'read');
  assert.ok(b.reports.some(r => r.id === 'A-private'));
  assert.ok(b.reports.some(r => r.id === 'A-group' && r.group_id === 'family'));
  assert.ok(a.reports.some(r => r.id === 'B-medical' && r.kind === 'incident'));
});

test('handshake carries real battery and GPS telemetry in both directions offline', { timeout: 30000 }, async t => {
  const { command } = pair(t);
  const now = Date.now();
  const aLocation = { lat: 0, lon: 0, accuracy: 3, timestamp: now };
  const bLocation = { lat: 0.001, lon: 0.002, accuracy: 6, timestamp: now };
  await command('A', 'location', { location: aLocation });
  await command('B', 'location', { location: bLocation });
  await command('A', 'sync');
  const a = await command('A', 'read'), b = await command('B', 'read');
  assert.deepEqual(a.peers[0].location, bLocation); assert.equal(a.peers[0].battery, 54);
  assert.deepEqual(b.peers[0].location, aLocation); assert.equal(b.peers[0].battery, 0);
});

test('lost storage acknowledgement preserves committed data and retry does not duplicate', { timeout: 30000 }, async t => {
  const { command, dropAcknowledgement } = pair(t);
  await command('A', 'seed', { reports: [report('commit-once')] });
  dropAcknowledgement();
  await assert.rejects(command('A', 'sync'), /Connection lost/);
  const partial = await command('A', 'read'); assert.equal(partial.history.transfers[0].status, 'partial');
  assert.equal((await command('B', 'read')).reports.length, 1);
  const retry = await command('A', 'sync'); assert.equal(retry.sent, 0); assert.equal(retry.duplicates, 1);
  assert.ok((await command('A', 'read')).history.receipts.some(r => r.report_id === 'commit-once' && r.direction === 'confirmed'));
  assert.equal((await command('B', 'read')).reports.length, 1);
});

test('simultaneous exchanges preserve one copy per report on both phones', { timeout: 30000 }, async t => {
  const { command } = pair(t);
  await command('A', 'seed', { reports: [report('sim-A')] });
  await command('B', 'seed', { reports: [report('sim-B')] });
  await Promise.all([command('A', 'sync'), command('B', 'sync')]);
  assert.deepEqual((await command('A', 'read')).reports.map(r => r.id).sort(), ['sim-A', 'sim-B']);
  assert.deepEqual((await command('B', 'read')).reports.map(r => r.id).sort(), ['sim-A', 'sim-B']);
});
