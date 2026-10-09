// These are collection names, never assumed record counts.
export const CLOUD_COLLECTIONS = [
  { name: 'rescue_public_events', label: 'Public' },
  { name: 'rescue_responder_events', label: 'Responders' },
  { name: 'rescue_group_events', label: 'Group' },
  { name: 'rescue_approved_guides', label: 'Guides' },
];
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export const displayCloudCount = value => count(value) ?? 'Unavailable';
const checkedAt = () => new Date().toISOString();
const offlineSnapshot = reason => ({ connected: false, configured: true, source: 'qdrant_cloud',
  counts_verified: false, shards: {}, total_points: null, reason, checked_at: checkedAt() });
async function jsonRequest(request, url, key, path, body) {
  const response = await request(`${url.replace(/\/$/, '')}${path}`, {
    method: body === undefined ? 'GET' : 'POST', timeout: 6000,
    headers: { 'api-key': key, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`Qdrant ${path}: HTTP ${response.status}`);
  const data = await response.json();
  if (data.status !== 'ok' || !data.result) throw new Error(`Qdrant ${path}: invalid response`);
  return data.result;
}
export async function readCloudSnapshot(request, { url, key, online = true }) {
  if (!url || !key) return { ...offlineSnapshot('Cloud connection is not configured.'), configured: false };
  if (!online) return offlineSnapshot('Offline: cloud counts cannot be verified.');
  try {
    const result = await jsonRequest(request, url, key, '/collections');
    if (!Array.isArray(result.collections)) throw new Error('Invalid cloud collection list.');
    const collections = result.collections.map(c => c.name), shards = {}, count_errors = {};
    await Promise.all(CLOUD_COLLECTIONS.map(async ({ name }) => {
      if (!collections.includes(name)) { shards[name] = 0; return; } // Confirmed absent collection.
      try {
        const result = await jsonRequest(request, url, key, `/collections/${name}/points/count`, { exact: true });
        if (count(result.count) === null) throw new Error('Cloud returned an invalid record count.');
        shards[name] = result.count;
      } catch (error) { shards[name] = null; count_errors[name] = error.message; }
    }));
    const verified = Object.keys(count_errors).length === 0;
    return { connected: true, configured: true, source: 'qdrant_cloud', collections, shards, count_errors,
      counts_verified: verified, total_points: verified ? Object.values(shards).reduce((a, b) => a + b, 0) : null,
      checked_at: checkedAt() };
  } catch (error) { return offlineSnapshot(error.message); }
}
export async function readCloudRecords(request, { url, key, online = true, collection, offset = null, limit = 50 }) {
  if (!CLOUD_COLLECTIONS.some(c => c.name === collection)) throw new Error('Invalid cloud collection.');
  if (!online) throw new Error('Offline: cloud records cannot be read. Local reports remain available in Sync debugging.');
  if (!url || !key) throw new Error('Cloud connection is not configured.');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid cloud page size.');
  const listed = await jsonRequest(request, url, key, '/collections');
  if (!Array.isArray(listed.collections)) throw new Error('Invalid cloud collection list.');
  if (!listed.collections.some(c => c.name === collection)) return { items: [], collection, next_offset: null, source: 'qdrant_cloud', checked_at: checkedAt() };
  const result = await jsonRequest(request, url, key, `/collections/${collection}/points/scroll`, {
    limit, with_payload: true, with_vector: false, ...(offset == null ? {} : { offset }),
  });
  if (!Array.isArray(result.points)) throw new Error('Invalid cloud record page.');
  return { items: result.points.map(p => ({ point_id: String(p.id), payload: p.payload || {} })),
    collection, next_offset: result.next_page_offset ?? null, source: 'qdrant_cloud', checked_at: checkedAt() };
}
export function cloudMirrorSummary(result) {
  if (['offline', 'unreachable'].includes(result?.status)) throw new Error('Cloud sync unavailable; no cloud mirror was confirmed. Reports remain stored locally.');
  const sum = object => Object.values(object || {}).reduce((total, n) => total + (count(n) ?? 0), 0);
  const uploaded = result?.mode === 'report_sync' ? count(result.synced_events) : sum(result?.events_uploaded) + (count(result?.guides_uploaded) ?? 0);
  const received = result?.mode === 'report_sync' ? count(result.imported_events) : sum(result?.events_downloaded) + (count(result?.guides_downloaded) ?? 0);
  if (result?.mode !== 'report_sync' && result?.mirrored !== true) throw new Error('Cloud mirror was not confirmed by the server.');
  const changes = [uploaded > 0 ? `uploaded ${uploaded}` : '', received > 0 ? `received ${received}` : ''].filter(Boolean);
  if (result.mode === 'report_sync') return `Report sync checked${changes.length ? `: ${changes.join(' · ')}` : '; no new reports exchanged'}. Full collection mirroring requires the central API.`;
  return `Cloud mirror finished${changes.length ? `: ${changes.join(' · ')}` : '; no new records needed transfer'}. ${result.counts_verified && count(result.total_points) !== null ? `Cloud inventory: ${result.total_points} records.` : 'Cloud inventory count could not be verified.'}`;
}
export function localRecordProvenance(record, history, localNode) {
  if (!record) throw new Error('No local record or relay receipts for this cloud point.');
  const hops = (history?.receipts || []).filter(r => r.report_id === record.id && ['sent', 'received'].includes(r.direction))
    .map(r => ({ id: r.id, from_node: r.direction === 'received' ? r.peer_id : localNode,
      to_node: r.direction === 'received' ? localNode : r.peer_id, transport: r.transport, synced_at: r.at }));
  return { event_id: record.id, origin_node: record.origin_device || null, hops, local_fallback: true };
}
