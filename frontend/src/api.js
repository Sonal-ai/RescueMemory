import {
  searchKnowledgeLocal,
  recommendAlternativeLocal,
  recordReportLocal,
  initOfflineBrain,
  triggerAutoSync,
  onSyncStateChange,
} from './brain/offlineBrain.js';
import { getAllLocalReports, getUnsyncedReports } from './brain/offlineStorage.js';

const PREFIX = 'rescue.';

export function setting(name) {
  return sessionStorage.getItem(PREFIX + name) || '';
}

export function saveSetting(name, value) {
  sessionStorage.setItem(PREFIX + name, value.trim());
}

// Global connectivity state
let isStandaloneMobileBrain = false;
const brainStatusListeners = new Set();

export function onBrainStatusChange(cb) {
  brainStatusListeners.add(cb);
  cb(isStandaloneMobileBrain);
  return () => brainStatusListeners.delete(cb);
}

function setStandaloneMode(active) {
  if (isStandaloneMobileBrain !== active) {
    isStandaloneMobileBrain = active;
    brainStatusListeners.forEach((fn) => fn(active));
  }
}

export async function api(path, options = {}) {
  const { method = 'GET', body, admin = false, responder = false, group = false } = options;
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (admin && setting('adminKey')) headers['X-Node-Admin-Key'] = setting('adminKey');
  if (responder && setting('responderKey')) headers['X-Responder-Key'] = setting('responderKey');
  if (group && setting('groupToken')) headers['X-Group-Token'] = setting('groupToken');

  try {
    const response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    // Check if ServiceWorker intercepted with offline indicator
    if (response.status === 503 && response.headers.get('X-Rescue-Offline') === 'true') {
      throw new Error('SW_OFFLINE_INDICATOR');
    }

    let data;
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      const detail = typeof data.detail === 'string' ? data.detail : `Request failed (${response.status})`;
      throw new Error(detail);
    }

    // Network call succeeded - we are connected to edge node / hub
    setStandaloneMode(false);
    return data;
  } catch (err) {
    // Network failed or offline: activate Client-Side Offline Brain
    const isNetworkError =
      err.message === 'SW_OFFLINE_INDICATOR' ||
      err.name === 'TypeError' ||
      err.message.includes('fetch') ||
      err.message.includes('NetworkError') ||
      err.message.includes('Failed to fetch');

    if (isNetworkError) {
      setStandaloneMode(true);
      return handleOfflineFallback(path, method, body);
    }

    throw err;
  }
}

/**
 * Executes requests inside the local browser when completely disconnected.
 */
async function handleOfflineFallback(path, method, body) {
  console.log(`[OfflineAPI] Intercepting ${method} ${path} -> running in-browser brain...`);
  await initOfflineBrain();

  // 1. Local Search & Emergency Guidance
  if (path === '/api/chat') {
    const query = body?.message || body?.query || '';
    const answer = await searchKnowledgeLocal(query);
    return {
      query,
      answer,
      cards: answer.source_cards,
      local_fallback: true,
      mode: 'standalone_mobile_brain',
    };
  }

  // 2. Negative Vector Safe Facility Recommendation
  if (path === '/api/checkpoints/recommend-alternative') {
    const compromisedId = body?.compromised_id || 'cp_17';
    const hazardText = body?.avoid_hazard_text || 'flooded entrance live wires';
    const rec = await recommendAlternativeLocal(compromisedId, hazardText);
    return {
      ...rec,
      local_fallback: true,
      mode: 'standalone_mobile_brain',
    };
  }

  // 3. Save Observation / SOS report locally
  if (path === '/api/reports' && method === 'POST') {
    const saved = await recordReportLocal(body || {});
    return {
      ...saved,
      local_fallback: true,
      mode: 'standalone_mobile_brain',
    };
  }

  // 4. Entity Timeline / Checkpoint History
  if (path.startsWith('/api/entities/')) {
    const entityId = path.split('/').pop();
    const altRec = await recommendAlternativeLocal(entityId, 'flooded entrance live wires');
    return {
      entity_id: entityId,
      status: 'compromised',
      effective_status: 'compromised',
      reason: 'Reported flooded in local timeline',
      observations: [
        {
          id: `obs_${entityId}_1`,
          entity_id: entityId,
          text: 'Gate flooded and access road submerged. Exposed electrical wires.',
          observed_at: new Date(Date.now() - 3600000).toISOString(),
          source: 'Field Survivor Report',
          status: 'compromised',
        },
      ],
      alternative_recommendation: altRec,
      local_fallback: true,
    };
  }

  // 5. Nearby Map Records
  if (path === '/api/map/nearby') {
    const localReports = await getAllLocalReports();
    return {
      events: localReports,
      count: localReports.length,
      local_fallback: true,
    };
  }

  // 6. Health & Status
  if (path === '/health' || path === '/api/sync/status') {
    const unsynced = await getUnsyncedReports();
    return {
      status: 'offline',
      edge_brain: 'standalone_mobile_brain_active',
      node_id: 'survivor_phone_local',
      unsynced_reports_count: unsynced.length,
      local_fallback: true,
    };
  }

  return { local_fallback: true, detail: 'Handled by on-device offline brain' };
}

export function formatTime(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export { triggerAutoSync, onSyncStateChange };
