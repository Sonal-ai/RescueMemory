// Shared wire policy. Transport fields never change the immutable report body.
export const PROTOCOL_VERSION = 2;
export const MAX_BATCH_BYTES = 60000;
export const REPORT_FIELDS = ['id', 'entity_id', 'kind', 'text', 'location', 'severity', 'status',
  'visibility', 'group_id', 'reporter_id', 'origin_device', 'created_at', 'observed_at',
  'materials', 'breathing', 'bleeding_type', 'verified', 'source_role', 'authority_tag', 'prototype_confirmed', 'source_report_id'];

export function wireReport(report) {
  const result = {};
  for (const key of REPORT_FIELDS) if (report[key] !== undefined) result[key] = report[key];
  result.visibility = report.visibility || (['incident', 'sos'].includes(report.kind) ? 'responders' : 'public');
  if (report.kind === 'incident') result.visibility = 'responders';
  result.entity_id = report.entity_id || report.id;
  result.kind = report.kind || 'sos';
  result.status = report.status || 'needs_help';
  result.severity = report.severity || 'red';
  result.reporter_id = report.reporter_id || 'survivor-mobile';
  result.materials = report.materials || [];
  result.breathing = report.breathing ?? null;
  result.bleeding_type = report.bleeding_type ?? null;
  if (report.created_at || report.observed_at) {
    result.created_at = report.created_at || report.observed_at;
    result.observed_at = report.observed_at || report.created_at;
  }
  // A peer's assertion is never a command verification.
  result.verified = false;
  return result;
}

// Current phone-to-phone policy: every report is shared with nearby app phones.
// Keep its original scope for later cloud/server routing.
export function eligibleReports(reports) {
  return reports.map(wireReport).filter(validReport);
}

export function validReport(r) {
  return r && typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 200 &&
    typeof r.text === 'string' && ['public', 'responders', 'group'].includes(r.visibility) &&
    !(r.kind === 'incident' && r.visibility !== 'responders') &&
    typeof r.kind === 'string' && r.location && Number.isFinite(r.location.lat) &&
    Number.isFinite(r.location.lon) && Math.abs(r.location.lat) <= 90 && Math.abs(r.location.lon) <= 180;
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function reportHash(report) {
  const bytes = new TextEncoder().encode(canonical(wireReport(report)));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

export function reportBatches(reports) {
  const batches = [];
  let batch = [], size = 2;
  for (const report of reports) {
    const itemSize = new TextEncoder().encode(JSON.stringify(report)).length + 1;
    if (itemSize > MAX_BATCH_BYTES) throw new Error(`Report ${report.id} exceeds the transfer size limit; it remains pending.`);
    if (size + itemSize > MAX_BATCH_BYTES) { batches.push(batch); batch = []; size = 2; }
    batch.push(report); size += itemSize;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export function mergePeers(groups, selfId, now = Date.now()) {
  const result = new Map();
  for (const peers of groups) for (const p of peers || []) {
    if (!p?.node_id || p.node_id === selfId) continue;
    const old = result.get(p.node_id);
    const isBle = p.source === 'native_ble';
    const transports = [...new Set([...(old?.transports || []), ...(p.transports || [p.source])])];
    const merged = !old ? { ...p } : isBle ? { ...old, ...p } : { ...p, ...old };
    const seen = merged.last_seen_epoch ?? merged.last_seen;
    merged.transports = transports;
    merged.available = isBle || merged.source === 'native_ble'
      ? !!seen && now - seen < 60000 : false;
    result.set(p.node_id, merged);
  }
  const identifiedAddresses = new Set([...result.values()].filter(p => p.source === 'native_ble' && !p.node_id.startsWith('unresolved_')).map(p => p.address).filter(Boolean));
  return [...result.values()].filter(p => !p.node_id.startsWith('unresolved_') || !identifiedAddresses.has(p.address));
}

// A scan advertisement has no battery reading. Preserve the last actual
// measurement until a newer measured value arrives (including a real 0%).
export function mergePeerTelemetry(previous = {}, incoming = {}) {
  const merged = { ...previous, ...incoming };
  if (!Number.isFinite(incoming.battery) || incoming.battery < 0 || incoming.battery > 100 ||
      (previous.battery_measured_at && incoming.battery_measured_at < previous.battery_measured_at)) {
    for (const key of ['battery', 'charging', 'battery_measured_at']) merged[key] = previous[key];
  }
  return merged;
}
