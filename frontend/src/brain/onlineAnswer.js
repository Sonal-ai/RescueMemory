// Local retrieval is completed first; every network failure returns that same
// answer and its citations. The server alone holds the Gemini API key.
export async function formatOnlineAnswer(local, question, { url, request = fetch,
  online = () => navigator.onLine !== false, events = window, timeoutMs = 10000 } = {}) {
  if (!online()) return { ...local, ai_status: 'offline_mode' };
  const cards = (local.cards || []).slice(0, 5).map(c => ({
    id: c.id, title: c.title, summary: c.summary || '', steps: (c.steps || c.instructions || []).slice(0, 8),
    warnings: (c.warnings || []).slice(0, 8), source: typeof c.source === 'string' ? c.source : '',
  }));
  // Responder/group observations stay on the phone. BLE sharing permission
  // does not imply permission to upload that material to an online LLM.
  const reports = (local.memory_hits || []).filter(r => r.visibility === 'public').slice(0, 5).map(r => ({
    text: r.text, status: r.status || '', observed_at: r.observed_at || r.created_at || '', visibility: 'public',
    distance_m: r.distance_m ?? null, cardinal: r.cardinal || '',
  }));
  if (!cards.length && !reports.length) return { ...local, ai_status: 'no_evidence' };
  const controller = new AbortController();
  const disconnected = () => controller.abort();
  const timer = setTimeout(disconnected, timeoutMs);
  events.addEventListener('offline', disconnected);
  try {
    const response = await request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ text: question, cards, reports }), signal: controller.signal });
    if (!response.ok) throw new Error(`Formatting service HTTP ${response.status}`);
    const result = await response.json();
    if (controller.signal.aborted || !online()) throw new Error('Connection lost while formatting');
    if (typeof result.ai_answer !== 'string' || !result.ai_answer.trim()) return { ...local, ai_status: result.ai_status || 'unavailable' };
    return { ...local, ai_answer: result.ai_answer, ai_status: 'answered' };
  } catch (error) {
    return { ...local, ai_answer: null, ai_status: online() ? 'unavailable' : 'offline_mode', ai_error: error.message };
  } finally { clearTimeout(timer); events.removeEventListener('offline', disconnected); }
}
