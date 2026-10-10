import { coordinates } from './adminData.js';
import { reportRadar } from './reportRadar.js';

export function reportQuestion(text = '') {
  const q = text.toLowerCase();
  if (/\b(nearest|nearby|closest|find|where|supply|supplies|distribution|any|fresh)\b/.test(q)) {
    if (/\b(shelter|refuge|camp|safe place|checkpoint)\b/.test(q)) return 'shelter';
    if (/\b(water|drink)\b/.test(q) && !/\b(purify|boil|disinfect|purification)\b/.test(q)) return 'water';
    if (/\b(food|meal|ration)\b/.test(q)) return 'food';
    if (/\b(survivor|surviver|casualty|injured|victim|sos)\b/.test(q)) return 'survivor';
  }
  if (/who needs help|who is injured|active casualties|sos signals/.test(q)) return 'survivor';
  return null;
}

// These are actual saved observations, not invented destinations. Resolve each
// entity to its latest report before filtering so a closed shelter cannot be
// resurrected by an older 'open' observation.
export function localReportAnswer(query, reports, location, now = Date.now()) {
  const category = reportQuestion(query);
  if (!category) return null;
  const newest = new Map();
  const observed = r => Date.parse(r.observed_at || r.created_at || '') || 0;
  for (const report of reports || []) {
    if (!report?.id) continue;
    const key = report.entity_id || report.id;
    if (!newest.has(key) || observed(report) > observed(newest.get(key))) newest.set(key, report);
  }
  const matching = [...newest.values()].filter(r => {
    if (/^(closed|resolved|rescued|rescued_transported|cancelled|inactive|depleted|unavailable|compromised|destroyed)$/i.test(r.status || '') ||
        (r.expires_at && Date.parse(r.expires_at) <= now)) return false;
    if (category === 'survivor') return ['incident', 'sos'].includes(r.kind);
    if (!['resource', 'checkpoint', 'observation'].includes(r.kind)) return false;
    if (/\b(no |need |needs |out of |looking for |requesting )(water|food|shelter|supplies)/i.test(r.text || '')) return false;
    const patterns = { shelter: /shelter|refuge|evacuation|safe (place|zone)|camp/i, water: /water|potable|drinking/i, food: /food|meal|ration/i };
    return patterns[category].test(`${r.title || ''} ${r.text || ''}`);
  });
  const center = coordinates(location);
  const positions = center ? new Map(reportRadar(matching, { ...center, radius_m: Math.PI * 6371000 }).radar_items.map(r => [r.id, r])) : new Map();
  const hits = matching.map(r => ({ ...r, ...positions.get(r.id), citation_label: '' }))
    .sort((a, b) => (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity) || observed(b) - observed(a))
    .slice(0, 5).map((r, i) => ({ ...r, citation_label: `R${i + 1}` }));
  const lines = hits.map(r => `- [${r.citation_label}] ${r.text}\n  ${r.distance_m != null ? `~${r.distance_m} m ${r.cardinal} (straight line). ` : 'Distance unavailable. '}${r.observed_at || r.created_at ? `Reported ${r.observed_at || r.created_at}.` : 'Report time unavailable.'} Status: ${r.status || 'not supplied'}.`);
  const text = `### Saved ${category} reports\n\n${lines.length ? lines.join('\n') : `No matching active ${category} reports are saved on this phone.`}\n\n${!center ? 'Enable GPS to compare distances. ' : ''}Shared observations may be outdated; availability and route safety are not confirmed.`;
  const target = hits.find(r => r.distance_m != null);
  return { query, answer_type: 'local_reports', cards: [], memory_hits: hits,
    local_answer: text, text, ai_answer: null, ai_status: 'local_only', local_fallback: true,
    mode: 'local_report_memory', suggested_action: target ? { kind: 'map', label: 'View reported location',
      button_text: 'View on Radar', target_tab: 'map', nav_target: target } : null, warnings: [] };
}
