import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinates, equipmentInventory, dashboardSummary, loadDashboardFeed, localMemoryPage, requiresAuthorityServer, storedEntityTimeline } from '../src/brain/adminData.js';
import { reportRadar } from '../src/brain/reportRadar.js';

test('coordinates preserve real zeros and reject missing, invalid, or fallback GPS', () => {
  assert.deepEqual(coordinates({ lat: 0, lon: '0' }), { lat: 0, lon: 0 });
  for (const location of [null, { lat: '', lon: '' }, { lat: 91, lon: 0 }, { lat: 0, lon: Infinity }, { lat: 1, lon: 1, isFallback: true }]) assert.equal(coordinates(location), null);
});
test('equipment is unknown until reported; stored availability remains intact', () => {
  assert.equal(equipmentInventory(null).tourniquet, null);
  assert.deepEqual(equipmentInventory({ tourniquet: true, hemostatic_gauze: false, splint_stretcher: 'true' }), {
    tourniquet: true, hemostatic_gauze: false, splint_stretcher: null, water_purification: null, burn_dressing: null });
});
test('dashboard uses current entity states and never counts red hazards as casualties', () => {
  const records = [
    { id: 'sos', entity_id: 'victim', kind: 'sos', severity: 'red', observed_at: '2026-10-09T01:00:00Z' },
    { id: 'rescue', entity_id: 'victim', kind: 'incident', status: 'rescued_transported', severity: 'green', observed_at: '2026-10-09T02:00:00Z' },
    { id: 'hazard', kind: 'hazard', severity: 'red' },
    { id: 'safe', entity_id: 'facility', kind: 'checkpoint', status: 'operational', verified: true, observed_at: '2026-10-09T01:00:00Z' },
    { id: 'blocked', entity_id: 'facility', kind: 'hazard', status: 'blocked', observed_at: '2026-10-09T02:00:00Z' },
    { id: 'unverified', kind: 'checkpoint', status: 'operational', verified: false },
  ];
  const result = dashboardSummary(records.reverse());
  assert.equal(result.casualties.length, 1); assert.equal(result.redCount, 0); assert.equal(result.rescuedCount, 1);
  assert.equal(result.hazards.length, 2); assert.equal(result.havens.length, 0);
  assert.equal(dashboardSummary([]).havens.length, 0);
});
test('dashboard fetches all actual report pages and combines scopes without duplicate counts', async () => {
  const calls = [];
  const request = async (path, options) => {
    calls.push([path, options]);
    if (path.includes('scope=responders')) return { items: [{ id: 'private', visibility: 'responders' }], has_more: false };
    return path.endsWith('page=0') ? { items: [{ id: 'public1' }], has_more: true } : { items: [{ id: 'public2' }], has_more: false };
  };
  const result = await loadDashboardFeed(request, true);
  assert.equal(result.complete, true); assert.equal(result.items.length, 3); assert.equal(calls.length, 3);
  assert.ok(calls.every(([, o]) => o.noCache));
  assert.equal(calls.find(([p]) => p.includes('scope=responders'))[1].responder, true);
});
test('offline created timestamps preserve the latest evacuation state', () => {
  const result = dashboardSummary([
    { id: 'z-old', entity_id: 'victim', kind: 'sos', severity: 'red', created_at: '2026-10-09T01:00:00Z' },
    { id: 'a-new', entity_id: 'victim', kind: 'incident', status: 'rescued_transported', created_at: '2026-10-09T02:00:00Z' },
  ]);
  assert.equal(result.redCount, 0); assert.equal(result.rescuedCount, 1); assert.equal(result.casualties.length, 1);
});
test('feed failure is incomplete instead of a successful empty inventory; bad pagination cannot loop', async () => {
  const failed = await loadDashboardFeed(async path => { if (path.includes('responders')) throw new Error('HTTP 403'); return { items: [{ id: 'actual' }] }; });
  assert.equal(failed.complete, false); assert.equal(failed.items.length, 1); assert.match(failed.errors[0], /Responders: HTTP 403/);
  const loop = await loadDashboardFeed(async () => ({ items: [], has_more: true }));
  assert.equal(loop.complete, false); assert.match(loop.errors[0], /did not advance/);
});
test('offline memory separates scopes and supports complete dashboard pagination', async () => {
  const reports = [...Array.from({ length: 105 }, (_, i) => ({ id: `p${String(i).padStart(3, '0')}`, visibility: 'public' })), { id: 'private', visibility: 'responders' }, { id: 'group', visibility: 'group' }];
  const result = await loadDashboardFeed(async path => { const p = new URL(path, 'https://local.invalid').searchParams; return localMemoryPage(reports, { scope: p.get('scope'), page: Number(p.get('page')), limit: Number(p.get('limit')) }); });
  assert.equal(result.complete, true); assert.equal(result.items.length, 106); assert.ok(!result.items.some(r => r.id === 'group'));
});
test('only signing requests require a central server; ordinary offline SOS stays supported', () => {
  assert.equal(requiresAuthorityServer('/api/reports', 'POST', { kind: 'sos', verified: false }), false);
  assert.equal(requiresAuthorityServer('/api/reports', 'POST', { verified: true }), true);
  assert.equal(requiresAuthorityServer('/api/guides/publish', 'POST'), true);
  assert.equal(requiresAuthorityServer('/api/guides', 'GET'), false);
});
test('entity timeline uses stored observations and central precedence without invented transfers or facilities', () => {
  assert.deepEqual(storedEntityTimeline([], 'unknown').timeline, []);
  assert.equal(storedEntityTimeline([], 'unknown').effective, null);
  const reports = [
    { id: 'danger', entity_id: 'gate', kind: 'hazard', status: 'blocked', observed_at: '2026-10-09T01:00:00Z' },
    { id: 'open', entity_id: 'gate', kind: 'checkpoint', status: 'operational', verified: false, observed_at: '2026-10-09T02:00:00Z' },
  ];
  const result = storedEntityTimeline(reports, 'gate', Date.parse('2026-10-09T03:00:00Z'));
  assert.equal(result.effective.id, 'danger'); assert.equal(result.conflict, true); assert.equal(result.alternative_recommendation, null);
});
test('empty radar stays empty and missing GPS cannot become a fictitious position', () => {
  const result = reportRadar([], { lat: 0, lon: 0 });
  assert.deepEqual(result.radar_items, []); assert.equal(result.total_found, 0); assert.equal(result.summary.nearest_shelter, null);
  assert.throws(() => reportRadar([], {}), /valid location/);
});
test('radar displays actual located reports only and applies radius/category filtering', () => {
  const reports = [{ id: 'near', kind: 'sos', severity: 'red', location: { lat: 0, lon: 0.001 } }, { id: 'unknown', kind: 'incident' }, { id: 'far', kind: 'hazard', location: { lat: 20, lon: 20 } }];
  const result = reportRadar(reports, { lat: 0, lon: 0, radius_m: 500 });
  assert.equal(result.total_found, 1); assert.equal(result.radar_items[0].id, 'near'); assert.equal(result.radar_items[0].cardinal, 'E');
  assert.equal(result.radar_items[0].verified, false);
  assert.deepEqual(reportRadar(reports, { lat: 0, lon: 0, filter_category: 'shelters' }).radar_items, []);
});
