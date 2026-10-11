const wrap = degrees => ((degrees % 360) + 360) % 360;

// Bearing is earth-relative; the pointer is relative to the phone's top edge.
// A missing/stale sensor reading must never produce a north fix or green arrow.
export function compassNeedleState(heading, bearing, previouslyAligned = false) {
  if (!Number.isFinite(heading)) return { angle: null, error: null, aligned: false };
  const hasTarget = Number.isFinite(bearing);
  const angle = wrap((hasTarget ? bearing : 0) - heading);
  const error = Math.abs(((angle + 180) % 360) - 180);
  return { angle, error, aligned: hasTarget && (previouslyAligned ? error < 18 : error <= 12) };
}

export function nextCompassNeedleAngle(previous, angle) {
  if (!Number.isFinite(angle)) return previous;
  return previous + ((angle - wrap(previous) + 540) % 360) - 180;
}
