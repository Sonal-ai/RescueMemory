// A phone beacon is a renewable presence lease, separate from stored SOS events.
export const PRESENCE_TTL_MS = 300000;
export const BEACON_PROTOCOL = 'lease-v1';

export function createPresencePublisher({ request, url, key, collection, pointIdFor, vectorFor, now = Date.now }) {
  const queues = new Map(), ids = new Map(), measurements = new Map(), cleaned = new Set();
  let indexes, cleanupAt = null;
  const endpoint = `${url.replace(/\/$/, '')}/collections/${collection}`;
  async function operation(stage, path, method, body) {
    try {
      const response = await request(`${endpoint}${path}?wait=true`, { method,
        headers: { 'api-key': key, 'Content-Type': 'application/json' }, body, timeout: 6000 });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.status !== 'ok' || data.result?.status !== 'completed') throw new Error('Cloud did not confirm completion.');
      return data;
    } catch (error) { throw new Error(`[cloud.presence/${stage}] ${error.message}`, { cause: error }); }
  }
  function ensureIndexes() {
    if (!indexes) indexes = (async () => {
      // Qdrant Cloud requires indexes for these cleanup filters.
      await operation('INDEX_IDENTITY', '/index', 'PUT', { field_name: 'node_id', field_schema: 'keyword' });
      await operation('INDEX_LAST_SEEN', '/index', 'PUT', { field_name: 'last_seen', field_schema: 'integer' });
      await operation('INDEX_PROTOCOL', '/index', 'PUT', { field_name: 'beacon_protocol', field_schema: 'keyword' });
    })().catch(error => { indexes = null; throw error; });
    return indexes;
  }
  async function pruneInactive({ includeLegacy = false } = {}) {
    await ensureIndexes();
    await operation('EXPIRE_BEACONS', '/points/delete', 'POST', { filter: { must: [
      { key: 'kind', match: { value: 'peer_beacon' } },
      { key: 'last_seen', range: { lt: now() - PRESENCE_TTL_MS } },
      ...(!includeLegacy ? [{ key: 'beacon_protocol', match: { value: BEACON_PROTOCOL } }] : []),
    ] } });
    cleanupAt = now();
    return { completed: true };
  }
  async function send(input) {
    const { deviceId, location, role = 'survivor', deviceName, battery, unsyncedCount } = input;
    const measuredAt = Number.isFinite(location.timestamp) ? location.timestamp : null;
    if (measuredAt != null && measurements.has(deviceId) && measuredAt < measurements.get(deviceId))
      return { updated: false, reason: 'older_location' };
    if (!ids.has(deviceId)) ids.set(deviceId, await pointIdFor(`beacon_${deviceId}`));
    const pointId = ids.get(deviceId), seen = now();
    const payload = { id: `beacon_${deviceId}`, node_id: deviceId, kind: 'peer_beacon', visibility: 'public',
      device_name: deviceName || `Android Mesh Node (${deviceId.slice(-4)})`, role, status: 'active',
      location: { lat: location.lat, lon: location.lon,
        ...(measuredAt != null ? { timestamp: measuredAt } : {}),
        ...(Number.isFinite(location.accuracy) ? { accuracy: location.accuracy } : {}) },
      last_seen: seen, expires_at: new Date(seen + PRESENCE_TTL_MS).toISOString(), beacon_protocol: BEACON_PROTOCOL };
    if (Number.isFinite(battery) && battery >= 0 && battery <= 100) payload.battery = battery;
    if (Number.isSafeInteger(unsyncedCount) && unsyncedCount >= 0) payload.unsynced_count = unsyncedCount;
    await operation('UPSERT', '/points', 'PUT', { points: [{ id: pointId, vector: { dense: vectorFor(deviceId) }, payload }] });
    if (measuredAt != null) measurements.set(deviceId, measuredAt);
    let cleanupError;
    try {
      await ensureIndexes();
      if (!cleaned.has(deviceId)) {
        // Remove alternate old point IDs for this identity only, after its current record is confirmed.
        await operation('DEDUPLICATE', '/points/delete', 'POST', { filter: {
          must: [{ key: 'kind', match: { value: 'peer_beacon' } }, { key: 'node_id', match: { value: deviceId } },
            { key: 'beacon_protocol', match: { value: BEACON_PROTOCOL } }],
          must_not: [{ has_id: [pointId] }],
        } });
        cleaned.add(deviceId);
      }
      if (cleanupAt == null || now() - cleanupAt >= PRESENCE_TTL_MS) await pruneInactive();
    } catch (error) { cleanupError = error.message; }
    return { updated: true, point_id: pointId, ...(cleanupError ? { cleanup_error: cleanupError } : {}) };
  }
  function publish(input) {
    if (typeof input?.deviceId !== 'string' || !input.deviceId.trim())
      return Promise.reject(new Error('[cloud.presence/IDENTITY] A saved phone identity is required.'));
    const point = input.location;
    if (point?.isFallback || point?.isCached || !Number.isFinite(point?.lat) || !Number.isFinite(point?.lon) || Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180)
      return Promise.reject(new Error('[cloud.presence/LOCATION] Real phone coordinates are required.'));
    const snapshot = { ...input, location: { ...point } }, deviceId = input.deviceId;
    const work = (queues.get(deviceId) || Promise.resolve()).catch(() => {}).then(() => send(snapshot));
    queues.set(deviceId, work);
    work.finally(() => { if (queues.get(deviceId) === work) queues.delete(deviceId); }).catch(() => {});
    return work;
  }
  return { publish, pruneInactive, ensureIndexes };
}
