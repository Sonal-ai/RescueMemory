import { coordinates } from './adminData.js';

const observed = report => Date.parse(report.observed_at || report.created_at || '') || 0;

export function targetMeasurements(origin, destination) {
  const from = coordinates(origin), to = coordinates(destination);
  if (!from || !to) return { distance: null, bearing: null, cardinal: null };
  const radians = value => value * Math.PI / 180;
  const lat1 = radians(from.lat), lat2 = radians(to.lat), delta = radians(to.lon - from.lon);
  const a = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(delta / 2) ** 2;
  const distance = Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))));
  if (from.lat === to.lat && from.lon === to.lon) return { distance, bearing: null, cardinal: null };
  const bearing = Math.round((Math.atan2(Math.sin(delta) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(delta)) * 180 / Math.PI + 360) % 360);
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return { distance, bearing, cardinal: directions[Math.round(bearing / 22.5) % directions.length] };
}

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

export function reportedFacilities(reports, origin, needs = {}, radius = Infinity, now = Date.now()) {
  const requested = Object.entries(needs).filter(([, enabled]) => enabled).map(([name]) => name.toLowerCase());
  return currentSurvivorReports(reports).filter(report => ['checkpoint', 'resource', 'shelter'].includes(report.kind)
    && !/^(closed|inactive|unavailable|destroyed|danger|flooded|blocked|compromised|depleted)$/i.test(report.status || '')
    && (!report.expires_at || Date.parse(report.expires_at) > now)).map(report => {
      const location = coordinates(report.location);
      const supplied = report.facilities || report.details?.facilities;
      const facilities = Array.isArray(supplied) ? [...supplied] : (report.text?.match(/Facilities:\s*([^.]*)/i)?.[1] || '')
        .split(',').map(value => value.trim()).filter(value => value && !/^not reported$/i.test(value));
      const metrics = targetMeasurements(origin, location);
      return { ...report, location, lat: location?.lat, lon: location?.lon, category: report.kind === 'resource' ? 'resource' : 'shelter',
        name: report.title || report.details?.name || report.text?.split(/\s*\(/)[0] || report.entity_id || report.id,
        type: report.kind === 'resource' ? 'Reported supply point' : 'Reported shelter',
        status: report.status || null, facilities, dist_m: metrics.distance };
    }).filter(report => (report.dist_m == null || report.dist_m <= radius)
      && (!requested.length || requested.some(need => (need === 'shelter' && report.category === 'shelter')
        || report.facilities.some(facility => facility.toLowerCase().includes(need)))))
    .sort((a, b) => (a.dist_m ?? Infinity) - (b.dist_m ?? Infinity));
}

export function mergeSurvivalRadar(remote, local) {
  const savedIds = new Set(local.radar_items.map(item => item.id));
  const savedEntities = new Set(local.radar_items.map(item => item.entity_id).filter(Boolean));
  const items = [...(remote?.radar_items || []).filter(item => !savedIds.has(item.id)
    && !savedEntities.has(item.entity_id || item.name)), ...local.radar_items]
    .sort((a, b) => a.distance_m - b.distance_m);
  const casualties = items.filter(item => item.category === 'casualty');
  const shelters = items.filter(item => item.category === 'shelter' && item.status === 'operational');
  return { ...local, ...remote, radar_items: items, total_found: items.length,
    summary: { urgent_casualties: casualties.filter(item => item.triage_level === 'immediate_red').length,
      total_casualties: casualties.length, operational_shelters: shelters.length,
      active_peers: items.filter(item => item.category === 'peer').length,
      nearest_casualty: casualties[0] || null, nearest_shelter: shelters[0] || null } };
}
