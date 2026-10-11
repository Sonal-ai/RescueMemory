import test from 'node:test';
import assert from 'node:assert/strict';
import { compassNeedleState, nextCompassNeedleAngle } from '../src/brain/compassNeedle.js';

test('destination pointer follows the phone heading and turns green only facing the destination', () => {
  assert.deepEqual(compassNeedleState(0, 90), { angle: 90, error: 90, aligned: false });
  assert.deepEqual(compassNeedleState(90, 90), { angle: 0, error: 0, aligned: true });
  assert.deepEqual(compassNeedleState(180, 90), { angle: 270, error: 90, aligned: false });
  assert.equal(compassNeedleState(270, 270).aligned, true);
  assert.equal(compassNeedleState(180, 0).aligned, false);
});

test('north wraparound and alignment hysteresis handle sensor jitter without false green or full spins', () => {
  assert.equal(compassNeedleState(359, 1).angle, 2);
  assert.equal(compassNeedleState(1, 359).angle, 358);
  assert.equal(compassNeedleState(359, 1).aligned, true);
  assert.equal(compassNeedleState(0, 14, false).aligned, false);
  assert.equal(compassNeedleState(0, 14, true).aligned, true);
  assert.equal(compassNeedleState(0, 18, true).aligned, false);
  assert.equal(nextCompassNeedleAngle(359, 1), 361);
  assert.equal(nextCompassNeedleAngle(1, 359), -1);
});

test('missing live heading cannot show a direction or green; north fallback uses the measured heading', () => {
  for (const heading of [null, undefined, NaN])
    assert.deepEqual(compassNeedleState(heading, 90, true), { angle: null, error: null, aligned: false });
  assert.deepEqual(compassNeedleState(90, null), { angle: 270, error: 90, aligned: false });
  assert.equal(compassNeedleState(0, null, true).aligned, false);
  assert.equal(nextCompassNeedleAngle(123, null), 123);
});
