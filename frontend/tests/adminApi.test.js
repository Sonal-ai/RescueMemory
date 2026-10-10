import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

// Match Vite's bundled JSON import behavior in the Node API integration test.
registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith('/prototypeAccess.js')) {
    const result = nextLoad(url, context);
    return { ...result, source: String(result.source).replace("import.meta.env?.VITE_PROTOTYPE_ACCESS !== 'false'", 'false') };
  }
  if (url.endsWith('.json')) return { format: 'module', source: `export default ${JSON.stringify(JSON.parse(readFileSync(new URL(url), 'utf8')))};`, shortCircuit: true };
  return nextLoad(url, context);
} });

// Import without a browser lifecycle so background timers cannot touch real services.
const values = new Map();
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
let requests = 0;
globalThis.fetch = async () => { requests++; return { ok: true, json: async () => [] }; };
const { api, getNativeOrWebLocation } = await import('../src/api.js');
const { getAllLocalReports } = await import('../src/brain/offlineStorage.js');
globalThis.window = new EventTarget();
window.location = { hostname: 'local.invalid', protocol: 'https:', origin: 'https://local.invalid' };
globalThis.CustomEvent ||= class extends Event { constructor(type, options) { super(type); this.detail = options?.detail; } };

test('actual API refuses offline signed publications while retaining ordinary SOS storage and scoped reads', async () => {
  const before = requests;
  await assert.rejects(api('/api/guides/publish', { method: 'POST', body: { id: 'guide' }, admin: true }), /central server/);
  await assert.rejects(api('/api/reports', { method: 'POST', body: { verified: true, kind: 'checkpoint' }, admin: true }), /central server/);
  assert.equal(requests, before); assert.deepEqual(await getAllLocalReports(), []);
  const result = await api('/api/reports', { method: 'POST', body: { text: 'Actual help request', kind: 'sos', visibility: 'public', severity: 'red', verified: false, location: { lat: 0, lon: 0 } } });
  assert.equal(result.queued, true);
  assert.equal((await getAllLocalReports()).length, 1);
  const publicFeed = await api('/api/memory?scope=public&limit=100&page=0');
  assert.equal(publicFeed.items.length, 1);
  assert.deepEqual((await api('/api/memory?scope=responders&limit=100&page=0')).items, []);
  const timeline = await api('/api/entities/nonexistent');
  assert.deepEqual(timeline.timeline, []); assert.equal(timeline.effective, null);
});

test('strict admin GPS never returns or stores a Delhi anchor when GPS is unavailable', async () => {
  await assert.rejects(getNativeOrWebLocation({ allowCached: false, allowFallback: false }), /GPS unavailable/);
  assert.equal(localStorage.getItem('rescue.lastLocation'), null);
});

test('a rejected online authority request cannot turn into a fabricated offline success', async () => {
  navigator.onLine = true;
  localStorage.setItem('rescue.backendUrl', 'https://backend.invalid');
  const previous = (await getAllLocalReports()).length;
  globalThis.fetch = async () => ({ ok: false, status: 403, headers: { get: () => 'application/json' }, json: async () => ({ detail: 'actual authorization failure' }) });
  await assert.rejects(api('/api/reports', { method: 'POST', body: { verified: true, kind: 'checkpoint' }, admin: true }), /actual authorization failure/);
  await assert.rejects(api('/api/guides/publish', { method: 'POST', body: { id: 'actual-guide' }, admin: true }), /actual authorization failure/);
  assert.equal((await getAllLocalReports()).length, previous);
});
