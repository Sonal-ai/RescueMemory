import test from 'node:test';
import assert from 'node:assert/strict';
import { reportRadar } from '../src/brain/reportRadar.js';
import { savedShelters, currentSurvivorReports, mergeSurvivalRadar, targetMeasurements, reportedFacilities, radarMapReports, mapMarkerSignature } from '../src/brain/survivorReports.js';

const shelter = { id: 'local-shelter', entity_id: 'shelter-entered', kind: 'checkpoint',
  text: 'Community Hall (Shelter). Facilities: Drinking water', status: 'operational',
  location: { lat: 0, lon: 0.001 }, visibility: 'public', prototype_confirmed: true,
  observed_at: '2026-10-10T06:00:00Z' };

test('map refreshes a moved or changed report with the same ID and excludes cleared points', () => {
  const moved = { ...shelter, category: 'shelter', name: 'Community Hall',
    location: { lat: 0.01, lon: 0.02 }, observed_at: '2026-10-11T06:00:00Z' };
  const hop = { ...shelter, id: 'hop', entity_id: 'hop', kind: 'sos' };
  const points = radarMapReports([shelter, hop], [moved]);
  assert.equal(points.length, 2);
  assert.deepEqual(points.find(item => item.id === shelter.id).location, moved.location);
  const before = mapMarkerSignature([shelter], shelter);
  assert.notEqual(mapMarkerSignature([moved], moved), before);
  assert.notEqual(mapMarkerSignature([{ ...shelter, status: 'closed' }], shelter), before);
  assert.notEqual(mapMarkerSignature([], null), before);
  assert.equal(mapMarkerSignature([structuredClone(shelter)], structuredClone(shelter)), before);
  assert.deepEqual(radarMapReports([shelter, hop], [moved], [shelter.id]).map(item => item.id), ['hop']);
  const closed = { ...shelter, status: 'closed', observed_at: '2026-10-12T06:00:00Z' };
  assert.equal(radarMapReports([closed], [moved])[0].status, 'closed');
});

test('an operator shelter stays visible without survivor GPS and retains entered coordinates', () => {
  const [item] = savedShelters([shelter]);
  assert.equal(item.name, 'Community Hall');
  assert.deepEqual(item.location, shelter.location);
  assert.equal(item.distance_m, undefined);
  assert.equal(item.bearing_deg, undefined);
  assert.equal(item.prototype_confirmed, true);
});

test('an empty server radar cannot hide a saved or received shelter', () => {
  const local = reportRadar([{ ...shelter, imported: true }], { lat: 0, lon: 0, radius_m: 5000 });
  const result = mergeSurvivalRadar({ radar_items: [], summary: { operational_shelters: 0 } }, local);
  assert.equal(result.total_found, 1);
  assert.equal(result.summary.operational_shelters, 1);
  assert.equal(result.radar_items[0].category, 'shelter');
  assert.equal(result.radar_items[0].cardinal, 'E');
  assert.equal(result.radar_items[0].distance_m, 111);
  assert.equal(result.radar_items[0].verified, false);
});

test('same shelter server acknowledgment does not create a second marker', () => {
  const local = reportRadar([shelter], { lat: 0, lon: 0 });
  const result = mergeSurvivalRadar({ radar_items: [{ ...local.radar_items[0], id: 'server-id', entity_id: undefined, name: shelter.entity_id }] }, local);
  assert.equal(result.total_found, 1);
});

test('a newer online shelter position replaces an older saved marker without duplicating it', () => {
  const local = reportRadar([shelter], { lat: 0, lon: 0 });
  const newer = reportRadar([{ ...shelter, id: 'updated-shelter', location: { lat: 0.001, lon: 0 }, observed_at: '2026-10-10T07:00:00Z' }], { lat: 0, lon: 0 });
  const result = mergeSurvivalRadar(newer, local);
  assert.equal(result.total_found, 1);
  assert.deepEqual(result.radar_items[0].location, { lat: 0.001, lon: 0 });
  assert.equal(result.radar_items[0].cardinal, 'N');
  assert.equal(mergeSurvivalRadar(local, newer).radar_items[0].id, 'updated-shelter');
});

test('latest closure removes old shelter from list and radar; expired shelters stay hidden', () => {
  const closed = { ...shelter, id: 'closed', status: 'closed', observed_at: '2026-10-10T07:00:00Z' };
  assert.deepEqual(savedShelters([shelter, closed]), []);
  assert.deepEqual(reportRadar([closed, shelter], { lat: 0, lon: 0 }).radar_items, []);
  assert.deepEqual(savedShelters([{ ...shelter, expires_at: '2000-01-01T00:00:00Z' }]), []);
  assert.equal(currentSurvivorReports([closed], [shelter])[0].id, 'closed');
  const stale = reportRadar([shelter], { lat: 0, lon: 0 });
  const latest = reportRadar([closed], { lat: 0, lon: 0 });
  assert.equal(mergeSurvivalRadar(stale, latest).total_found, 0);
});

test('faraway shelters stay listed while range-limited radar uses actual survivor GPS', () => {
  assert.equal(savedShelters([shelter]).length, 1);
  assert.equal(reportRadar([shelter], { lat: 20, lon: 20, radius_m: 5000 }).total_found, 0);
  assert.throws(() => reportRadar([shelter], {}), /valid location/);
});

test('absent, invalid or fallback coordinates never produce zero distance or north guidance', () => {
  const unknown = { distance: null, bearing: null, cardinal: null };
  assert.deepEqual(targetMeasurements(null, shelter.location), unknown);
  assert.deepEqual(targetMeasurements({ lat: 0, lon: 0 }, null), unknown);
  assert.deepEqual(targetMeasurements({ lat: 99, lon: 0 }, shelter.location), unknown);
  assert.deepEqual(targetMeasurements({ lat: 0, lon: 0, isFallback: true }, shelter.location), unknown);
  assert.deepEqual(targetMeasurements({ lat: 0, lon: 0 }, { lat: 0, lon: 0 }), { distance: 0, bearing: null, cardinal: null });
  assert.deepEqual(targetMeasurements({ lat: 0, lon: 0 }, shelter.location), { distance: 111, bearing: 90, cardinal: 'E' });
});

test('unknown report status and severity stay unknown; no assumed walking time or sample shelters', () => {
  const report = { ...shelter, status: undefined, severity: undefined };
  const data = reportRadar([report], { lat: 0, lon: 0 });
  assert.equal(data.radar_items[0].status, null);
  assert.equal(data.radar_items[0].severity, null);
  assert.equal(data.radar_items[0].walk_time_min, null);
  assert.equal(data.radar_items[0].triage_level, 'informational');
  assert.equal(data.summary.operational_shelters, 0);
  assert.deepEqual(savedShelters([]), []);
  assert.deepEqual(reportRadar([], { lat: 0, lon: 0 }).radar_items, []);
});

test('safe evacuation has no facilities without reports and never invents supplies or capacity', () => {
  assert.deepEqual(reportedFacilities([], { lat: 0, lon: 0 }), []);
  const [actual] = reportedFacilities([{ ...shelter, text: 'Entered hall', status: undefined }], null);
  assert.equal(actual.name, 'Entered hall');
  assert.deepEqual(actual.facilities, []);
  assert.equal(actual.status, null);
  assert.equal(actual.dist_m, null);
  assert.equal(actual.capacity, undefined);
  assert.deepEqual(reportedFacilities([shelter], null)[0].facilities, ['Drinking water']);
  assert.deepEqual(reportedFacilities([shelter], { lat: 0, lon: 0 }, { medical: true }), []);
});
