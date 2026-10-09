import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

const calls = [];
const status = { engine: 'qdrant-edge', engine_version: '0.8.0', retrieval: 'bm25', ready: true,
  on_device: true, bundled_cards: 420, indexed_cards: 420, pack_version: 'integration-pack' };
let hits = [{ id: 'water', title: 'Clean water reference', score: 3, source: 'Reference source', instructions: ['Use the source instructions.'] }];
let failSearch = false;
globalThis.edgeTestPlugin = {
  async initialize() { calls.push('initialize'); return status; },
  async getStatus() { return status; },
  async upsertGuides({ guides }) { calls.push(['upsert', guides]); return status; },
  async searchGuidance({ query }) { calls.push(['search', query]); if (failSearch) throw new Error('native shard unavailable'); return { ...status, cards: hits }; },
};
// Exercise the production API routing with a controlled native bridge transport.
registerHooks({ load(url, context, nextLoad) {
  if (/\/@capacitor\/core\/dist\/index(?:\.cjs)?\.js$/.test(url)) return { format: 'module', shortCircuit: true,
    source: `export const Capacitor = { getPlatform: () => 'android', isNativePlatform: () => true }; export const registerPlugin = name => name === 'QdrantEdge' ? globalThis.edgeTestPlugin : {};` };
  if (url.endsWith('.json')) return { format: 'module', shortCircuit: true,
    source: `export default ${JSON.stringify(JSON.parse(readFileSync(new URL(url), 'utf8')))};` };
  return nextLoad(url, context);
} });
const values = new Map();
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error('Network must not serve Android guidance'); };
const { api } = await import('../src/api.js');
const { saveImportedGuides } = await import('../src/brain/offlineStorage.js');
globalThis.window = new EventTarget();
window.location = { hostname: 'localhost', protocol: 'https:', origin: 'https://localhost' };
globalThis.CustomEvent ||= class extends Event { constructor(type, options) { super(type); this.detail = options?.detail; } };

test('online Android chat uses native retrieval and its citations without network or fabricated destinations', async () => {
  const result = await api('/api/chat', { method: 'POST', body: { text: 'I need clean water' } });
  assert.equal(result.engine, 'qdrant-edge'); assert.equal(result.mode, 'native_qdrant_edge');
  assert.equal(result.cards[0].id, 'water'); assert.equal(result.answer.nav_target, undefined);
  assert.equal(networkCalls, 0);
});
test('actual stored guide revisions reach the native index before the next search; health reports actual shard counts', async () => {
  await saveImportedGuides([{ id: 'updated-guide', version: 2, title: 'Updated reference', instructions: ['Updated step'] }]);
  const before = calls.length;
  await api('/api/chat', { method: 'POST', body: { text: 'updated reference' } });
  const recent = calls.slice(before);
  assert.equal(recent[0][0], 'upsert'); assert.equal(recent[0][1][0].version, 2);
  assert.equal(recent[1][0], 'search');
  const health = await api('/health');
  assert.equal(health.indexed_cards, 420); assert.equal(health.on_device, true); assert.equal(health.local_fallback, false);
  assert.equal(networkCalls, 0);
});
test('empty native results stay empty; a native failure is surfaced without keyword or network fallback', async () => {
  hits = [];
  const result = await api('/api/chat', { method: 'POST', body: { text: 'zxqvunknownword' } });
  assert.deepEqual(result.cards, []); assert.match(result.text, /No Matching/);
  failSearch = true;
  await assert.rejects(api('/api/chat', { method: 'POST', body: { text: 'bleeding' } }), /native shard unavailable/);
  assert.equal(networkCalls, 0);
});
