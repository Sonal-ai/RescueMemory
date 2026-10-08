export const GPS_FRESH_MS = 120000;

export function meshLocation(value) {
  if (!value || value.isFallback || !Number.isFinite(value.lat) || !Number.isFinite(value.lon) ||
    Math.abs(value.lat) > 90 || Math.abs(value.lon) > 180) return null;
  const measured = value.timestamp ?? value.updatedAt;
  if (!Number.isFinite(measured) || measured <= 0) return null;
  return { lat: value.lat, lon: value.lon, timestamp: measured,
    accuracy: Number.isFinite(value.accuracy) && value.accuracy >= 0 ? value.accuracy : null };
}

export function cachedMeshLocation() {
  try {
    return meshLocation(JSON.parse(localStorage.getItem('rescue.meshLocation') || 'null')) ||
      meshLocation(JSON.parse(localStorage.getItem('rescue.lastLocation') || 'null'));
  } catch { return null; }
}

export function peerRadarPosition(local, peer, now = Date.now()) {
  const from = meshLocation(local), to = meshLocation(peer.location);
  const fresh = fix => fix && now - fix.timestamp <= GPS_FRESH_MS && fix.timestamp <= now + 5000;
  if (fresh(from) && fresh(to)) {
    const rad = Math.PI / 180, a = from.lat * rad, b = to.lat * rad, dl = (to.lon - from.lon) * rad;
    const h = Math.sin((b - a) / 2) ** 2 + Math.cos(a) * Math.cos(b) * Math.sin(dl / 2) ** 2;
    const distance = 6371000 * 2 * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)));
    const bearing = (Math.atan2(Math.sin(dl) * Math.cos(b), Math.cos(a) * Math.sin(b) -
      Math.sin(a) * Math.cos(b) * Math.cos(dl)) / rad + 360) % 360;
    return { distance_m: distance, bearing_deg: distance < 0.01 ? null : bearing,
      source: 'gps', accuracy_m: from.accuracy == null || to.accuracy == null ? null : from.accuracy + to.accuracy };
  }
  // Signal strength gives an approximate range, never a bearing. Use a stable
  // display position for the dot and label it as an estimate.
  let hash = 0;
  for (const char of peer.node_id || '') hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { distance_m: Number.isFinite(peer.distance_m) ? peer.distance_m : null,
    bearing_deg: null, display_angle: hash % 360, source: 'signal', accuracy_m: null };
}

export const radarDistance = distance => distance == null ? 'Range unavailable' :
  distance >= 1000 ? `~${(distance / 1000).toFixed(1)} km` : `~${Math.round(distance)} m`;
