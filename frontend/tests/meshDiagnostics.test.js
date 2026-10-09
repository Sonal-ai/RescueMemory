import test from 'node:test';
import assert from 'node:assert/strict';
const values = new Map();
globalThis.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
const { transferSummary, meshTrace, getMeshTrace, meshError } = await import('../src/brain/meshDiagnostics.js');

test('unconfirmed exchanges never display invented counts or success', () => {
  assert.match(transferSummary(null), /has not been confirmed/);
  assert.match(transferSummary({ peer_id: 'A', sent: 7 }), /has not been confirmed/);
  assert.equal(transferSummary({ peer_id: 'A', error: '[scan/ANDROID_SCAN_2] registration failed' }), '[scan/ANDROID_SCAN_2] registration failed');
});
test('counts require checked inventories and come from positive measured values', () => {
  assert.equal(transferSummary({ peer_id: 'A', inventory_checked: true, status: 'complete', sent: 2, received: 0 }), 'Sent 2');
  assert.equal(transferSummary({ peer_id: 'A', inventory_checked: true, status: 'complete', sent: 0, received: 0 }), 'Connected: both inventories checked; no new reports to transfer.');
});
test('diagnostic history is bounded and wrapped errors retain stage and cause', () => {
  for (let i = 0; i < 125; i++) meshTrace('scan', 'REQUESTED', 'scan', { sequence: i });
  assert.equal(getMeshTrace().length, 120);
  const original = new Error('Android status 133');
  const wrapped = meshError('gatt.connect', original, { address: 'test-address' });
  assert.equal(wrapped.cause, original);
  assert.equal(wrapped.message, '[gatt.connect] Android status 133');
  assert.equal(getMeshTrace().at(-1).context.address, 'test-address');
});
