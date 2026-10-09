import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith('.json')) return { format: 'module', shortCircuit: true,
    source: `export default ${JSON.stringify(JSON.parse(readFileSync(new URL(url), 'utf8')))};` };
  return nextLoad(url, context);
} });
const values = new Map([['rescue.backendUrl', 'https://configured-backend.invalid']]);
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
globalThis.sessionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
const { api } = await import('../src/api.js');
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

test('production API cloud reads and writes never fall through to legacy direct cloud retrieval', async () => {
  for (const [path, method] of [['/api/sync/cloud-status', 'GET'], ['/api/sync/cloud-records?collection=rescue_public_events', 'GET'], ['/api/sync/cloud-mirror', 'POST'], ['/api/sync/mirror', 'POST']]) {
    const urls = [];
    globalThis.fetch = async url => { urls.push(url); return json(502, { detail: 'Actual Render cloud error' }); };
    await assert.rejects(api(path, { method, admin: true }), /Actual Render cloud error/);
    assert.deepEqual(urls, [`https://configured-backend.invalid${path}`]);
  }
});

test('an offline cloud check makes no network requests and reconnect reads the actual backend', async () => {
  navigator.onLine = false;
  globalThis.fetch = () => assert.fail('offline request');
  const status = await api('/api/sync/cloud-status', { admin: true });
  assert.equal(status.total_points, null); assert.equal(status.counts_verified, false);
  await assert.rejects(api('/api/sync/cloud-mirror', { method: 'POST', admin: true }), /Offline mode/);
  navigator.onLine = true;
  globalThis.fetch = async url => {
    assert.equal(url, 'https://configured-backend.invalid/api/sync/cloud-status');
    return json(200, { connected: true, counts_verified: true, total_points: 35 });
  };
  assert.equal((await api('/api/sync/cloud-status', { admin: true })).total_points, 35);
});
