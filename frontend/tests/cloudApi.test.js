import test from 'node:test';
import assert from 'node:assert/strict';
import { isCloudApi, offlineCloudResult, requestCloudApi } from '../src/brain/cloudApi.js';

const base = 'https://configured-backend.invalid';
const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

test('cloud reads use backend authentication and return its verified inventory', async () => {
  for (const path of ['/api/sync/cloud-status', '/api/sync/cloud-records?collection=rescue_public_events', '/api/sync/cloud-mirror', '/api/sync/mirror']) assert.equal(isCloudApi(path), true);
  assert.equal(isCloudApi('/api/chat'), false);
  const actual = { connected: true, configured: true, counts_verified: true, total_points: 35 };
  let calls = 0;
  const result = await requestCloudApi(async (url, options) => {
    calls++;
    assert.equal(url, `${base}/api/sync/cloud-status`);
    assert.equal(options.headers['X-Node-Admin-Key'], 'test-admin');
    assert.equal(options.headers['api-key'], undefined);
    return reply(200, actual);
  }, `${base}/api/sync/cloud-status`, '/api/sync/cloud-status', { headers: { 'X-Node-Admin-Key': 'test-admin' } });
  assert.deepEqual(result, actual); assert.equal(calls, 1);
});

test('slow cloud reads survive the former six-second deadline and eventually time out', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const pending = requestCloudApi((_url, options) => new Promise((_resolve, reject) => {
    signal = options.signal;
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  }), `${base}/api/sync/cloud-status`, '/api/sync/cloud-status', {});
  const rejected = assert.rejects(pending, /took too long/);
  t.mock.timers.tick(6000); assert.equal(signal.aborted, false);
  t.mock.timers.tick(54000); assert.equal(signal.aborted, true);
  await rejected;
});

test('failed mirror is sent once, preserves server errors and never retries another cluster', async () => {
  for (const status of [401, 403, 404, 502, 503]) {
    let calls = 0;
    await assert.rejects(requestCloudApi(async (_url, options) => {
      calls++; assert.equal(options.method, 'POST');
      return reply(status, { detail: 'Configured cloud unavailable' });
    }, `${base}/api/sync/cloud-mirror`, '/api/sync/cloud-mirror', { method: 'POST' }), error => error.status === status && error.message === 'Configured cloud unavailable');
    assert.equal(calls, 1);
  }
  await assert.rejects(requestCloudApi(async () => { throw new Error('Network unavailable'); }, base, '/api/sync/cloud-status', {}), /Network unavailable/);
});

test('mirror timeout explains uncertain server completion rather than reporting false failure or success', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const pending = requestCloudApi((_url, options) => new Promise((_resolve, reject) => {
    signal = options.signal;
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  }), base, '/api/sync/cloud-mirror', { method: 'POST' });
  const rejected = assert.rejects(pending, /may still be running/);
  t.mock.timers.tick(60000); assert.equal(signal.aborted, false);
  t.mock.timers.tick(60000); await rejected;
});

test('offline cloud state is unknown and records/mirror explicitly require reconnection', () => {
  const result = offlineCloudResult('/api/sync/cloud-status');
  assert.equal(result.connected, false); assert.equal(result.configured, null);
  assert.equal(result.counts_verified, false); assert.equal(result.total_points, null);
  assert.match(result.reason, /Enable Online and refresh/);
  assert.throws(() => offlineCloudResult('/api/sync/cloud-records?collection=rescue_public_events'), /Offline mode/);
  assert.throws(() => offlineCloudResult('/api/sync/cloud-mirror'), /Offline mode/);
});
