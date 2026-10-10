const KEY = 'rescue.mesh_diagnostics';
const listeners = new Set();
let entries;
try { entries = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { entries = []; }
if (!Array.isArray(entries)) entries = [];
export function meshTrace(stage, code, detail, context = {}) {
  // Only callers' operational metadata is recorded, never report text/key bytes.
  const event = { at: Date.now(), stage, code, detail, context };
  entries = [...entries.slice(-119), event];
  try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch (error) { console.warn('[Mesh diagnostics]', error.message); }
  listeners.forEach(listener => listener(event));
  return event;
}
export const getMeshTrace = () => [...entries];
export const onMeshTrace = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export function meshError(stage, error, context) {
  const detail = `[${stage}] ${error?.message || String(error)}`;
  meshTrace(stage, error?.code || 'FAILED', detail, context);
  return new Error(detail, { cause: error });
}
export function transferSummary(result) {
  if (!result?.peer_id || !result.inventory_checked) return result?.error || 'Connection attempt; report exchange has not been confirmed.';
  const counts = [['sent', 'Sent'], ['received', 'Received'], ['duplicates', 'Already shared'], ['conflicts', 'Conflicts'], ['pending', 'Pending']]
    .filter(([key]) => Number.isSafeInteger(result[key]) && result[key] > 0)
    .map(([key, label]) => `${label} ${result[key]}`);
  if (counts.length) return `${counts.join(' · ')}${result.status === 'partial' ? ' · partial' : ''}`;
  return result.status === 'complete' ? 'Connected: both inventories checked; no new reports to transfer.' : 'Connected: checking report inventories.';
}
