import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOUD_COLLECTIONS, readCloudSnapshot, readCloudRecords, displayCloudCount, cloudMirrorSummary, localRecordProvenance } from '../src/brain/cloudInspector.js';
const options = { url: 'https://cloud.invalid', key: 'test-only-key' };
const response = result => ({ ok: true, status: 200, json: async () => ({ status: 'ok', result }) });

test('actual counts include all four app collections, preserve zero, and exclude unrelated vectors', async () => {
  const counts = [0, 2, 3, 5], requests = [];
  const request = async (url, args) => {
    requests.push([url, args]);
    if (url.endsWith('/collections')) return response({ collections: [...CLOUD_COLLECTIONS.map(c => ({ name: c.name })), { name: 'peer_beacons' }] });
    assert.equal(JSON.parse(args.body).exact, true);
    return response({ count: counts[CLOUD_COLLECTIONS.findIndex(c => url.includes(c.name))] });
  };
  const snapshot = await readCloudSnapshot(request, options);
  assert.equal(snapshot.total_points, 10); assert.equal(snapshot.counts_verified, true);
  assert.equal(snapshot.shards.rescue_public_events, 0); assert.equal(requests.length, 5);
  assert.equal(displayCloudCount(0), 0); assert.equal(displayCloudCount(null), 'Unavailable');
});
test('absent collections are confirmed empty; an offline cloud is unknown and makes no requests', async () => {
  const empty = await readCloudSnapshot(async () => response({ collections: [] }), options);
  assert.equal(empty.total_points, 0); assert.equal(empty.counts_verified, true);
  const offline = await readCloudSnapshot(() => assert.fail('offline network request'), { ...options, online: false });
  assert.equal(offline.connected, false); assert.equal(offline.total_points, null); assert.deepEqual(offline.shards, {});
});
test('failed or malformed counts remain unknown and cannot inflate a verified total', async () => {
  const request = async url => url.endsWith('/collections') ? response({ collections: CLOUD_COLLECTIONS.map(c => ({ name: c.name })) })
    : url.includes('rescue_group_events') ? { ok: false, status: 403 } : response({ count: 1 });
  const snapshot = await readCloudSnapshot(request, options);
  assert.equal(snapshot.connected, true); assert.equal(snapshot.counts_verified, false); assert.equal(snapshot.total_points, null);
  assert.equal(snapshot.shards.rescue_group_events, null); assert.match(snapshot.count_errors.rescue_group_events, /HTTP 403/);
  const malformed = await readCloudSnapshot(async url => url.endsWith('/collections') ? response({ collections: [{ name: CLOUD_COLLECTIONS[0].name }] }) : response({ count: -1 }), options);
  assert.equal(malformed.total_points, null);
});
test('cloud records use real payloads and preserve a zero cursor through pagination', async () => {
  let scrolls = 0;
  const request = async (url, args) => {
    if (url.endsWith('/collections')) return response({ collections: [{ name: CLOUD_COLLECTIONS[0].name }] });
    assert.equal(JSON.parse(args.body).with_vector, false);
    if (++scrolls === 1) return response({ points: [{ id: 'first-point', payload: { id: 'report', text: 'Actual report' } }], next_page_offset: 0 });
    assert.equal(JSON.parse(args.body).offset, 0);
    return response({ points: [{ id: 'second-point', payload: { text: 'Second report' } }], next_page_offset: null });
  };
  const first = await readCloudRecords(request, { ...options, collection: CLOUD_COLLECTIONS[0].name });
  assert.equal(first.items[0].payload.text, 'Actual report'); assert.equal(first.next_offset, 0);
  const second = await readCloudRecords(request, { ...options, collection: CLOUD_COLLECTIONS[0].name, offset: first.next_offset });
  assert.equal(second.items[0].point_id, 'second-point'); assert.equal(second.next_offset, null);
});
test('record permission failures are errors, not successful empty ledgers', async () => {
  await assert.rejects(readCloudRecords(async () => ({ ok: false, status: 403 }), { ...options, collection: CLOUD_COLLECTIONS[0].name }), /HTTP 403/);
  await assert.rejects(readCloudRecords(() => assert.fail('invalid collection request'), { ...options, collection: 'unrelated' }), /Invalid cloud collection/);
});
test('mirror notifications use actual changes and verified inventory without assuming 24', () => {
  assert.match(cloudMirrorSummary({ mirrored: true, counts_verified: true, total_points: 0, events_uploaded: {}, events_downloaded: {} }), /Cloud inventory: 0 records/);
  const summary = cloudMirrorSummary({ mirrored: true, events_uploaded: { public: 2 }, events_downloaded: { group: 1 } });
  assert.match(summary, /uploaded 2 · received 1/); assert.match(summary, /could not be verified/); assert.doesNotMatch(summary, /24|bidirectionally/);
  assert.throws(() => cloudMirrorSummary({ status: 'offline' }), /not? ?cloud mirror|confirmed/);
  assert.throws(() => cloudMirrorSummary({}), /not confirmed/);
  assert.match(cloudMirrorSummary({ mode: 'report_sync', status: 'synced', synced_events: 1, imported_events: 0 }), /Full collection mirroring requires the central API/);
});
test('provenance uses recorded transfers and never invents hops or cloud confirmation', () => {
  const record = { id: 'actual', origin_device: 'origin' };
  assert.deepEqual(localRecordProvenance(record, {}, 'this-phone').hops, []);
  const history = { receipts: [{ id: 'sent', report_id: 'actual', direction: 'sent', peer_id: 'peer', transport: 'bluetooth', at: 'timestamp' },
    { report_id: 'actual', direction: 'confirmed', peer_id: 'already-present' }, { report_id: 'other', direction: 'received', peer_id: 'irrelevant' }] };
  const result = localRecordProvenance(record, history, 'this-phone');
  assert.equal(result.hops.length, 1); assert.equal(result.hops[0].to_node, 'peer'); assert.equal(result.hops[0].from_node, 'this-phone');
  assert.throws(() => localRecordProvenance(null, history, 'this-phone'), /No local record/);
});
