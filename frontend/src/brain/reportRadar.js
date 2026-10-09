import { coordinates } from './adminData.js';
const radians = degrees => degrees * Math.PI / 180;
const cardinals = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function reportRadar(reports, request) {
  const center = coordinates(request);
  if (!center) throw new Error('Radar needs valid location coordinates.');
  const radius = request.radius_m ?? 3500;
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('Radar needs a positive search radius.');
  const category = request.filter_category ?? 'all';
  const items = [];
  for (const report of reports) {
    const location = coordinates(report.location);
    if (!location || !report.id) continue;
    const phi1 = radians(center.lat), phi2 = radians(location.lat), delta = radians(location.lon - center.lon);
    const a = Math.sin((phi2 - phi1) / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(delta / 2) ** 2;
    const distance = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
    if (distance > radius) continue;
    const bearing = Math.round((Math.atan2(Math.sin(delta) * Math.cos(phi2), Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(delta)) * 180 / Math.PI + 360) % 360);
    const isCas = ['incident', 'sos'].includes(report.kind) || /trapped|injured|cannot walk|bleeding/i.test(report.text || '');
    const isHaz = report.kind === 'hazard';
    const cat = isCas ? 'casualty' : isHaz ? 'hazard' : report.kind === 'checkpoint' ? 'shelter' : 'resource';
    if (category !== 'all' && category !== cat && !({ casualties: 'casualty', shelters: 'shelter', hazards: 'hazard', resources: 'resource' }[category] === cat)) continue;
    items.push({ id: report.id, name: report.title || report.entity_id || `${cat.toUpperCase()} Alert`, category: cat,
      triage_level: isCas ? (report.severity === 'red' ? 'immediate_red' : 'delayed_yellow') : isHaz ? 'hazard_warning' : 'safe_green',
      text: report.text || '', status: report.status || 'active', severity: report.severity || 'yellow', distance_m: Math.round(distance),
      bearing_deg: bearing, cardinal: cardinals[Math.round(bearing / 22.5) % 16], walk_time_min: Math.max(1, Math.round(distance / 75)),
      location, signal_source: 'local_indexeddb', verified: report.verified === true });
  }
  items.sort((a, b) => a.distance_m - b.distance_m);
  const casualties = items.filter(i => i.category === 'casualty'), shelters = items.filter(i => i.category === 'shelter');
  return { center, radius_m: radius, total_found: items.length, radar_items: items,
    summary: { urgent_casualties: casualties.filter(c => c.triage_level === 'immediate_red').length, total_casualties: casualties.length,
      operational_shelters: shelters.length, active_peers: 0, nearest_casualty: casualties[0] || null, nearest_shelter: shelters[0] || null }, local_fallback: true };
}
