import test from 'node:test';
import assert from 'node:assert/strict';
import { localReportAnswer, reportQuestion } from '../src/brain/localReportChat.js';
const report = (id, text, extra = {}) => ({ id, kind: 'resource', text, visibility: 'public', status: 'operational',
  observed_at: '2026-10-10T01:00:00Z', location: { lat: 0, lon: 0.001 }, ...extra });

test('supply questions search real saved reports; purification remains guide retrieval', () => {
  assert.equal(reportQuestion('Where is the nearest fresh water supply?'), 'water');
  assert.equal(reportQuestion('How do I purify water?'), null);
  const result = localReportAnswer('nearest food supply', [report('water', 'Water at south gate'), report('food', 'Food at north gate')], { lat: 0, lon: 0 });
  assert.equal(result.memory_hits.length, 1); assert.equal(result.memory_hits[0].id, 'food');
  assert.equal(result.memory_hits[0].distance_m, 111); assert.match(result.text, /Reported 2026-10-10/);
  assert.match(result.text, /not confirmed/); assert.equal(result.suggested_action.nav_target.id, 'food');
});
test('latest closure replaces old opening; expired supplies and SOS requests are not destinations', () => {
  const now = Date.parse('2026-10-10T03:00:00Z');
  const result = localReportAnswer('nearest shelter', [report('open', 'Shelter open', { entity_id: 'gate' }),
    report('closed', 'Shelter closed', { entity_id: 'gate', status: 'closed', observed_at: '2026-10-10T02:00:00Z' }),
    report('expired', 'Shelter open', { expires_at: '2026-10-09T02:00:00Z' }),
    report('request', 'Need shelter', { kind: 'sos' })], { lat: 0, lon: 0 }, now);
  assert.deepEqual(result.memory_hits, []); assert.equal(result.suggested_action, null); assert.match(result.text, /No matching/);
});
test('absent coordinates never invent distance, bearing or destination; nearer reports sort first', () => {
  const missing = localReportAnswer('nearest water', [report('unknown', 'Drinking water reported', { location: null })], null);
  assert.equal(missing.memory_hits[0].distance_m, undefined); assert.match(missing.text, /Distance unavailable/);
  assert.equal(missing.suggested_action, null);
  const nearest = localReportAnswer('nearest water', [report('far', 'Water at far gate', { location: { lat: 0, lon: 1 } }), report('near', 'Water at near gate')], { lat: 0, lon: 0 });
  assert.equal(nearest.memory_hits[0].id, 'near');
});
