// Dashboard values come from report records, operator input, and confirmed GPS.
const eventTime = event => Date.parse(event.observed_at || event.created_at) || 0;
export function coordinates(value) {
  if (!value || value.isFallback || value.lat == null || value.lon == null || value.lat === '' || value.lon === '') return null;
  const lat = Number(value.lat), lon = Number(value.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

export function equipmentInventory(saved) {
  const result = {};
  for (const key of ['tourniquet', 'hemostatic_gauze', 'splint_stretcher', 'water_purification', 'burn_dressing']) {
    result[key] = typeof saved?.[key] === 'boolean' ? saved[key] : null;
  }
  return result;
}

export function dashboardSummary(events) {
  const latest = new Map();
  for (const event of [...events].sort((a, b) => eventTime(a) - eventTime(b) || String(a.id).localeCompare(String(b.id)))) {
    latest.set(event.entity_id || event.id, event);
  }
  const current = [...latest.values()];
  const casualties = current.filter(e => ['incident', 'sos'].includes(e.kind));
  const hazards = current.filter(e => e.kind === 'hazard');
  const havens = current.filter(e => ['checkpoint', 'resource'].includes(e.kind) && e.verified === true && e.status === 'operational' && e.severity !== 'red');
  return { current, casualties, hazards, havens,
    redCount: casualties.filter(e => e.severity === 'red' && e.status !== 'rescued_transported').length,
    yellowCount: casualties.filter(e => e.severity === 'yellow' && e.status !== 'rescued_transported').length,
    rescuedCount: casualties.filter(e => e.status === 'rescued_transported').length };
}

export async function loadDashboardFeed(request, forceRefresh = false) {
  const results = await Promise.allSettled(['public', 'responders'].map(async scope => {
    const items = new Map(); let page = 0;
    while (true) {
      const result = await request(`/api/memory?scope=${scope}&limit=100&page=${page}`, {
        responder: scope === 'responders', preferCache: !forceRefresh, noCache: forceRefresh, cacheTtl: 10000,
      });
      if (!Array.isArray(result?.items)) throw new Error('Invalid report feed response.');
      const before = items.size;
      for (const item of result.items) {
        if (!item?.id) throw new Error('Report feed contains a record without an ID.');
        items.set(item.id, item);
      }
      if (!result.has_more) return [...items.values()];
      if (before === items.size) throw new Error('Report pagination did not advance.');
      page++;
    }
  }));
  const errors = results.flatMap((result, index) => result.status === 'rejected' ? [`${index ? 'Responders' : 'Public'}: ${result.reason.message}`] : []);
  const items = [...new Map(results.flatMap(result => result.status === 'fulfilled' ? result.value : []).map(item => [item.id, item])).values()];
  items.sort((a, b) => eventTime(b) - eventTime(a));
  return { items, complete: errors.length === 0, errors };
}

export function requiresAuthorityServer(path, method, body) {
  return method !== 'GET' && (path === '/api/guides/publish' || (path === '/api/reports' && body?.verified === true));
}

export function localMemoryPage(reports, { scope, page = 0, limit = 50 }) {
  if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid memory page.');
  const items = reports.filter(r => !scope || r.visibility === scope).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const start = page * limit;
  return { items: items.slice(start, start + limit), total: items.length, has_more: start + limit < items.length,
    local_fallback: true, mode: 'standalone_mobile_brain' };
}

export function storedEntityTimeline(reports, entityId, now = Date.now()) {
  const timeline = reports.filter(r => r.entity_id === entityId || r.id === entityId)
    .sort((a, b) => eventTime(a) - eventTime(b) || String(a.id).localeCompare(String(b.id)));
  // Match central timeline precedence, but don't invent a facility recommendation.
  const danger = timeline.filter(r => ['hazard', 'checkpoint'].includes(r.kind) && ['danger', 'flooded', 'blocked'].includes(r.status) && eventTime(r) > now - 6 * 60 * 60 * 1000).at(-1);
  const verified = timeline.findLast(r => r.verified && r.source_role === 'central');
  const effective = verified && (!danger || eventTime(verified) > eventTime(danger)) ? verified : danger || timeline.at(-1) || null;
  return { entity_id: entityId, effective, timeline,
    conflict: new Set(timeline.map(r => r.status).filter(Boolean)).size > 1,
    alternative_recommendation: null, local_fallback: true };
}
