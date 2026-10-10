import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import 'fake-indexeddb/auto';
import { pushReportsToCloud, pullReportsFromCloud, strToUuid } from '../src/brain/cloudSync.js';
import { prepareReport } from '../src/brain/reportIdentity.js';
import { eligibleReports, reportHash } from '../src/brain/meshProtocol.js';
import { saveOfflineReport, saveImportedReports, getAllLocalReports, getUnsyncedReports, markReportsSynced } from '../src/brain/offlineStorage.js';
import { reportRadar } from '../src/brain/reportRadar.js';

globalThis.window = new EventTarget();
globalThis.localStorage = { getItem: () => 'origin-phone' };
const response = result => ({ ok: true, status: 200, json: async () => ({ status: 'ok', result }) });
const sos = () => prepareReport({ kind: 'sos', text: 'Operator requested help at the gate', reporter_id: 'origin-phone',
  visibility: 'responders', severity: 'red', status: 'needs_help', location: { lat: 0, lon: 0 } }, 'origin-phone');

test('one originating SOS keeps its hash and one Qdrant point across three relay uploads', async () => {
  const points = new Map(), requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push(url);
    assert.equal(new URL(url).searchParams.get('wait'), 'true');
    for (const point of JSON.parse(options.body).points) points.set(point.id, point);
    return response({ status: 'completed' });
  };
  const origin = await saveOfflineReport(sos());
  const hopB = eligibleReports([origin])[0], hopC = eligibleReports([structuredClone(hopB)])[0];
  for (const copy of [origin, hopB, hopC, origin]) assert.deepEqual(await pushReportsToCloud([copy]), [origin.id]);
  assert.equal(await reportHash(origin), await reportHash(hopC));
  assert.equal(points.size, 1);
  assert.equal([...points.values()][0].payload.origin_device, 'origin-phone');
  assert.equal([...points.values()][0].payload.source_report_id, origin.id);
  assert.ok(requests.every(url => url.includes('rescue_responder_events')));
});

test('API, offline storage and relays select the same SOS collection without an explicit scope', async () => {
  const request = prepareReport({ kind: 'sos', text: 'Help requested', reporter_id: 'phone-a' }, 'phone-a');
  const saved = await saveOfflineReport(request);
  const relay = eligibleReports([saved])[0];
  assert.equal(request.visibility, 'responders');
  assert.equal(saved.visibility, relay.visibility);
  assert.equal(request.status, relay.status);
  assert.equal(request.severity, relay.severity);
  assert.equal(relay.location, undefined);
  assert.notEqual(sos().id, sos().id);
});

test('cloud and edge acknowledgements are separate; failed Qdrant writes remain pending', async () => {
  const record = await saveOfflineReport(sos());
  await markReportsSynced([record.id], { channel: 'edge' });
  assert.ok((await getUnsyncedReports()).some(r => r.id === record.id));
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  assert.deepEqual(await pushReportsToCloud([record]), []);
  assert.ok((await getUnsyncedReports()).some(r => r.id === record.id));
  globalThis.fetch = async () => response({ status: 'completed' });
  await markReportsSynced(await pushReportsToCloud([record]));
  assert.ok(!(await getUnsyncedReports()).some(r => r.id === record.id));
});

test('paginated cloud download includes SOS, keeps scopes, excludes presence and updates real shelter metadata', async () => {
  const initial = prepareReport({ kind: 'checkpoint', text: 'Entered hall (Shelter). Facilities: Water.',
    reporter_id: 'operator', location: { lat: 0, lon: 0.001 }, visibility: 'public', status: 'operational', severity: 'green',
    observed_at: '2026-10-10T01:00:00Z' }, 'operator');
  await saveImportedReports([initial]);
  const revised = { ...initial, text: 'Renamed hall (Shelter). Facilities: Water.', observed_at: '2026-10-10T02:00:00Z' };
  const alert = sos(), calls = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body });
    if (url.includes('rescue_responder_events')) return response({ points: [{ payload: alert }], next_page_offset: null });
    return response(body.offset ? { points: [{ payload: revised }], next_page_offset: null }
      : { points: [{ payload: { id: 'presence-only', kind: 'presence', visibility: 'public' } }], next_page_offset: 'next-page' });
  };
  const reports = await pullReportsFromCloud(1, { includeResponders: true });
  assert.deepEqual(reports.map(r => r.id).sort(), [initial.id, alert.id].sort());
  assert.equal(calls.length, 3);
  assert.equal(await saveImportedReports(reports), 2);
  assert.equal(await saveImportedReports(reports), 0);
  const radar = reportRadar(await getAllLocalReports(), { lat: 0, lon: 0 });
  const marker = radar.radar_items.find(r => r.id === initial.id);
  assert.equal(marker.name, 'Renamed hall'); assert.equal(marker.category, 'shelter');
  await saveImportedReports([{ ...revised, status: 'closed', observed_at: '2026-10-10T03:00:00Z' }]);
  assert.ok(!reportRadar(await getAllLocalReports(), { lat: 0, lon: 0 }).radar_items.some(r => r.id === initial.id));
});

test('the cloud point hash is identical in secure WebViews and HTTP browser origins', async () => {
  const text = 'Original SOS 🆘 सहायता';
  const expected = Buffer.from(createHash('sha256').update(text).digest().subarray(0, 16));
  expected[6] = (expected[6] & 15) | 64; expected[8] = (expected[8] & 63) | 128;
  const secure = await strToUuid(text), cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    assert.equal(await strToUuid(text), secure);
    assert.equal(secure.replaceAll('-', ''), expected.toString('hex'));
  } finally { Object.defineProperty(globalThis, 'crypto', cryptoDescriptor); }
});
