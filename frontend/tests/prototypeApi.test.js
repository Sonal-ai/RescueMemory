import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith('.json')) return { format: 'module', shortCircuit: true,
    source: `export default ${JSON.stringify(JSON.parse(readFileSync(new URL(url), 'utf8')))};` };
  return nextLoad(url, context);
} });
const values = new Map();
globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
globalThis.fetch = async () => { throw new Error('Offline demo must not require a server'); };
const { api, triggerAutoSync, getSurvivalRadar } = await import('../src/api.js');
const { getAllLocalReports, getAllLocalGuides } = await import('../src/brain/offlineStorage.js');
const { loadDashboardFeed, dashboardSummary } = await import('../src/brain/adminData.js');
const { wireReport } = await import('../src/brain/meshProtocol.js');
globalThis.window = new EventTarget();
window.location = { hostname: 'localhost', protocol: 'https:', origin: 'https://localhost' };
globalThis.CustomEvent ||= class extends Event { constructor(type, options) { super(type); this.detail = options?.detail; } };
const shelter = { kind: 'checkpoint', entity_id: 'entered-shelter', text: 'Community shelter entered by operator',
  reporter_id: 'operator', location: { lat: 0, lon: 0 }, status: 'operational', severity: 'green', visibility: 'public', verified: true };
const guide = { id: 'operator-guide', title: 'Demo directions', keywords: 'app directions',
  summary: 'Read the saved directions entered by the operator.', steps: ['Open the radar.'], warnings: [], source: 'App controls', reviewer: 'Demo operator' };

test('prototype safe points persist with real coordinates and appear even while server feed is empty', async () => {
  const result = await api('/api/reports', { method: 'POST', admin: true, body: shelter });
  const stored = (await getAllLocalReports())[0];
  assert.equal(result.event.id, stored.id); assert.equal(result.queued, true);
  assert.deepEqual(stored.location, shelter.location);
  assert.equal(stored.prototype_confirmed, true); assert.equal(stored.verified, false);
  assert.equal(stored.authority_tag, undefined);
  const feed = await loadDashboardFeed(async () => ({ items: [], has_more: false }), true, [stored]);
  assert.equal(feed.items.length, 1); assert.equal(dashboardSummary(feed.items).havens.length, 1);
  const cloudPendingFeed = await loadDashboardFeed(async () => ({ items: [], has_more: false }), true, [{ ...stored, synced: true }]);
  assert.equal(dashboardSummary(cloudPendingFeed.items).havens.length, 1);
  assert.equal(wireReport(stored).prototype_confirmed, true); assert.equal(wireReport(stored).verified, false);
});
test('offline protocol saves are actual versioned drafts without invented server signatures', async () => {
  const first = await api('/api/guides/publish', { method: 'POST', admin: true, body: guide });
  assert.equal(first.version, 1); assert.equal(first.queued, true); assert.equal(first.auth_tag, undefined);
  const second = await api('/api/guides/publish', { method: 'POST', admin: true, body: { ...guide, summary: 'Updated instructions entered by the same operator.' } });
  assert.equal(second.version, 2); assert.equal((await getAllLocalGuides())[0].pending_publication, true);
});
test('invalid input fails instead of creating a fake point or guide', async () => {
  const before = (await getAllLocalReports()).length;
  await assert.rejects(api('/api/reports', { method: 'POST', admin: true, body: { ...shelter, location: { lat: 99, lon: 0 } } }), /coordinates/);
  await assert.rejects(api('/api/guides/publish', { method: 'POST', admin: true, body: { id: 'bad' } }), /title/);
  assert.equal((await getAllLocalReports()).length, before);
});
test('an older server role rejection saves a clearly queued local point', async () => {
  navigator.onLine = true;
  globalThis.fetch = async () => ({ ok: false, status: 403, headers: { get: () => 'application/json' }, json: async () => ({ detail: 'only command may verify a report' }) });
  const result = await api('/api/reports', { method: 'POST', admin: true, body: { ...shelter, entity_id: 'second-shelter' } });
  assert.equal(result.queued, true); assert.match(result.server_error, /only command/);
  assert.equal(result.event.prototype_confirmed, true); assert.equal(result.event.authority_tag, undefined);
  navigator.onLine = false;
});
test('queued protocol is cleared only by an actual signed publication response', async () => {
  navigator.onLine = true; let published = 0; let confirmed = 0;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/health')) return { ok: true };
    if (url.endsWith('/api/reports')) { const body = JSON.parse(options.body); assert.equal(body.verified, true); confirmed++; return { ok: true }; }
    if (url.endsWith('/api/guides/publish')) {
      const body = JSON.parse(options.body); assert.equal(body.id, guide.id); published++;
      return { ok: true, json: async () => ({ ...body, kind: 'protocol', version: 3, auth_tag: 'server-test-ack' }) };
    }
    throw new Error('Other channels unavailable in this test');
  };
  await triggerAutoSync(); navigator.onLine = false;
  assert.ok(published > 0); assert.ok(confirmed > 0);
  assert.equal((await getAllLocalGuides())[0].pending_publication, false);
  assert.equal((await getAllLocalGuides())[0].auth_tag, 'server-test-ack');
});

test('live server empty radar preserves the operator shelter stored on this phone', async () => {
  navigator.onLine = true;
  globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' },
    json: async () => ({ radar_items: [], summary: { operational_shelters: 0 } }) });
  const radar = await getSurvivalRadar({ lat: 0, lon: 0, radius_m: 5000 });
  assert.ok(radar.radar_items.some(item => item.entity_id === shelter.entity_id));
  assert.ok(radar.summary.operational_shelters > 0);
  await assert.rejects(getSurvivalRadar(), /confirmed GPS/);
  navigator.onLine = false;
});
