import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { pullReportSnapshotFromCloud } from '../src/brain/cloudSync.js';
import { saveOfflineReport, saveImportedReports, getAllLocalReports, getUnsyncedReports,
  markReportsSynced, saveImportedGuides, getAllLocalGuides, commitMeshReports,
  saveTransferSession, getMeshHistory, clearLocalMeshData, getLocalDataRevision,
  reconcileCloudReports, getRemovedCloudReportIds } from '../src/brain/offlineStorage.js';
import { reportRadar } from '../src/brain/reportRadar.js';

globalThis.window = new EventTarget();
globalThis.localStorage = { getItem: () => 'this-phone' };
const report = (id, kind = 'checkpoint', visibility = 'public') => ({
  id, source_report_id: id, kind, reporter_id: 'origin-phone', origin_device: 'origin-phone',
  entity_id: id, text: `Actual entered report ${id}`, visibility,
  status: kind === 'checkpoint' ? 'operational' : 'needs_help', severity: 'green',
  location: { lat: 0, lon: 0.001 }, observed_at: new Date().toISOString(),
});
const response = result => ({ ok: true, status: 200, json: async () => ({ result }) });

test('clear removes reports, pending outbox and history, preserves guides, and rejects old replies', async () => {
  await saveImportedGuides([{ id: 'guide-kept', title: 'Locally saved guidance' }]);
  const alert = await saveOfflineReport(report('clear-unsent', 'sos', 'responders'));
  await commitMeshReports([report('clear-hop')], { sessionId: 'exchange-old', peerId: 'nearby-phone' });
  const revision = getLocalDataRevision();
  await saveTransferSession({ id: 'exchange-old', report_revision: revision, updated_at: new Date().toISOString() });
  const events = [];
  const changed = () => events.push('reports'), history = () => events.push('history');
  window.addEventListener('rescue:reports-changed', changed);
  window.addEventListener('rescue:transfers-changed', history);
  await clearLocalMeshData();
  window.removeEventListener('rescue:reports-changed', changed);
  window.removeEventListener('rescue:transfers-changed', history);
  assert.deepEqual(await getAllLocalReports(), []);
  assert.deepEqual(await getUnsyncedReports(), []);
  assert.deepEqual(await getMeshHistory(), { transfers: [], receipts: [] });
  assert.equal((await getAllLocalGuides())[0].id, 'guide-kept');
  assert.equal(localStorage.getItem('rescue.device_id'), 'this-phone');
  assert.deepEqual(events, ['reports', 'history']);
  await assert.rejects(saveImportedReports([alert], { expectedRevision: revision }), /LOCAL_DATA_CLEARED/);
  await assert.rejects(commitMeshReports([alert], { sessionId: 'old', peerId: 'old', expectedRevision: revision }), /LOCAL_DATA_CLEARED/);
  await saveTransferSession({ id: 'old', report_revision: revision });
  assert.deepEqual((await getMeshHistory()).transfers, []);
  assert.equal(await saveImportedReports([alert], { markForRelay: true }), 0);
  assert.ok((await getRemovedCloudReportIds()).has(alert.id));
});

test('clear then real cloud download and a new offline hop both appear in radar', async () => {
  const cloud = report('cloud-shelter'), hop = report('new-hop', 'sos', 'responders');
  await saveImportedReports([cloud]);
  await clearLocalMeshData();
  await reconcileCloudReports({ reports: [cloud], completeScopes: ['public', 'responders'] });
  assert.equal(await saveImportedReports([cloud]), 1);
  const result = await commitMeshReports([hop], { sessionId: 'new-exchange', peerId: 'nearby-phone' });
  assert.equal(result.received, 1);
  const radar = reportRadar(await getAllLocalReports(), { lat: 0, lon: 0, include_responders: true });
  assert.deepEqual(radar.radar_items.map(item => item.id).sort(), [cloud.id, hop.id].sort());
  assert.equal((await getUnsyncedReports())[0].id, hop.id);
});

test('complete cloud snapshot removes deleted confirmed reports but preserves unuploaded hops and failed scopes', async () => {
  await clearLocalMeshData();
  const deleted = report('cloud-deleted'), pending = report('unuploaded-hop', 'sos', 'responders');
  const failed = report('unread-scope', 'sos', 'responders');
  await saveImportedReports([deleted, failed]);
  await commitMeshReports([pending], { sessionId: 'offline-hop', peerId: 'nearby-phone' });
  assert.equal(await reconcileCloudReports({ reports: [], completeScopes: ['public'] }), 1);
  const remaining = await getAllLocalReports();
  assert.deepEqual(remaining.map(r => r.id).sort(), [pending.id, failed.id].sort());
  assert.equal(await saveImportedReports([deleted], { markForRelay: true }), 0);
  const duplicate = await commitMeshReports([deleted], { sessionId: 'stale-hop', peerId: 'old-phone' });
  assert.equal(duplicate.received, 0);
  assert.ok(!(await getAllLocalReports()).some(r => r.id === deleted.id));
  assert.equal(await reconcileCloudReports({ reports: [], completeScopes: [] }), 0);
  assert.equal((await getUnsyncedReports())[0].id, pending.id);
});

test('full paginated inventory updates moved coordinates; incomplete or malformed scope cannot establish deletion', async () => {
  await clearLocalMeshData();
  const shelter = report('moving-shelter');
  await saveImportedReports([shelter]);
  const moved = { ...shelter, location: { lat: 0.001, lon: 0 }, observed_at: new Date(Date.now() + 1000).toISOString() };
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.includes('rescue_responder_events')) return { ok: false, status: 503 };
    return response(body.offset ? { points: [{ payload: moved }], next_page_offset: null }
      : { points: [], next_page_offset: 'second-page' });
  };
  const snapshot = await pullReportSnapshotFromCloud(1, { includeResponders: true });
  assert.deepEqual(snapshot.completeScopes, ['public']);
  assert.match(snapshot.errors[0], /503/);
  await reconcileCloudReports(snapshot); await saveImportedReports(snapshot.reports);
  const [marker] = reportRadar(await getAllLocalReports(), { lat: 0, lon: 0 }).radar_items;
  assert.deepEqual(marker.location, moved.location);
  assert.equal(marker.cardinal, 'N');
  globalThis.fetch = async () => response({ next_page_offset: null });
  const malformed = await pullReportSnapshotFromCloud();
  assert.deepEqual(malformed.completeScopes, []);
  assert.equal(await reconcileCloudReports(malformed), 0);
  assert.equal((await getAllLocalReports())[0].id, shelter.id);
  await markReportsSynced([shelter.id]);
});
