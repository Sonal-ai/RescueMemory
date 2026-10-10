import { coordinates } from './adminData.js';

const observed = report => Date.parse(report.observed_at || report.created_at || '') || 0;

// Resolve the latest observation before filtering, so an old open shelter
// cannot replace a newer closure or a server acknowledgement of the same point.
export function currentSurvivorReports(...feeds) {
  const latest = new Map();
  for (const report of feeds.flat()) {
    if (!report?.id) continue;
    const key = report.entity_id || report.source_report_id || report.id;
    const previous = latest.get(key);
    if (!previous || observed(report) >= observed(previous)) latest.set(key, report);
  }
  return [...latest.values()];
}

export function savedShelters(reports, now = Date.now()) {
  return currentSurvivorReports(reports).filter(report => report.kind === 'checkpoint'
    && !/^(closed|inactive|unavailable|destroyed|danger|flooded|blocked|compromised)$/i.test(report.status || '')
    && (!report.expires_at || Date.parse(report.expires_at) > now))
    .map(report => ({ ...report, category: 'shelter', location: coordinates(report.location),
      name: report.title || report.text?.split(/\s*\(/)[0] || report.entity_id || 'Reported shelter' }));
}

export function mergeSurvivalRadar(remote, local) {
  const savedIds = new Set(local.radar_items.map(item => item.id));
  const savedEntities = new Set(local.radar_items.map(item => item.entity_id).filter(Boolean));
  const items = [...(remote?.radar_items || []).filter(item => !savedIds.has(item.id)
    && !savedEntities.has(item.entity_id || item.name)), ...local.radar_items]
    .sort((a, b) => a.distance_m - b.distance_m);
  const casualties = items.filter(item => item.category === 'casualty');
  const shelters = items.filter(item => item.category === 'shelter' && !/^(danger|flooded|blocked)$/i.test(item.status || ''));
  return { ...local, ...remote, radar_items: items, total_found: items.length,
    summary: { urgent_casualties: casualties.filter(item => item.triage_level === 'immediate_red').length,
      total_casualties: casualties.length, operational_shelters: shelters.length,
      active_peers: items.filter(item => item.category === 'peer').length,
      nearest_casualty: casualties[0] || null, nearest_shelter: shelters[0] || null } };
}
