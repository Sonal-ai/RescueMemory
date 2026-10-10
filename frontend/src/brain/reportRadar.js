import { coordinates } from './adminData.js';
import { currentSurvivorReports } from './survivorReports.js';
const radians = degrees => degrees * Math.PI / 180;
const cardinals = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function reportRadar(reports, request) {
  const center = coordinates(request);
  if (!center) throw new Error('Radar needs valid location coordinates.');
  const radius = request.radius_m ?? 3500;
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('Radar needs a positive search radius.');
  const category = request.filter_category ?? 'all';
  const items = [];
  const current = currentSurvivorReports(reports);
  for (const report of current) {
    if (['presence', 'peer_beacon'].includes(report.kind)) continue;
    if (report.expires_at && Date.parse(report.expires_at) <= Date.now()) continue;
    if (/^(closed|resolved|rescued|rescued_transported|cancelled|inactive|depleted|unavailable|destroyed)$/i.test(report.status || '')) continue;
    if (report.visibility === 'group' && report.group_id !== request.group_id) continue;
    if (report.visibility === 'responders' && request.include_responders === false) continue;
    const location = coordinates(report.location);
    if (!location || !report.id) continue;
    const phi1 = radians(center.lat), phi2 = radians(location.lat), delta = radians(location.lon - center.lon);
    const a = Math.sin((phi2 - phi1) / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(delta / 2) ** 2;
    const distance = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
    if (distance > radius) continue;
    const bearing = Math.round((Math.atan2(Math.sin(delta) * Math.cos(phi2), Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(delta)) * 180 / Math.PI + 360) % 360);
    const isCas = ['incident', 'sos'].includes(report.kind);
    const isHaz = report.kind === 'hazard' || /^(danger|flooded|blocked|compromised)$/i.test(report.status || '');
    const cat = isCas ? 'casualty' : isHaz ? 'hazard' : report.kind === 'checkpoint' ? 'shelter' : 'resource';
    if (category !== 'all' && category !== cat && !({ casualties: 'casualty', shelters: 'shelter', hazards: 'hazard', resources: 'resource' }[category] === cat)) continue;
    items.push({ id: report.id, entity_id: report.entity_id, name: report.title || (cat === 'shelter' ? report.text?.split(/\s*\(/)[0] : null) || report.entity_id || `${cat.toUpperCase()} Alert`, category: cat,
      triage_level: isCas ? (report.severity === 'red' ? 'immediate_red' : report.severity === 'yellow' ? 'delayed_yellow' : 'informational')
        : isHaz ? 'hazard_warning' : report.status === 'operational' && report.severity === 'green' ? 'safe_green' : 'informational',
      text: report.text || '', status: report.status || null, severity: report.severity || null, distance_m: Math.round(distance),
      bearing_deg: bearing, cardinal: cardinals[Math.round(bearing / 22.5) % 16], walk_time_min: null,
      location, observed_at: report.observed_at || report.created_at, signal_source: 'local_indexeddb', verified: report.verified === true,
      prototype_confirmed: report.prototype_confirmed === true });
  }
  items.sort((a, b) => a.distance_m - b.distance_m);
  const casualties = items.filter(i => i.category === 'casualty'), shelters = items.filter(i => i.category === 'shelter');
  return { center, radius_m: radius, total_found: items.length, radar_items: items, current_reports: current,
    summary: { urgent_casualties: casualties.filter(c => c.triage_level === 'immediate_red').length, total_casualties: casualties.length,
      operational_shelters: shelters.filter(item => item.status === 'operational').length, active_peers: items.filter(item => item.category === 'peer').length, nearest_casualty: casualties[0] || null, nearest_shelter: shelters[0] || null }, local_fallback: true };
}
