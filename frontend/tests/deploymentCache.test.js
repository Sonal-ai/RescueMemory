import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildWorker } from '../scripts/pwa-build.mjs';
import { installChunkRecovery, reloadLatestApplication } from '../src/chunkRecovery.js';

const template = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const worker = buildWorker(template, '<script src="/assets/new.js"></script>', ['assets/new.js', 'assets/Landing.js', 'assets/main.css']);
const cacheName = worker.match(/const CACHE_NAME = '([^']+)'/)[1];
const manifest = JSON.parse(worker.match(/const PRECACHE_ASSETS = (\[[^;]+\]);/)[1]);

function harness() {
  const stores = new Map();
  const handlers = {};
  const calls = [];
  const key = value => new URL(typeof value === 'string' ? value : value.url, 'https://app.test').href;
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
    open: async name => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        match: async request => store.get(key(request))?.clone(),
        put: async (request, response) => store.set(key(request), response.clone()),
        addAll: async requests => { for (const request of requests) store.set(key(request), new Response(request)); },
      };
    },
  };
  let network = async () => new Response('new html', { headers: { 'Content-Type': 'text/html' } });
  vm.runInNewContext(worker, {
    URL, Response, caches,
    Request: class extends Request { constructor(request, options) { super(request.url, options); } },
    fetch: request => { calls.push(request); return network(request); },
    self: { location: { origin: 'https://app.test' }, addEventListener: (name, handler) => { handlers[name] = handler; },
      skipWaiting: async () => calls.push('skip'), clients: { claim: async () => calls.push('claim') } },
  });
  return { caches, stores, calls, setNetwork: fn => { network = fn; },
    lifecycle: name => { let pending; handlers[name]({ waitUntil: promise => { pending = promise; } }); return pending; },
    fetch: (path, mode = 'cors', method = 'GET') => {
      let pending;
      handlers.fetch({ request: { url: `https://app.test${path}`, mode, method }, respondWith: promise => { pending = promise; } });
      return pending;
    },
  };
}

test('each build versions its cache and precaches every lazy module and offline knowledge', () => {
  assert.equal(worker, buildWorker(template, '<script src="/assets/new.js"></script>', ['assets/new.js', 'assets/Landing.js', 'assets/main.css']));
  assert.notEqual(worker, buildWorker(template, 'another entry', ['assets/new.js']));
  for (const path of ['/assets/new.js', '/assets/Landing.js', '/assets/main.css', '/data/knowledge_cards.json', '/data/knowledge_vectors.json']) {
    assert.ok(manifest.includes(path));
  }
});

test('install fills offline routes before activation and preserves only one older app cache', async () => {
  const h = harness();
  await h.caches.open('unrelated-map-cache');
  await h.caches.open('rescue-memory-pwa-ancient');
  await h.caches.open('rescue-memory-pwa-previous');
  await h.lifecycle('install');
  assert.equal(h.stores.get(cacheName).size, manifest.length);
  assert.deepEqual(h.calls, ['skip']);
  await h.lifecycle('activate');
  assert.deepEqual(await h.caches.keys(), ['unrelated-map-cache', 'rescue-memory-pwa-previous', cacheName]);
  assert.equal(await (await h.fetch('/assets/Landing.js')).text(), '/assets/Landing.js');
});

test('navigation refreshes the offline shell; older tabs can still load cached old chunks', async () => {
  const h = harness();
  await (await h.caches.open('rescue-memory-pwa-previous')).put('/assets/old.js', new Response('old module'));
  assert.equal(await (await h.fetch('/command', 'navigate')).text(), 'new html');
  assert.equal(h.calls[0].cache, 'no-cache');
  h.setNetwork(async () => { throw new Error('offline'); });
  assert.equal(await (await h.fetch('/chat', 'navigate')).text(), 'new html');
  assert.equal(await (await h.fetch('/assets/old.js')).text(), 'old module');
  const api = await h.fetch('/api/report', 'cors', 'POST');
  assert.equal(api.status, 503);
  assert.equal(api.headers.get('X-Rescue-Offline'), 'true');
  assert.equal((await h.fetch('/health')).status, 503);
});

test('missing chunks remain errors and HTML cannot poison the JavaScript cache', async () => {
  const h = harness();
  h.setNetwork(async () => new Response('missing', { status: 404 }));
  assert.equal((await h.fetch('/assets/gone.js')).status, 404);
  h.setNetwork(async () => new Response('<html>fallback</html>', { headers: { 'Content-Type': 'text/html' } }));
  await h.fetch('/assets/gone.js');
  assert.equal(await (await h.caches.open(cacheName)).match('/assets/gone.js'), undefined);
  assert.equal(h.fetch('/sw.js'), undefined);
});

test('automatic recovery is once per entry, online only, browser only, and storage guarded', () => {
  const store = new Map();
  let listener, prevented = 0, reloads = 0, connected = true;
  const options = { target: { addEventListener: (_, fn) => { listener = fn; } },
    storage: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) },
    entry: 'old-entry.js', online: () => connected, reload: () => { reloads++; } };
  const event = { payload: new Error('Failed to fetch dynamically imported module: old.js'), preventDefault: () => { prevented++; } };
  installChunkRecovery(options);
  connected = false; listener(event); assert.equal(reloads, 0);
  connected = true; listener(event); listener(event); assert.equal(reloads, 1); assert.equal(prevented, 1);
  installChunkRecovery({ ...options, native: true, entry: 'native.js' }); listener(event); assert.equal(reloads, 1);
  installChunkRecovery({ ...options, storage: undefined, entry: 'unavailable.js' }); listener(event); assert.equal(reloads, 1);
  installChunkRecovery({ ...options, entry: 'new-entry.js' }); listener(event); assert.equal(reloads, 2);
  listener({ ...event, payload: new Error('unrelated render failure') }); assert.equal(reloads, 2);
});

test('manual recovery clears only app caches and its worker, preserving route and user storage', async () => {
  const deleted = [], unregistered = [], navigated = [];
  const location = { href: 'https://app.test/command?existing=1#/command', replace: value => navigated.push(value) };
  const caches = { keys: async () => ['rescue-memory-pwa-old', 'offline-map-tiles'], delete: async key => deleted.push(key) };
  const serviceWorker = { getRegistrations: async () => ['/sw.js', '/other-worker.js'].map(path => ({
    active: { scriptURL: `https://app.test${path}` }, unregister: async () => unregistered.push(path),
  })) };
  await reloadLatestApplication({ location, caches, serviceWorker, now: () => 42 });
  assert.deepEqual(deleted, ['rescue-memory-pwa-old']);
  assert.deepEqual(unregistered, ['/sw.js']);
  assert.equal(navigated[0], 'https://app.test/command?existing=1&rescue_refresh=42#/command');
  await reloadLatestApplication({ location, caches, serviceWorker, native: true, now: () => 43 });
  assert.equal(deleted.length, 1); assert.equal(unregistered.length, 1);
});
