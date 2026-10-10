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
const values = new Map();
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };
let watch, options, cleared, snapshot;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false, geolocation: {
  watchPosition: (receive, error, opts) => { watch = receive; options = opts; return 1; }, clearWatch: id => { cleared = id; },
  getCurrentPosition: (receive, error, opts) => { assert.equal(opts.maximumAge, 0); receive(snapshot); },
} } });
const { getNativeOrWebLocation, watchNativeOrWebLocation, updateDeviceLocation } = await import('../src/api.js');
const sample = (lat, timestamp) => ({ coords: { latitude: lat, longitude: 0, accuracy: 0, heading: 0, speed: 0 }, timestamp });

test('production GPS watch updates coordinates and preserves measurement time in the cache', async () => {
  const received = [], errors = [], time = Date.now() - 500;
  const stop = await watchNativeOrWebLocation(fix => received.push(fix), error => errors.push(error));
  watch(sample(0, time)); watch(sample(0.5, time + 100));
  assert.deepEqual(received.map(fix => fix.lat), [0, 0.5]);
  assert.equal(options.maximumAge, 0);
  const stored = JSON.parse(localStorage.getItem('rescue.lastLocation'));
  assert.equal(stored.lat, 0.5); assert.equal(stored.timestamp, time + 100);
  assert.equal(stored.updatedAt, time + 100); assert.equal(stored.accuracy, 0);
  watch(sample(1, time - 120000));
  assert.equal(received.length, 2); assert.match(errors[0].message, /STALE_FIX/);
  assert.equal(JSON.parse(localStorage.getItem('rescue.lastLocation')).lat, 0.5);
  stop(); assert.equal(cleared, 1);
});

test('manual GPS refresh uses a new measured position and cannot return stale GPS as live', async () => {
  snapshot = sample(0.8, Date.now() - 300);
  const current = await getNativeOrWebLocation({ allowCached: false, allowFallback: false });
  assert.equal(current.lat, 0.8); assert.equal(current.timestamp, snapshot.timestamp);
  snapshot = sample(1, Date.now() - 120000);
  await assert.rejects(getNativeOrWebLocation({ allowCached: false, allowFallback: false }), /GPS unavailable/);
  assert.equal(JSON.parse(localStorage.getItem('rescue.lastLocation')).lat, 0.8);
});

test('unavailable GPS never caches an invented anchor or publishes missing coordinates', async () => {
  values.delete('rescue.lastLocation');
  snapshot = sample(1, Date.now() - 120000);
  await assert.rejects(getNativeOrWebLocation({ allowCached: false }), /GPS unavailable/);
  await assert.rejects(getNativeOrWebLocation({ allowCached: false, allowFallback: true }), /GPS unavailable/);
  assert.equal(localStorage.getItem('rescue.lastLocation'), null);
  await assert.rejects(updateDeviceLocation(null), /real coordinates/);
  await assert.rejects(updateDeviceLocation({ isFallback: true }), /real coordinates/);
});
