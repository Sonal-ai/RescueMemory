// Identity belongs to the originating report, never to the relaying phone.
export function originalReportId(report) {
  return report.source_report_id || report.id;
}

export function prepareReport(body, deviceId) {
  const id = body.idempotency_key || body.source_report_id || body.id || newReportId();
  const observed_at = body.observed_at || body.created_at || new Date().toISOString();
  return { ...body, id, source_report_id: id, idempotency_key: id,
    visibility: body.visibility || (body.group_id ? 'group' : ['incident', 'sos'].includes(body.kind) ? 'responders' : 'public'),
    severity: body.severity || (['incident', 'sos'].includes(body.kind) ? 'red' : 'yellow'),
    status: body.status ?? (['incident', 'sos'].includes(body.kind) ? 'needs_help' : null),
    entity_id: body.entity_id || id, origin_device: body.origin_device || deviceId,
    observed_at, created_at: body.created_at || observed_at };
}

function newReportId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}
