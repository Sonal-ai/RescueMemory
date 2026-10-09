import test from 'node:test';
import assert from 'node:assert/strict';
import { gpsPosition, gpsStatusText, createLocationTracker, hardwareLocationWatch, GPS_FRESH_MS } from '../src/brain/locationTracking.js';

const sample = (lat, lon, timestamp) => ({ coords: { latitude: lat, longitude: lon, accuracy: 0, speed: 0, heading: 0 }, timestamp });
const tick = () => new Promise(resolve => setImmediate(resolve));

function rig() {
  let time = Date.now(), expiry;
  const streams = [], states = [], published = [], cleared = [];
  const tracker = createLocationTracker({ now: () => time, onChange: state => states.push(state), onFix: fix => published.push(fix),
    watch: async (receive, error) => { const id = streams.length; streams.push({ receive, error }); return () => cleared.push(id); },
    getCurrent: async () => gpsPosition(sample(0, 0, time), 'web_gps', time),
    schedule: fn => { expiry = fn; return 1; }, cancel: () => {},
  });
  return { tracker, streams, states, published, cleared, now: () => time, advance: ms => { time += ms; }, expire: () => expiry() };
}

test('fresh coordinates stream beyond 30 km and update displayed position plus publication without remounting', async () => {
  const r = rig(); await r.tracker.start();
  r.streams[0].receive(gpsPosition(sample(28.53106, 77.23043, r.now()), 'native_gps', r.now()));
  const first = gpsStatusText(r.tracker.getState(), r.now());
  r.advance(5000);
  r.streams[0].receive(gpsPosition(sample(28.93106, 77.23043, r.now()), 'native_gps', r.now()));
  await tick();
  assert.match(first, /28.53106, 77.23043/);
  assert.match(gpsStatusText(r.tracker.getState(), r.now()), /28.93106, 77.23043/);
  assert.equal(r.tracker.getState().status, 'live');
  assert.equal(r.streams.length, 1); assert.equal(r.published.length, 2);
  assert.equal(r.published[1].lat, 28.93106); assert.equal(r.published[1].timestamp, r.now());
  await r.tracker.stop();
});

test('stale, cached, fallback and out-of-order fixes cannot replace the latest GPS position', async () => {
  const r = rig(); await r.tracker.start();
  const current = gpsPosition(sample(0, 0, r.now()), 'native_gps', r.now());
  r.streams[0].receive(current);
  r.streams[0].receive({ ...current, lat: 30, timestamp: current.timestamp - 1000 });
  r.streams[0].receive({ ...current, lat: 31, isCached: true });
  r.streams[0].receive({ ...current, lat: 32, isFallback: true });
  assert.deepEqual(r.tracker.getState().fix, current);
  r.advance(GPS_FRESH_MS + 1); r.expire();
  assert.equal(r.tracker.getState().status, 'stale');
  assert.match(gpsStatusText(r.tracker.getState(), r.now()), /Last GPS fix.*waiting for a fresh fix/);
  assert.equal(r.tracker.getState().fix.lat, 0);
  await r.tracker.stop();
});

test('permission errors stay explicit and a later real fix restores live status', async () => {
  const r = rig(); await r.tracker.start();
  r.streams[0].error(new Error('[gps.watch/1] Location permission denied'));
  assert.match(gpsStatusText(r.tracker.getState(), r.now()), /permission denied/);
  assert.equal(r.tracker.getState().fix, null);
  r.streams[0].receive(gpsPosition(sample(0, 0, r.now()), 'web_gps', r.now()));
  assert.equal(r.tracker.getState().status, 'live');
  assert.equal(r.tracker.getState().error, null);
  await r.tracker.stop();
});

test('foreground restart clears the previous watch and old callbacks cannot change the resumed location', async () => {
  const r = rig(); await r.tracker.start(); await r.tracker.start();
  assert.deepEqual(r.cleared, [0]);
  r.streams[1].receive(gpsPosition(sample(0.5, 0, r.now()), 'web_gps', r.now()));
  r.streams[0].receive(gpsPosition(sample(0, 0, r.now()), 'web_gps', r.now()));
  assert.equal(r.tracker.getState().fix.lat, 0.5);
  await r.tracker.stop();
  const count = r.states.length;
  r.streams[1].receive(gpsPosition(sample(1, 0, r.now()), 'web_gps', r.now()));
  assert.equal(r.states.length, count); assert.deepEqual(r.cleared, [0, 1]);
});

test('a delayed native watch is released if the screen unmounts while setup is pending', async () => {
  let ready, cleared = false;
  const tracker = createLocationTracker({ onChange: () => {}, getCurrent: async () => {},
    watch: () => new Promise(resolve => { ready = resolve; }), schedule: () => 1, cancel: () => {} });
  const startup = tracker.start(); await tick(); await tracker.stop();
  ready(() => { cleared = true; }); await startup;
  assert.equal(cleared, true);
});

test('native GPS adapter requests fresh fixes, preserves real timestamps and zeros, and clears its watch', async () => {
  let receive, options, cleared;
  const time = Date.now(), fixes = [], errors = [];
  const Geolocation = { checkPermissions: async () => ({ location: 'granted' }),
    watchPosition: async (opts, callback) => { options = opts; receive = callback; return 'native-watch'; },
    clearWatch: async value => { cleared = value.id; } };
  const stop = await hardwareLocationWatch(fix => fixes.push(fix), error => errors.push(error), {
    nativeAvailable: () => true, loadNative: async () => ({ Geolocation }), now: () => time,
  });
  receive(sample(0, 0, time - 500));
  assert.equal(options.maximumAge, 0); assert.equal(options.interval, 5000);
  assert.equal(fixes[0].timestamp, time - 500); assert.equal(fixes[0].accuracy, 0);
  assert.equal(fixes[0].heading, 0); assert.equal(fixes[0].speed, 0);
  receive(sample(1, 1, time - GPS_FRESH_MS - 1));
  assert.equal(fixes.length, 1); assert.match(errors[0].message, /STALE_FIX/);
  await stop(); assert.equal(cleared, 'native-watch');
});

test('browser GPS adapter follows movement and reports unavailable hardware without a fabricated fix', async () => {
  let receive, cleared;
  const fixes = [], errors = [], time = Date.now();
  const stop = await hardwareLocationWatch(fix => fixes.push(fix), error => errors.push(error), {
    nativeAvailable: () => false, now: () => time,
    geolocation: { watchPosition: (callback, fail, options) => { receive = callback; assert.equal(options.maximumAge, 0); return 3; }, clearWatch: id => { cleared = id; } },
  });
  receive(sample(0, 0, time)); receive(sample(0.5, 0, time));
  assert.deepEqual(fixes.map(fix => fix.lat), [0, 0.5]);
  stop(); assert.equal(cleared, 3);
  await hardwareLocationWatch(fix => fixes.push(fix), error => errors.push(error), { nativeAvailable: () => false });
  assert.equal(fixes.length, 2); assert.match(errors[0].message, /unavailable/);
});
