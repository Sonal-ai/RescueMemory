import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresencePublisher, PRESENCE_TTL_MS, BEACON_PROTOCOL } from '../src/brain/cloudPresence.js';

function rig() {
  let clock = Date.now();
  const points = new Map(), requests = [], indexes = new Set();
  let fail, before;
  const matches = (point, filter) => (filter.must || []).every(c =>
    c.match ? point.payload[c.key] === c.match.value : point.payload[c.key] < c.range.lt) &&
    !(filter.must_not || []).some(c => c.has_id.includes(point.id));
  const request = async (url, options) => {
    const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
    requests.push({ url, body, method: options.method });
    assert.equal(new URL(url).searchParams.get('wait'), 'true');
    if (before) await before(url, body);
    if (fail?.(url, body)) return { ok: false, status: 403 };
    if (url.includes('/index?')) indexes.add(body.field_name);
    else if (url.includes('/points/delete?')) {
      for (const c of body.filter.must) if (c.key !== 'kind') assert.ok(indexes.has(c.key));
      for (const [id, point] of points) if (matches(point, body.filter)) points.delete(id);
    } else for (const point of body.points) points.set(point.id, structuredClone(point));
    return { ok: true, status: 200, json: async () => ({ status: 'ok', result: { status: 'completed' } }) };
  };
  const config = { request, url: 'https://cloud.invalid', key: 'test-only', collection: 'rescue_public_events',
    pointIdFor: async name => 'stable-' + name, vectorFor: () => [1], now: () => clock };
  return { points, requests, config, publisher: createPresencePublisher(config), now: () => clock,
    advance: ms => { clock += ms; }, fail: fn => { fail = fn; }, before: fn => { before = fn; } };
}
const ping = (r, deviceId = 'phone-a', lat = 0) => ({ deviceId, location: { lat, lon: 0, accuracy: 0, timestamp: r.now() }, battery: 0, unsyncedCount: 0 });

test('repeated production phone pings update one cloud point with real position, battery and lease', async () => {
  const r = rig();
  for (let i = 0; i < 8; i++) { await r.publisher.publish(ping(r, 'phone-a', i / 10)); r.advance(10000); }
  assert.equal(r.points.size, 1);
  const point = [...r.points.values()][0];
  assert.equal(point.payload.location.lat, 0.7); assert.equal(point.payload.location.lon, 0);
  assert.equal(point.payload.battery, 0); assert.equal(point.payload.unsynced_count, 0);
  assert.equal(point.payload.location.accuracy, 0);
  assert.equal(Date.parse(point.payload.expires_at) - point.payload.last_seen, PRESENCE_TTL_MS);
  assert.equal(r.requests.filter(x => x.url.includes('/index?')).length, 3);
  assert.equal(r.requests.filter(x => x.body.filter?.must.some(c => c.key === 'last_seen')).length, 1);
});

test('cleanup removes only expired beacons and alternate IDs for this phone, preserving SOS and active other phones', async () => {
  const r = rig(), expired = r.now() - PRESENCE_TTL_MS - 1;
  r.points.set('legacy-self', { id: 'legacy-self', payload: { kind: 'peer_beacon', node_id: 'phone-a', last_seen: r.now(), beacon_protocol: BEACON_PROTOCOL } });
  r.points.set('old-phone', { id: 'old-phone', payload: { kind: 'peer_beacon', node_id: 'retired-identity', last_seen: expired, beacon_protocol: BEACON_PROTOCOL } });
  r.points.set('other-phone', { id: 'other-phone', payload: { kind: 'peer_beacon', node_id: 'phone-b', last_seen: r.now(), beacon_protocol: BEACON_PROTOCOL } });
  r.points.set('sos', { id: 'sos', payload: { kind: 'sos', node_id: 'phone-a', last_seen: expired } });
  await r.publisher.publish(ping(r));
  assert.deepEqual([...r.points.keys()].sort(), ['other-phone', 'sos', 'stable-beacon_phone-a']);
  r.advance(PRESENCE_TTL_MS + 1); await r.publisher.publish(ping(r));
  assert.deepEqual([...r.points.keys()].sort(), ['sos', 'stable-beacon_phone-a']);
});

