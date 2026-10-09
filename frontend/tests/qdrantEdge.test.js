import test from 'node:test';
import assert from 'node:assert/strict';
import { createEdgeClient, preferNativeRetrieval } from '../src/brain/qdrantEdge.js';
import { formatGuidanceCards } from '../src/brain/guidanceFormat.js';

const status = () => ({ engine: 'qdrant-edge', engine_version: '0.8.0', retrieval: 'bm25',
  ready: true, on_device: true, bundled_cards: 420, indexed_cards: 420, pack_version: 'test-pack' });
const guide = (id, version = 1) => ({ id, version, title: `Guide ${id}`, summary: 'Source-linked emergency guidance', source: 'Reference handbook' });

test('Android guidance and health choose the native route even with cached/online responses; browser and report routes remain distinct', () => {
  for (const path of ['/api/chat', '/api/assess', '/health', '/api/sync/status']) assert.equal(preferNativeRetrieval(path, true), true);
  assert.equal(preferNativeRetrieval('/api/chat', false), false);
  assert.equal(preferNativeRetrieval('/api/reports', true), false);
});
test('concurrent searches initialize once and query native BM25 after guide reconciliation', async () => {
  const calls = [];
  const client = createEdgeClient({
    async initialize() { calls.push('init'); return status(); },
    async upsertGuides({ guides }) { calls.push(`upsert:${guides.length}`); return status(); },
    async searchGuidance({ query }) { calls.push(`search:${query}`); return { ...status(), cards: [{ ...guide('bleeding'), score: 2.5 }] }; },
  }, () => true);
  const responses = await Promise.all([client.search('bleeding', 3, [guide('new')]), client.search('burns', 3, [guide('new')])]);
  assert.equal(calls.filter(call => call === 'init').length, 1);
  assert.equal(calls.filter(call => call.startsWith('upsert')).length, 1);
  assert.ok(calls.indexOf('upsert:1') < calls.indexOf('search:bleeding'));
  assert.equal(responses[0].mode, 'native_qdrant_edge'); assert.equal(responses[0].cards[0].score, 2.5);
});
test('failed native initialization is visible and retry initializes again without claiming a JS fallback is Edge', async () => {
  let attempts = 0;
  const client = createEdgeClient({ async initialize() { if (++attempts === 1) throw new Error('shard load failed'); return status(); } }, () => true);
  await assert.rejects(client.initialize(), /shard load failed/);
  assert.equal((await client.initialize()).engine, 'qdrant-edge'); assert.equal(attempts, 2);
  await assert.rejects(createEdgeClient({}, () => false).initialize(), /Android APK/);
});
test('guide indexing batches, retries failed flushes and indexes subsequent revisions', async () => {
  let fail = true; const batches = [];
  const client = createEdgeClient({
    async initialize() { return status(); },
    async upsertGuides({ guides }) { batches.push(guides); if (fail && batches.length === 2) throw new Error('disk full'); return status(); },
  }, () => true);
  const guides = Array.from({ length: 65 }, (_, i) => guide(`g${i}`));
  await assert.rejects(client.syncGuides(guides), /disk full/); fail = false;
  await client.syncGuides(guides); assert.deepEqual(batches.map(batch => batch.length), [64, 1, 64, 1]);
  await client.syncGuides(guides); assert.equal(batches.length, 4);
  await client.syncGuides([guide('g0', 2)]); assert.equal(batches.at(-1)[0].version, 2);
});
test('native metadata must confirm a real ready shard; empty results do not invent citations', async () => {
  await assert.rejects(createEdgeClient({ async initialize() { return { ...status(), indexed_cards: 0 }; } }, () => true).initialize(), /did not confirm/);
  const client = createEdgeClient({ async initialize() { return status(); },
    async searchGuidance() { return { ...status(), cards: [] }; } }, () => true);
  const empty = formatGuidanceCards((await client.search('unrelated phrase')).cards, status());
  assert.deepEqual(empty.source_cards, []); assert.match(empty.text, /No Matching/);
  const cited = formatGuidanceCards([{ ...guide('bleeding'), score: 1.2, instructions: ['Apply the cited protocol.', 'Apply the cited protocol.'] }], status());
  assert.equal(cited.source_cards[0].steps.length, 1); assert.match(cited.text, /Reference handbook/);
});
