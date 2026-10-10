const GENERIC = /^(?:node[_-]|peer\b|sos\b|incident\b|casualty\b|hazard\b|resource\b|checkpoint\b|unknown\b)/i;

function shortDetail(value) {
  const cleaned = String(value || '')
    .replace(/^(?:emergency\s+)?(?:sos|incident|hazard|resource|safe shelter|checkpoint)\s*[:—-]?\s*/i, '')
    .replace(/node_[a-z0-9_-]+/ig, '')
    .replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const words = cleaned.split(' ').slice(0, 4).join(' ');
  return words.length > 27 ? `${words.slice(0, 26).trimEnd()}…` : words;
}

export function radarDestinationLabel(item) {
  const category = item?.category || item?.kind;
  const prefix = category === 'casualty' || ['sos', 'incident'].includes(category) ? 'SOS'
    : category === 'shelter' || category === 'checkpoint' ? 'Shelter'
      : category === 'resource' ? 'Resource'
        : category === 'hazard' ? 'Hazard' : 'Nearby phone';
  const named = String(item?.name || item?.title || '').trim();
  const detail = shortDetail(named && !GENERIC.test(named) ? named : item?.text || item?.description);
  return detail && detail.toLowerCase() !== prefix.toLowerCase() ? `${prefix} · ${detail}` : prefix;
}

export function radarDestinationOption(item) {
  const distance = Number.isFinite(item?.distance_m) ? `${Math.round(item.distance_m)}m` : '';
  const direction = item?.cardinal || '';
  return [radarDestinationLabel(item), [distance, direction].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
}
