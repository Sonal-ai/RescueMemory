import test from 'node:test';
import assert from 'node:assert/strict';
import { formatOnlineAnswer } from '../src/brain/onlineAnswer.js';
const local = { local_answer: 'Retrieved protocol unchanged', text: 'Retrieved protocol unchanged', engine: 'qdrant-edge',
  cards: [{ id: 'guide', title: 'Actual Qdrant hit', steps: ['Actual source step'], warnings: ['Source warning'] }],
  memory_hits: [{ text: 'Private SOS', visibility: 'responders', citation_label: 'R1' }, { text: 'Public water report', visibility: 'public', citation_label: 'R2' }] };

test('Gemini receives actual retrieved evidence, excludes private reports and retains original answer', async () => {
  let payload;
  const result = await formatOnlineAnswer(local, 'water?', { url: '/api/chat/format', events: new EventTarget(), online: () => true,
    request: async (_, options) => { payload = JSON.parse(options.body); return { ok: true, json: async () => ({ ai_answer: 'Formatted with evidence [G1]' }) }; } });
  assert.equal(payload.cards[0].title, 'Actual Qdrant hit'); assert.deepEqual(payload.cards[0].steps, ['Actual source step']);
  assert.equal(payload.reports.length, 1); assert.equal(result.ai_answer, 'Formatted with evidence [G1]');
  assert.equal(payload.reports[0].citation_label, 'R2');
  assert.equal(result.local_answer, local.local_answer); assert.equal(result.engine, 'qdrant-edge');
});
test('connection loss during formatting aborts and returns the previously retrieved answer', async () => {
  const events = new EventTarget(); let connected = true;
  const work = formatOnlineAnswer(local, 'water?', { url: '/api/chat/format', events, online: () => connected,
    request: (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  connected = false; events.dispatchEvent(new Event('offline'));
  const result = await work; assert.equal(result.ai_answer, null); assert.equal(result.local_answer, local.local_answer);
  assert.equal(result.ai_status, 'offline_mode');
});
test('offline, server error and timeout retain the local answer without fabricating a response', async () => {
  const base = { url: '/api/chat/format', events: new EventTarget(), online: () => true };
  const offline = await formatOnlineAnswer(local, 'water?', { ...base, online: () => false, request: () => assert.fail('offline network') });
  assert.equal(offline.ai_status, 'offline_mode');
  const failed = await formatOnlineAnswer(local, 'water?', { ...base, request: async () => ({ ok: false, status: 503 }) });
  assert.equal(failed.local_answer, local.local_answer); assert.equal(failed.ai_answer, null);
  const timed = await formatOnlineAnswer(local, 'water?', { ...base, timeoutMs: 5,
    request: (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')))) });
  assert.equal(timed.local_answer, local.local_answer); assert.equal(timed.ai_status, 'unavailable');
});
test('online general question reaches Gemini even without a matching local guide', async () => {
  let payload;
  const result = await formatOnlineAnswer({ local_answer: 'No local match', cards: [], memory_hits: [] }, 'hello', {
    url: '/api/chat/format', events: new EventTarget(), online: () => true,
    request: async (_, options) => { payload = JSON.parse(options.body); return { ok: true, json: async () => ({ ai_answer: 'How can I help?' }) }; }
  });
  assert.deepEqual(payload.cards, []);
  assert.equal(result.ai_answer, 'How can I help?');
});
