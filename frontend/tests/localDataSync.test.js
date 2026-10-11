import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import 'fake-indexeddb/auto';

registerHooks({ load(url, context, next) {
  if (url.endsWith('.json')) return { format: 'module', shortCircuit: true,
    source: `export default ${JSON.stringify(JSON.parse(readFileSync(new URL(url), 'utf8')))};` };
  return next(url, context);
} });
globalThis.localStorage = { getItem: () => null };
globalThis.sessionStorage = { getItem: () => null };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
// Import without a browser window so only explicitly requested sync runs here.
const { triggerAutoSync, clearLocalDataAndRefresh } = await import('../src/brain/offlineBrain.js');
const { saveImportedReports, getAllLocalReports, getRemovedCloudReportIds } = await import('../src/brain/offlineStorage.js');
globalThis.window = new EventTarget();
const report = id => ({ id, source_report_id: id, entity_id: id, kind: 'checkpoint',
  reporter_id: 'operator', origin_device: 'operator', text: 'Entered shelter', visibility: 'public',
  status: 'operational', location: { lat: 0, lon: 0.001 }, observed_at: '2026-10-11T06:00:00Z' });
const response = reports => ({ ok: true, status: 200,
  json: async () => ({ result: { points: reports.map(payload => ({ payload })), next_page_offset: null } }) });

test('clear during an online download discards the old reply, then restores only actual Cloud records without uploading', async () => {
  const old = report('deleted-in-cloud'), fresh = report('current-cloud');
  await saveImportedReports([old]);
  let release, downloadStarted;
  const pending = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { downloadStarted = resolve; });
  let publicCalls = 0;
  const methods = [];
  globalThis.fetch = async (url, options) => {
    methods.push(options.method);
    if (url.endsWith('/health')) return { ok: false, status: 503 };
    if (url.includes('rescue_responder_events')) return response([]);
    if (++publicCalls === 1) { downloadStarted(); await pending; return response([old]); }
    return response([fresh]);
  };
  const originalSync = triggerAutoSync();
  await started;
  const cleared = new Promise(resolve => window.addEventListener('rescue:reports-changed', resolve, { once: true }));
  const reset = clearLocalDataAndRefresh();
  await cleared;
  assert.deepEqual(await getAllLocalReports(), []);
  release();
  assert.equal((await originalSync).status, 'cleared');
  assert.equal((await reset).status, 'synced');
  assert.deepEqual((await getAllLocalReports()).map(item => item.id), [fresh.id]);
  assert.ok((await getRemovedCloudReportIds()).has(old.id));
  assert.ok(!methods.includes('PUT'));
});

test('offline clear stays empty and repeated clears retain protection against old hop copies', async () => {
  navigator.onLine = false;
  globalThis.fetch = async () => { throw new Error('Offline clear attempted a network request'); };
  assert.equal((await clearLocalDataAndRefresh()).status, 'offline');
  assert.deepEqual(await getAllLocalReports(), []);
  await clearLocalDataAndRefresh();
  assert.equal(await saveImportedReports([report('deleted-in-cloud')], { markForRelay: true }), 0);
  assert.deepEqual(await getAllLocalReports(), []);
});
