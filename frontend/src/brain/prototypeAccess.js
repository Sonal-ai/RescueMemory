// The demo opens dashboard operations automatically; no operator key setup.
// A restricted build can still use the original server permission checks.
export const prototypeAccess = import.meta.env?.VITE_PROTOTYPE_ACCESS !== 'false';

export function prototypeReport(body) {
  if (!['incident', 'hazard', 'resource', 'checkpoint', 'sos'].includes(body?.kind) ||
      typeof body.text !== 'string' || body.text.trim().length < 3 || body.text.length > 2000)
    throw new Error('Enter a valid report type and description (3–2000 characters).');
  if (body.location && (!Number.isFinite(body.location.lat) || !Number.isFinite(body.location.lon) ||
      Math.abs(body.location.lat) > 90 || Math.abs(body.location.lon) > 180))
    throw new Error('Enter valid coordinates.');
  // Operator confirmation is explicit. A local save has no server signature.
  return { ...body, verified: false, prototype_confirmed: body.verified === true,
    source_role: 'prototype', authority_tag: undefined };
}

export function prototypeGuide(body, existing, publisher) {
  const lengths = { id: [3, 100], title: [3, 160], keywords: [3, 500], summary: [10, 1200], source: [2, 500], reviewer: [2, 100] };
  for (const [key, [min, max]] of Object.entries(lengths)) {
    if (typeof body?.[key] !== 'string' || body[key].trim().length < min || body[key].length > max)
      throw new Error(`Enter a valid ${key} (${min}–${max} characters).`);
  }
  if (!Array.isArray(body.steps) || !body.steps.length || body.steps.length > 10 || body.steps.some(s => typeof s !== 'string' || !s.trim()))
    throw new Error('Enter 1–10 protocol steps.');
  if (body.warnings && (!Array.isArray(body.warnings) || body.warnings.length > 10 || body.warnings.some(s => typeof s !== 'string')))
    throw new Error('Enter up to 10 warnings.');
  return { ...body, kind: 'protocol', version: (existing?.version || 0) + 1,
    publisher, issued_at: new Date().toISOString(), review_status: 'prototype_operator',
    pending_publication: true, auth_tag: undefined };
}