test('in-flight pings serialize per phone and an older GPS reading cannot overwrite the latest fix', async () => {
  const r = rig(); let release, entered;
  const blocked = new Promise(resolve => { entered = resolve; });
  r.before(async (url, body) => { if (body.points?.[0].payload.location.lat === 0) { entered(); await new Promise(resolve => { release = resolve; }); } });
  const first = r.publisher.publish(ping(r)); await blocked;
  r.advance(5000); const latest = ping(r, 'phone-a', 1);
  const second = r.publisher.publish(latest); release(); await Promise.all([first, second]);
  assert.equal([...r.points.values()][0].payload.location.lat, 1);
  const old = await r.publisher.publish({ ...latest, location: { ...latest.location, timestamp: latest.location.timestamp - 1, lat: 2 } });
  assert.equal(old.reason, 'older_location'); assert.equal([...r.points.values()][0].payload.location.lat, 1);
});

test('failed cloud write is explicit, performs no cleanup, and a later ping retries the same point', async () => {
  const r = rig(); r.fail(url => url.includes('/points?'));
  await assert.rejects(r.publisher.publish(ping(r)), /cloud.presence\/UPSERT.*HTTP 403/);
  assert.equal(r.points.size, 0); assert.equal(r.requests.length, 1);
  r.fail(() => false); await r.publisher.publish(ping(r)); assert.equal(r.points.size, 1);
});

test('cleanup failures are reported and retried without losing the confirmed current beacon', async () => {
  const r = rig(); r.fail(url => url.includes('/index?'));
  const result = await r.publisher.publish(ping(r));
  assert.equal(result.updated, true); assert.match(result.cleanup_error, /INDEX_IDENTITY.*HTTP 403/);
  assert.equal(r.points.size, 1);
  r.fail(() => false); const retry = await r.publisher.publish(ping(r));
  assert.equal(retry.cleanup_error, undefined); assert.equal(r.points.size, 1);
});

test('identity or coordinates missing never publish a fabricated beacon; unknown telemetry stays unknown', async () => {
  const r = rig();
  await assert.rejects(r.publisher.publish({ location: { lat: 0, lon: 0 } }), /IDENTITY/);
  for (const location of [undefined, { lat: 0 }, { lat: 1, lon: 1, isFallback: true }, { lat: 1, lon: 1, isCached: true }])
    await assert.rejects(r.publisher.publish({ deviceId: 'phone-a', location }), /LOCATION/);
  assert.equal(r.requests.length, 0);
  await r.publisher.publish({ deviceId: 'phone-a', location: { lat: 0, lon: 0 } });
  const payload = [...r.points.values()][0].payload;
  assert.equal('battery' in payload, false); assert.equal('unsynced_count' in payload, false);
  assert.equal('timestamp' in payload.location, false);
});

test('the actual cloudSync API uses the stable lease publisher across repeated pings', async () => {
  const r = rig(), originalFetch = globalThis.fetch;
  globalThis.fetch = r.config.request;
  try {
    const { publishPresenceBeacon, strToUuid } = await import('../src/brain/cloudSync.js');
    for (let i = 0; i < 3; i++) assert.equal(await publishPresenceBeacon(ping(r, 'integration-phone', i)), true);
    assert.equal(r.points.size, 1);
    const point = [...r.points.values()][0];
    assert.equal(point.id, await strToUuid('beacon_integration-phone'));
    assert.equal(point.payload.location.lat, 2);
    assert.ok(point.payload.expires_at);
  } finally { globalThis.fetch = originalFetch; }
});

test('unmanaged existing cloud beacons remain until legacy cleanup is explicitly requested', async () => {
  const r = rig();
  r.points.set('existing', { id: 'existing', payload: { kind: 'peer_beacon', node_id: 'old-install', last_seen: r.now() - PRESENCE_TTL_MS - 1 } });
  r.points.set('historic-sos', { id: 'historic-sos', payload: { kind: 'sos', last_seen: r.now() - PRESENCE_TTL_MS - 1 } });
  await r.publisher.publish(ping(r));
  assert.equal(r.points.has('existing'), true);
  await r.publisher.pruneInactive({ includeLegacy: true });
  assert.equal(r.points.has('existing'), false); assert.equal(r.points.has('historic-sos'), true);
});
