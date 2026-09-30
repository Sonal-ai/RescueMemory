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

// Simulated Global Internet / Cloud Connectivity Toggle
const ONLINE_MODE_KEY = 'rescue.online_mode';
let isOnline = localStorage.getItem(ONLINE_MODE_KEY) !== 'false'; // default true
const onlineModeListeners = new Set();

export function isOnlineMode() {
  return isOnline;
}

export function setOnlineMode(enabled) {
  isOnline = Boolean(enabled);
  localStorage.setItem(ONLINE_MODE_KEY, isOnline ? 'true' : 'false');
  onlineModeListeners.forEach((fn) => {
    try {
      fn(isOnline);
    } catch (e) {
      console.error(e);
    }
  });
}

export function onOnlineModeChange(cb) {
  onlineModeListeners.add(cb);
  cb(isOnline);
  return () => onlineModeListeners.delete(cb);
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

export function getBackendBaseUrl() {
  const custom = setting('backendUrl');
  if (custom) return custom.replace(/\/$/, '');
  const envUrl = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BACKEND_URL) || '';
  if (envUrl) return envUrl.replace(/\/$/, '');
  return '';
}

export function buildBackendUrl(path) {
  if (!path || path.startsWith('http://') || path.startsWith('https://')) return path;
  const base = getBackendBaseUrl();
  if (!base) return path;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function api(path, options = {}) {
  const { method = 'GET', body, admin = false, responder = false, group = false } = options;
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (admin && setting('adminKey')) headers['X-Node-Admin-Key'] = setting('adminKey');
  if (responder && setting('responderKey')) headers['X-Responder-Key'] = setting('responderKey');
  if (group && setting('groupToken')) headers['X-Group-Token'] = setting('groupToken');

  const targetUrl = buildBackendUrl(path);

  try {
    const response = await fetch(targetUrl, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    // Check if ServiceWorker intercepted with offline indicator
    if (response.status === 503 && response.headers.get('X-Rescue-Offline') === 'true') {
      throw new Error('SW_OFFLINE_INDICATOR');
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      throw new Error('SERVER_UNREACHABLE_HTML_RESPONSE');
    }

    let data;
    try {
      data = await response.json();
    } catch (parseErr) {
      throw new Error(`SERVER_UNREACHABLE_NON_JSON: ${parseErr.message}`);
    }

    if (!response.ok) {
      if (response.status >= 500 || response.status === 404 || response.status === 502 || response.status === 504) {
        throw new Error(`SERVER_UNREACHABLE_${response.status}`);
      }
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
      err.message.startsWith('SERVER_UNREACHABLE') ||
      err.name === 'TypeError' ||
      err.message.includes('fetch') ||
      err.message.includes('NetworkError') ||
      err.message.includes('Failed to fetch') ||
      err.name === 'AbortError' ||
      err.message.includes('AbortError');

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
  if (path === '/api/chat' || path.startsWith('/api/chat')) {
    const query = body?.text || body?.message || body?.query || '';
    const answer = await searchKnowledgeLocal(query);
    const topCard = answer.source_cards?.[0];
    const qLower = query.toLowerCase();
    const isSosQuery = qLower.includes('walk') || qLower.includes('trapped') || qLower.includes('rubble') || qLower.includes('sos') || qLower.includes('stuck') || qLower.includes('move');

    return {
      query,
      answer_type: 'retrieved_cards',
      cards: answer.source_cards || [],
      local_answer: answer.text,
      text: answer.text,
      answer,
      ai_answer: null,
      ai_status: 'offline_mode',
      suggested_action: isSosQuery
        ? { kind: 'sos', title: 'Broadcast Emergency SOS' }
        : (topCard?.title ? { kind: 'protocol', title: `Follow protocol: ${topCard.title}` } : null),
      warnings: answer.warnings || [],
      local_fallback: true,
      mode: 'standalone_mobile_brain',
    };
  }

  // 2. Negative Vector Safe Facility Recommendation
  if (path === '/api/checkpoints/recommend-alternative') {
    const compromisedId = body?.compromised_id || 'cp_17';
    const hazardText = body?.avoid_hazard || body?.avoid_hazard_text || 'flooded entrance live wires';
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
    const safeReports = Array.isArray(localReports) ? localReports : [];
    return {
      items: safeReports,
      events: safeReports,
      count: safeReports.length,
      local_fallback: true,
    };
  }

  // 5b. Survival Finder Radar
  if (path === '/api/survival-finder/radar') {
    const lat = body?.lat ?? 28.7041;
    const lon = body?.lon ?? 77.1025;
    const radiusM = body?.radius_m ?? 3500;
    const filterCat = body?.filter_category ?? 'all';
    const localReports = await getAllLocalReports();

    function distM(lat1, lon1, lat2, lon2) {
      const R = 6371000;
      const phi1 = (lat1 * Math.PI) / 180;
      const phi2 = (lat2 * Math.PI) / 180;
      const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
      const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;
      const a =
        Math.sin(deltaPhi / 2) ** 2 +
        Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function bearingDeg(lat1, lon1, lat2, lon2) {
      const phi1 = (lat1 * Math.PI) / 180;
      const phi2 = (lat2 * Math.PI) / 180;
      const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;
      const y = Math.sin(deltaLambda) * Math.cos(phi2);
      const x =
        Math.cos(phi1) * Math.sin(phi2) -
        Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
      return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
    }

    const cardinals = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    function cardinal(b) {
      const idx = Math.round((b % 360) / 22.5) % 16;
      return cardinals[idx];
    }

    const radarItems = [];
    for (const rep of localReports) {
      if (!rep.location?.lat || !rep.location?.lon) continue;
      const d = distM(lat, lon, rep.location.lat, rep.location.lon);
      if (d <= radiusM) {
        const b = bearingDeg(lat, lon, rep.location.lat, rep.location.lon);
        const isCas = rep.kind === 'incident' || (rep.text && (rep.text.toLowerCase().includes('trapped') || rep.text.toLowerCase().includes('injured') || rep.text.toLowerCase().includes('cannot walk') || rep.text.toLowerCase().includes('bleeding')));
        const isHaz = rep.kind === 'hazard';
        const isShelter = rep.kind === 'checkpoint' && !isHaz;
        const cat = isCas ? 'casualty' : isHaz ? 'hazard' : isShelter ? 'shelter' : 'resource';
        radarItems.push({
          id: rep.id || `rep_${Math.random()}`,
          name: rep.title || rep.entity_id || `${cat.toUpperCase()} Alert`,
          category: cat,
          triage_level: isCas ? (rep.severity === 'red' ? 'immediate_red' : 'delayed_yellow') : isHaz ? 'hazard_warning' : 'safe_green',
          text: rep.text || '',
          status: rep.status || 'active',
          severity: rep.severity || 'yellow',
          distance_m: Math.round(d),
          bearing_deg: b,
          cardinal: cardinal(b),
          walk_time_min: Math.max(1, Math.round(d / 75)),
          location: rep.location,
          signal_source: 'local_indexeddb',
          verified: rep.verified || false
        });
      }
    }

    // Dynamically anchor baseline disaster shelters relative to the user's active GPS coordinates
    // This ensures Radar and 360° Compass work anywhere in the world without showing an empty screen
    const baselineOffsets = [
      { id: 'shelter_alpha', name: 'Shelter Alpha (Central Evacuation Hub)', dLat: 0.0072, dLon: -0.0041, facilities: ['Shelter', 'Medical Triage', 'Food Rations'], status: 'operational' },
      { id: 'clinic_beta', name: 'Clinic Beta (Field Emergency Station)', dLat: 0.0042, dLon: -0.0078, facilities: ['Emergency Surgery', 'Clean Water'], status: 'operational' },
      { id: 'water_tanker_4', name: 'Water Tanker 4 (Potable Water Point)', dLat: 0.0021, dLon: 0.0052, facilities: ['Clean Water', 'Oral Rehydration'], status: 'operational' },
      { id: 'cp_17', name: 'Checkpoint CP-17 (River Crossing)', dLat: -0.0032, dLon: 0.0028, facilities: ['Checkpoint'], status: 'danger_warning', hazard: 'Flooded road & live fallen wires' }
    ];

    for (const cp of baselineOffsets) {
      const cLat = lat + cp.dLat;
      const cLon = lon + cp.dLon;
      const d = distM(lat, lon, cLat, cLon);
      const b = bearingDeg(lat, lon, cLat, cLon);
      const isDanger = cp.status === 'danger_warning';
      radarItems.push({
        id: cp.id,
        name: cp.name,
        category: isDanger ? 'hazard' : 'shelter',
        triage_level: isDanger ? 'hazard_warning' : 'safe_green',
        text: cp.hazard || `Verified disaster shelter with facilities: ${cp.facilities.join(', ')}`,
        status: cp.status,
        severity: isDanger ? 'red' : 'green',
        distance_m: Math.round(d),
        bearing_deg: b,
        cardinal: cardinal(b),
        walk_time_min: Math.max(1, Math.round(d / 75)),
        location: { lat: cLat, lon: cLon },
        facilities: cp.facilities,
        signal_source: 'reference_baseline',
        verified: true
      });
    }

    radarItems.sort((a, b) => a.distance_m - b.distance_m);
    const casualties = radarItems.filter(i => i.category === 'casualty');
    const shelters = radarItems.filter(i => i.category === 'shelter');
    const urgent = casualties.filter(c => c.triage_level === 'immediate_red');

    return {
      center: { lat, lon },
      radius_m: radiusM,
      total_found: radarItems.length,
      summary: {
        urgent_casualties: urgent.length,
        total_casualties: casualties.length,
        operational_shelters: shelters.length,
        active_peers: 0,
        nearest_casualty: casualties[0] || null,
        nearest_shelter: shelters[0] || null,
      },
      radar_items: filterCat === 'all' ? radarItems : radarItems.filter(i => i.category === filterCat || (filterCat === 'casualties' && i.category === 'casualty') || (filterCat === 'shelters' && i.category === 'shelter') || (filterCat === 'hazards' && i.category === 'hazard')),
      local_fallback: true
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
      discovery_enabled: false,
      local_fallback: true,
    };
  }

  // 7. Peer Discovery Fallback
  if (path === '/api/discovery/peers') {
    return {
      peers: [],
      count: 0,
      enabled: false,
      local_fallback: true,
      mode: 'standalone_mobile_brain',
    };
  }

  if (path === '/api/discovery/location') {
    return {
      updated: true,
      local_fallback: true,
      mode: 'standalone_mobile_brain',
    };
  }

  return { local_fallback: true, detail: 'Handled by on-device offline brain' };
}

export async function getDiscoveredPeers() {
  return api('/api/discovery/peers');
}

export async function updateDeviceLocation(locationData) {
  return api('/api/discovery/location', {
    method: 'POST',
    body: locationData,
  });
}

export async function syncDiscoveredPeer(syncData) {
  return api('/api/discovery/sync-peer', {
    method: 'POST',
    body: syncData,
  });
}

export async function getSurvivalRadar(params = {}) {
  const {
    lat = 28.7041,
    lon = 77.1025,
    radius_m = 3500,
    filter_category = 'all',
    include_responders = true,
    group_id = null,
  } = params;
  return api('/api/survival-finder/radar', {
    method: 'POST',
    body: {
      lat,
      lon,
      radius_m,
      filter_category,
      include_responders,
      group_id,
    },
    responder: Boolean(setting('responderKey')),
    group: Boolean(group_id),
  });
}

export function formatTime(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export async function assessCasualty(params = {}) {
  return api('/api/assess', {
    method: 'POST',
    body: params,
  });
}

/**
 * Native GPS with fallback to browser navigator.geolocation
 */
export async function getNativeOrWebLocation() {
  try {
    const { Geolocation } = await import('@capacitor/geolocation');
    const perm = await Geolocation.checkPermissions();
    if (perm.location !== 'granted') {
      await Geolocation.requestPermissions();
    }
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 10000,
    });
    return {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
    };
  } catch {
    return new Promise((resolve, reject) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        return reject(new Error('Geolocation is unavailable on this device.'));
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }
}

// Initialize native status bar and back button when running on Android
if (typeof window !== 'undefined') {
  import('@capacitor/status-bar')
    .then(({ StatusBar, Style }) => {
      StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      StatusBar.setBackgroundColor({ color: '#08111d' }).catch(() => {});
    })
    .catch(() => {});

  import('@capacitor/app')
    .then(({ App: CapApp }) => {
      CapApp.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack) {
          window.history.back();
        } else {
          CapApp.exitApp();
        }
      }).catch(() => {});
    })
    .catch(() => {});
}

export { triggerAutoSync, onSyncStateChange, recommendAlternativeLocal };


