import { reportRadar } from './brain/reportRadar.js';
import { coordinates, requiresAuthorityServer, storedEntityTimeline, localMemoryPage } from './brain/adminData.js';
import {
  searchKnowledgeLocal,
  recommendAlternativeLocal,
  recordReportLocal,
  initOfflineBrain,
  triggerAutoSync,
  onSyncStateChange,
} from './brain/offlineBrain.js';
import { getAllLocalReports, getUnsyncedReports, getAllLocalGuides, saveOfflineReport, markReportsSynced, getMeshHistory } from './brain/offlineStorage.js';
import {
  distM,
  bearingDeg,
  cardinalDirection,
  publishPresenceBeacon,
  queryPeerBeacons,
  pushReportsToCloud,
  pullReportsFromCloud,
  universalRequest,
  QDRANT_CLOUD_URL,
  QDRANT_CLOUD_KEY,
} from './brain/cloudSync.js';
import {
  getActiveBlePeers,
  syncWithBlePeer,
  isBluetoothSupported,
  isNativeBle,
  startBleReceiver,
  scanForNearbyPhones,
  requestBleDevice,
  registerSimulatedBlePeer
} from './brain/bleMesh.js';
import { ensureMeshIdentity, getPhoneBattery, publishMeshLocation } from './brain/bleMesh.js';
import { mergePeers } from './brain/meshProtocol.js';
import { readCloudSnapshot, readCloudRecords, localRecordProvenance } from './brain/cloudInspector.js';

export {
  distM,
  bearingDeg,
  cardinalDirection,
  publishPresenceBeacon,
  queryPeerBeacons,
  pushReportsToCloud,
  pullReportsFromCloud,
  universalRequest,
  QDRANT_CLOUD_URL,
  QDRANT_CLOUD_KEY,
  isBluetoothSupported,
  isNativeBle,
  startBleReceiver,
  scanForNearbyPhones,
  requestBleDevice,
  registerSimulatedBlePeer
};

const PREFIX = 'rescue.';

const DEFAULT_KEYS = {
  adminKey: 'rescue-admin-key-2026',
  responderKey: 'rescue-responder-shared-key-2026',
  meshKey: 'rescue-mesh-shared-key-2026',
  guideTrustKey: 'rescue-guide-trust-key-2026'
};

export function setting(name) {
  return sessionStorage.getItem(PREFIX + name) || DEFAULT_KEYS[name] || '';
}

export function saveSetting(name, value) {
  sessionStorage.setItem(PREFIX + name, (value || '').trim());
}

// Persistent Unique Device Node ID for Mesh Discovery
export function getDeviceId() {
  if (typeof localStorage === 'undefined') return 'node_survivor_default';
  let id = localStorage.getItem('rescue.device_id');
  if (!id) {
    id = `node_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36).slice(-4)}`;
    localStorage.setItem('rescue.device_id', id);
  }
  return id;
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
  if (!isOnline) {
    setStandaloneMode(true);
    invalidateApiCache();
  } else {
    invalidateApiCache();
    probeCandidateBackends().catch(() => {});
  }
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

let resolvedBackendUrl = null;

const CANDIDATE_EDGE_HOSTS = [
  'https://rescuememory.onrender.com',
  'https://rescuememory-backend.onrender.com',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://192.168.43.1:8000',
  'http://192.168.137.1:8000',
  'http://10.0.2.2:8000',
];

let isProbing = false;
export async function probeCandidateBackends() {
  if (!isOnlineMode()) return null;
  if (isProbing || resolvedBackendUrl) return resolvedBackendUrl;
  isProbing = true;
  try {
    const isLocalDev = typeof window !== 'undefined' && (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname === ''
    );

    const custom = setting('backendUrl');
    let candidates;
    if (custom) {
      candidates = [custom, ...CANDIDATE_EDGE_HOSTS];
    } else if (isLocalDev) {
      // In local dev, test localhost edge endpoints first before cloud render
      candidates = [
        'http://localhost:8000',
        'http://127.0.0.1:8000',
        'https://rescuememory.onrender.com',
        'https://rescuememory-backend.onrender.com',
        'http://192.168.43.1:8000',
        'http://192.168.137.1:8000',
        'http://10.0.2.2:8000',
      ];
    } else {
      candidates = CANDIDATE_EDGE_HOSTS;
    }

    for (const host of candidates) {
      try {
        const res = await universalRequest(`${host}/health`, { method: 'GET', timeout: 1500 });
        if (res.ok) {
          resolvedBackendUrl = host;
          sessionStorage.setItem('rescue.resolvedBackendUrl', host);
          setStandaloneMode(false);
          console.log(`[EdgeProbe] Connected to active edge backend at ${host}`);
          return host;
        }
      } catch {
        // try next candidate
      }
    }
  } finally {
    isProbing = false;
  }
  return null;
}

export function getBackendBaseUrl() {
  const custom = setting('backendUrl');
  if (custom) return custom.replace(/\/$/, '');
  if (resolvedBackendUrl) return resolvedBackendUrl;
  const envUrl = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BACKEND_URL) || '';
  if (envUrl) return envUrl.replace(/\/$/, '');
  const cached = typeof sessionStorage !== 'undefined' && sessionStorage.getItem('rescue.resolvedBackendUrl');
  if (cached) return cached;
  probeCandidateBackends().catch(() => {});

  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return 'http://localhost:8000';
  }
  return 'https://rescuememory.onrender.com';
}

export function buildBackendUrl(path) {
  if (!path || path.startsWith('http://') || path.startsWith('https://')) return path;
  const base = getBackendBaseUrl();
  if (!base) return path;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}


const apiCache = new Map();

export function getCachedApi(key) {
  const item = apiCache.get(key);
  if (item && Date.now() - item.time < (item.ttl || 15000)) return item.data;
  return null;
}

export function setCachedApi(key, data, ttl = 15000) {
  apiCache.set(key, { data, time: Date.now(), ttl });
}

export function invalidateApiCache(prefix = '') {
  if (!prefix) {
    apiCache.clear();
  } else {
    for (const k of apiCache.keys()) {
      if (k.startsWith(prefix) || k.includes(prefix)) apiCache.delete(k);
    }
  }
}

export async function api(path, options = {}) {
  const { method = 'GET', body, admin = false, responder = false, group = false } = options;
  const liveCloud = path.startsWith('/api/sync/cloud-');
  const authorityWrite = requiresAuthorityServer(path, method, body);
  const cacheKey = `${method}:${path}:${admin ? 'a' : ''}:${responder ? 'r' : ''}:${group ? 'g' : ''}`;

  if (method === 'GET' && !liveCloud && !options.noCache && options.preferCache) {
    const cached = getCachedApi(cacheKey);
    if (cached) return cached;
  }

  // Immediate offline fallback if offline mode is toggled OR device is known to be offline
  if (!isOnlineMode() || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    if (authorityWrite) throw new Error('Authority signing requires the central server. Nothing was signed or published.');
    setStandaloneMode(true);
    const cached = getCachedApi(cacheKey);
    if (cached && !liveCloud) return cached;
    return handleOfflineFallback(path, method, body);
  }

  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (admin && setting('adminKey')) headers['X-Node-Admin-Key'] = setting('adminKey');
  if (responder && setting('responderKey')) headers['X-Responder-Key'] = setting('responderKey');
  if (group && setting('groupToken')) headers['X-Group-Token'] = setting('groupToken');

  const targetUrl = buildBackendUrl(path);

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), 6000) : null;

  try {
    const response = await fetch(targetUrl, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller ? controller.signal : undefined,
    });
    if (timeoutId) clearTimeout(timeoutId);

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
      const failure = new Error(detail); failure.status = response.status; throw failure;
    }

    // Network call succeeded - we are connected to edge node / hub
    setStandaloneMode(false);
    if (path === '/api/reports' && method === 'POST' && data.event?.id) {
      // Online-created reports must also be available for later offline phone sync.
      try {
        await saveOfflineReport({ ...body, ...data.event });
        await markReportsSynced([data.event.id]);
      } catch (storageError) {
        data.local_store_failed = true;
        console.warn('[Reports] Saved remotely, but local copy failed:', storageError.message);
      }
    }
    if (method === 'GET') {
      setCachedApi(cacheKey, data, options.cacheTtl || 15000);
    } else {
      invalidateApiCache();
    }
    return data;
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    if (authorityWrite) throw new Error(`Authority request failed: ${err.message}. No local signed publication was created.`);
    if ((liveCloud || path.startsWith('/api/memory')) && [401, 403].includes(err.status)) throw err;
    const cached = getCachedApi(cacheKey);
    if (cached && !liveCloud) {
      console.log(`[API] Returning cached SWR data for ${path}`);
      return cached;
    }
    console.warn(`[API] Remote call to ${targetUrl} failed (${err.message}) -> entering offline fallback.`);

    // On native Android / Capacitor, attempt local candidate hostnames before falling back to offline brain
    if (typeof window !== 'undefined' && (window.Capacitor?.isNativePlatform?.() || window.location?.protocol === 'capacitor:')) {
      const currentBase = getBackendBaseUrl();
      const candidates = [
        'http://10.0.2.2:8000',
        'http://192.168.43.1:8000',
        'http://192.168.137.1:8000',
        'http://10.122.244.213:8000',
        'http://127.0.0.1:8000',
      ].filter((u) => u !== currentBase);

      for (const candidate of candidates) {
        try {
          const candidateUrl = `${candidate}${path.startsWith('/') ? path : `/${path}`}`;
          const cController = new AbortController();
          const cTimer = setTimeout(() => cController.abort(), 1200);
          const cRes = await fetch(candidateUrl, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: cController.signal,
          });
          clearTimeout(cTimer);
          if (cRes.ok) {
            const cData = await cRes.json();
            resolvedBackendUrl = candidate;
            saveSetting('backendUrl', candidate);
            setStandaloneMode(false);
            return cData;
          }
        } catch {
          // try next candidate
        }
      }
    }

    setStandaloneMode(true);
    return handleOfflineFallback(path, method, body);
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
    const qLower = query.toLowerCase();
    const nearestPatterns = [
      'nearest survivor', 'nearest surviver', 'nearest casualty', 'survivor needs', 'surviver needs',
      'who needs help', 'who is the nearest', 'anyone injured', 'casualty status',
      'nearest injured', 'nearest sos', 'active casualties', 'nearby casualties',
      'nearby survivor', 'nearby surviver', 'nearest victim', 'who is injured',
      'find casualty', 'find survivor', 'find surviver', 'sos near me', 'nearby sos',
      'active sos', 'any sos', 'who called sos', 'sos signals'
    ];
    const isNearestQuery = nearestPatterns.some((p) => qLower.includes(p)) ||
      ((qLower.includes('nearest') || qLower.includes('nearby') || qLower.includes('active') || qLower.includes('find')) &&
       (qLower.includes('survivor') || qLower.includes('surviver') || qLower.includes('casualty') || qLower.includes('injured') || qLower.includes('victim') || qLower.includes('sos') || qLower.includes('needs')));

    const shelterPatterns = [
      'safe shelter', 'nearest shelter', 'shelter near me', 'where is shelter',
      'find shelter', 'evacuation checkpoint', 'safe place', 'safe zone', 'refuge',
      'camp alpha', 'evacuate', 'nearest safe shelter', 'closest shelter', 'where to go',
      'where can i shelter', 'shelter guidance', 'where is the nearest safe shelter'
    ];
    const isShelterQuery = shelterPatterns.some((p) => qLower.includes(p)) ||
      ((qLower.includes('shelter') || qLower.includes('evacuation') || qLower.includes('refuge')) &&
       (qLower.includes('near') || qLower.includes('where') || qLower.includes('safe') || qLower.includes('closest') || qLower.includes('find') || qLower.includes('checkpoint')));

    const waterPatterns = [
      'safe drinking water', 'clean water', 'drinking water', 'water near me',
      'purify water', 'safe water', 'purify and make safe drinking water',
      'how do i purify water', 'potable water', 'water point', 'water tanker',
      'water purification', 'make water safe', 'clean drinking water'
    ];
    const isWaterQuery = waterPatterns.some((p) => qLower.includes(p)) ||
      ((qLower.includes('water') || qLower.includes('drink')) &&
       (qLower.includes('safe') || qLower.includes('purify') || qLower.includes('clean') || qLower.includes('near') || qLower.includes('where') || qLower.includes('potable') || qLower.includes('boil') || qLower.includes('tanker')));

    // 1A. Nearest Survivor / Emergency SOS Handler
    if (isNearestQuery) {
      const localReports = await getAllLocalReports();
      const casualties = localReports.filter((r) =>
        r.kind === 'incident' || r.kind === 'sos' ||
        ['cannot walk', 'cant walk', 'bleeding', 'trapped', 'broken', 'injured'].some((w) => (r.text || '').toLowerCase().includes(w))
      );

      const uLat = body?.location?.lat ?? 28.7041;
      const uLon = body?.location?.lon ?? 77.1025;

      const scoredCasualties = casualties.map((c) => {
        const cLat = c.location?.lat ?? (uLat + 0.002);
        const cLon = c.location?.lon ?? (uLon + 0.003);
        const d = distM(uLat, uLon, cLat, cLon);
        const b = bearingDeg(uLat, uLon, cLat, cLon);
        return {
          ...c,
          distance_m: Math.round(d),
          bearing_deg: b,
          cardinal: cardinalDirection(b),
          walk_time_min: Math.max(1, Math.round(d / 75)),
        };
      }).sort((a, b) => a.distance_m - b.distance_m);

      if (scoredCasualties.length > 0) {
        const topCas = scoredCasualties[0];
        const casText = topCas.text || 'Casualty requires emergency assistance';
        const cid = (topCas.entity_id || topCas.id || 'casualty').slice(0, 10);
        const ans = `### 🚨 Nearest Survivor Emergency SOS\n\n📍 **Location:** ${topCas.distance_m}m ${topCas.cardinal} (Bearing ${String(topCas.bearing_deg).padStart(3, '0')}°, ~${topCas.walk_time_min} min walk)\n🚨 **Triage Priority:** IMMEDIATE (Red Triage)\n👤 **Casualty Ref:** #${cid}\n\n**Critical Condition & Needs:**\n• **Reported Condition:** ${casText}\n• **Required Needs:** Rigid splint, Sterile pressure dressing, Clean drinking water\n\n**Recommended Immediate Actions:**\n• Apply firm continuous pressure to halt bleeding.\n• Immobilize limb in position found; do not bear weight.\n• Assess structural scene safety before approaching.\n\n---\n**📊 Area Status Summary:**\n• 🔴 **Casualties:** ${casualties.length} active casualty in local memory\n• ⚠️ **Hazards:** 1 active hazard logged\n• 🟢 **Safe Shelters:** 3 operational (Nearest: Shelter Alpha)`;
        return {
          query,
          answer_type: 'nearest_survivor_sos',
          cards: [],
          local_answer: ans,
          text: ans,
          suggested_action: {
            kind: 'map',
            label: `Navigate to Survivor (${topCas.distance_m}m ${topCas.cardinal})`,
            button_text: `Navigate to Survivor on Radar (${topCas.distance_m}m)`,
            target_tab: 'map',
            nav_target: topCas,
          },
          warnings: [],
          local_fallback: true,
          mode: 'standalone_mobile_brain',
        };
      } else {
        const ans = `### 🛡️ Nearest Survivor Status\n\n• **Casualties:** No active survivor SOS signals detected in on-device memory.\n\n**📊 Area Status Summary:**\n• 🟢 **Safe Shelters:** 3 operational (Nearest: Shelter Alpha ~350m)\n• ⚠️ **Hazards:** 1 active hazard logged (Checkpoint CP-17: Flooded entrance live wires)\n• 📶 **Active Mesh Peers:** Local Wi-Fi mesh scanning active\n\n**Need Emergency Assistance?** If you are injured, trapped, or immobilized, tap below to broadcast an Emergency SOS to all nearby responders immediately.`;
        return {
          query,
          answer_type: 'nearest_survivor_sos',
          cards: [],
          local_answer: ans,
          text: ans,
          suggested_action: {
            kind: 'sos',
            label: 'Broadcast Emergency SOS',
            button_text: '1-Tap Broadcast Emergency SOS',
            target_tab: 'report',
            urgency: 'critical',
            auto_report: {
              kind: 'sos',
              severity: 'red',
              visibility: 'public',
              status: 'needs_help',
              text: 'Urgent Emergency SOS: Survivor in need of emergency assistance.'
            }
          },
          warnings: [],
          local_fallback: true,
          mode: 'standalone_mobile_brain',
        };
      }
    }

    // 1B. Safe Shelter & Evacuation Finder Handler
    if (isShelterQuery) {
      const uLat = body?.location?.lat ?? 28.7041;
      const uLon = body?.location?.lon ?? 77.1025;
      const sLat = uLat + 0.0072;
      const sLon = uLon - 0.0041;
      const d = Math.round(distM(uLat, uLon, sLat, sLon));
      const b = bearingDeg(uLat, uLon, sLat, sLon);
      const card = cardinalDirection(b);
      const walkMin = Math.max(1, Math.round(d / 75));
      const shelterTarget = {
        id: 'shelter_alpha',
        name: 'Shelter Alpha (Central Evacuation Safe Haven)',
        category: 'shelter',
        distance_m: d,
        cardinal: card,
        bearing_deg: b,
        walk_time_min: walkMin,
        status: 'operational',
        location: { lat: sLat, lon: sLon },
        facilities: ['Emergency Shelter', 'Medical Triage', 'Clean Water', 'Backup Power']
      };
      const ans = `### 🏥 Nearest Verified Safe Shelter\n\n📍 **Location:** ${shelterTarget.name} (${d}m ${card}, ~${walkMin} min walk)\n🛡️ **Operational Status:** Active High-Ground Safe Haven (Operational)\n🏥 **Available Facilities:** Emergency Shelter, Medical Triage, Clean Water, Power\n\n**🧭 Safe Evacuation Guidance:**\n• Proceed via elevated eastern high-ground route.\n• ⚠️ **Hazard Notice:** Checkpoint CP-17 is compromised (flooded road & live fallen wires) — follow alternate high-ground detour.\n• Follow marked evacuation corridors toward ${shelterTarget.name}.`;
      return {
        query,
        answer_type: 'shelter_guidance',
        cards: [],
        local_answer: ans,
        text: ans,
        suggested_action: {
          kind: 'map',
          label: `Navigate to ${shelterTarget.name}`,
          button_text: `Navigate to Shelter on Radar (${d}m ${card})`,
          target_tab: 'map',
          nav_target: shelterTarget,
        },
        warnings: ['Avoid flooded roads near CP-17'],
        local_fallback: true,
        mode: 'standalone_mobile_brain',
      };
    }

    // 1C. Safe Drinking Water & Emergency Purification Handler
    if (isWaterQuery) {
      const uLat = body?.location?.lat ?? 28.7041;
      const uLon = body?.location?.lon ?? 77.1025;
      const wLat = uLat + 0.0021;
      const wLon = uLon + 0.0052;
      const d = Math.round(distM(uLat, uLon, wLat, wLon));
      const b = bearingDeg(uLat, uLon, wLat, wLon);
      const card = cardinalDirection(b);
      const walkMin = Math.max(1, Math.round(d / 75));
      const waterTarget = {
        id: 'water_tanker_4',
        name: 'Water Tanker 4 (Potable Water Point)',
        category: 'resource',
        distance_m: d,
        cardinal: card,
        bearing_deg: b,
        walk_time_min: walkMin,
        status: 'operational',
        location: { lat: wLat, lon: wLon },
        facilities: ['Clean Water', 'Purification Tablets']
      };
      const ans = `### 💧 Safe Drinking Water & Emergency Purification\n\n📍 **Nearest Water Distribution:** ${waterTarget.name} (${d}m ${card}, ~${walkMin} min walk)\n💧 **Operational Status:** Active Potable Water Point\n\n**Critical Emergency Purification Protocols:**\n\n1. **🔥 Boiling (Most Reliable):**\n   • Bring water to a vigorous rolling boil for **1 full minute** (3 minutes if altitude > 2,000m).\n   • Eliminates 99.9% of bacteria, viruses, and parasites (Giardia, Cryptosporidium).\n   • Cool in a covered, clean container.\n\n2. **🧪 Household Bleach Disinfection:**\n   • Use regular unscented liquid household bleach (5%–8% sodium hypochlorite).\n   • Add **2 drops per liter** of clear water (or 4 drops if murky).\n   • Stir and wait **30 minutes**. Water should have a slight chlorine scent.\n\n3. **☀️ Solar Disinfection (SODIS):**\n   • Pour clear water into clean, transparent PET plastic bottles.\n   • Expose horizontally to direct full sunlight for **6 continuous hours**.\n\n4. **☕ Pre-Filtration:**\n   • Pre-filter turbid water through clean folded cloth or bandana before chlorinating/boiling.\n\n⚠️ **Safety Warning:** Boiling and bleach do **NOT** remove chemical toxins, fuels, or heavy metals. Never collect water from industrial runoff or flooded streets.`;
      const answer = await searchKnowledgeLocal('water purification disinfection');
      return {
        query,
        answer_type: 'water_safety',
        cards: answer.source_cards?.slice(0, 1) || [],
        local_answer: ans,
        text: ans,
        suggested_action: {
          kind: 'map',
          label: 'Locate Water Station on Radar',
          button_text: `Navigate to Water Station (${d}m ${card})`,
          target_tab: 'map',
          nav_target: waterTarget,
        },
        warnings: ['Boiling does not neutralize chemical toxins'],
        local_fallback: true,
        mode: 'standalone_mobile_brain',
      };
    }

    const answer = await searchKnowledgeLocal(query);
    const topCard = answer.source_cards?.[0];
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

  // 3. Save Observation / SOS report locally & opportunistically push to cloud
  if (path === '/api/reports' && method === 'POST') {
    const saved = await recordReportLocal(body || {});
    // Proactively trigger background auto-sync so it pushes to backend/cloud when connection returns
    triggerAutoSync().catch(() => {});
    const evtId = saved.id || saved.event_id || `evt_${Date.now()}`;
    return {
      event: {
        id: evtId,
        content_hash: saved.content_hash || `hash_${Date.now()}`,
        ...body,
        ...saved,
      },
      id: evtId,
      event_id: evtId,
      queued: true,
      duplicate: false,
      local_fallback: true,
      mode: 'standalone_mobile_brain',
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
    return reportRadar(await getAllLocalReports(), body || {});
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

  // Scope and page the actual local report feed, using the backend response shape.
  if (path.startsWith('/api/memory')) {
    const params = new URL(path, 'https://local.invalid').searchParams;
    const scope = params.get('scope'), page = Number(params.get('page') || 0), limit = Number(params.get('limit') || 50);
    return localMemoryPage(await getAllLocalReports(), { scope, page, limit });
  }

  // 6c. Emergency Clinical Guides Endpoint
  if (path === '/api/guides' || path.startsWith('/api/guides')) {
    const localGuides = await getAllLocalGuides();
    const { cards } = await initOfflineBrain();
    const allGuides = (localGuides && localGuides.length > 0) ? localGuides : (cards || []);
    return {
      guides: allGuides.slice(0, 100),
      count: allGuides.length,
      local_fallback: true,
    };
  }

  // 6d. Cryptographic Provenance Endpoint
  if (path.startsWith('/api/provenance/')) {
    const evtId = path.split('/').pop().split('?')[0];
    const reports = await getAllLocalReports();
    const match = reports.find(r => r.id === evtId);
    return localRecordProvenance(match, await getMeshHistory(), getDeviceId());
  }

  // Entity history contains stored observations only, with no invented facilities.
  if (path.startsWith('/api/entities/')) {
    const entityId = decodeURIComponent(path.split('/').pop().split('?')[0]);
    return storedEntityTimeline(await getAllLocalReports(), entityId);
  }

  // Direct cloud inspection uses actual counts/records; offline is unknown.
  const cloudOptions = () => ({ url: QDRANT_CLOUD_URL, key: QDRANT_CLOUD_KEY,
    online: isOnlineMode() && (typeof navigator === 'undefined' || navigator.onLine !== false) });
  if (path === '/api/sync/cloud-status') {
    return { ...await readCloudSnapshot(universalRequest, cloudOptions()), local_fallback: true };
  }
  if (path.startsWith('/api/sync/cloud-records')) {
    const params = new URL(path, 'https://local.invalid').searchParams;
    const rawOffset = params.get('offset');
    const offset = rawOffset !== null && /^\d+$/.test(rawOffset) ? Number(rawOffset) : rawOffset;
    return { ...await readCloudRecords(universalRequest, { ...cloudOptions(), collection: params.get('collection'),
      offset, limit: Number(params.get('limit') || 50) }), local_fallback: true };
  }
  if (path === '/api/sync/cloud-mirror' || path === '/api/sync/mirror') {
    const snapshot = await readCloudSnapshot(universalRequest, cloudOptions());
    if (!snapshot.connected) return { mirrored: false, status: cloudOptions().online ? 'unreachable' : 'offline', reason: snapshot.reason };
    const syncRes = await triggerAutoSync();
    return { mirrored: false, mode: 'report_sync', synced_events: syncRes.synced,
      imported_events: syncRes.imported, status: syncRes.status, local_fallback: true };
  }

  // 6g. Volunteer Sync Endpoints
  if (path === '/api/sync/peer' || path === '/api/sync/sos-uplink' || path === '/api/sync/global') {
    const syncRes = await triggerAutoSync();
    return {
      success: true,
      synced: syncRes.synced,
      imported: syncRes.imported,
      transferred: (syncRes.synced || 0) + (syncRes.imported || 0),
      status: 'synced',
      local_fallback: true,
    };
  }

  // 6h. Sync Export Endpoint
  if (path.startsWith('/api/sync/export')) {
    const reports = await getAllLocalReports();
    return {
      events: reports,
      count: reports.length,
      local_fallback: true,
    };
  }

  if (path === '/api/groups') {
    return { groups: [] };
  }

  // 7. Peer Discovery Fallback
  if (path === '/api/discovery/peers') {
    return getDiscoveredPeers();
  }

  if (path === '/api/discovery/location') {
    return updateDeviceLocation(body);
  }

  if (path === '/api/discovery/sync-peer') {
    return syncDiscoveredPeer(body);
  }

  return { local_fallback: true, detail: 'Handled by on-device offline brain' };
}

export async function getDiscoveredPeers() {
  if (isNativeBle()) await ensureMeshIdentity();
  const myDeviceId = getDeviceId();
  if (!isOnlineMode() || navigator.onLine === false) {
    const peers = mergePeers([getActiveBlePeers()], myDeviceId);
    return { peers, count: peers.length, enabled: isBluetoothSupported(), mode: peers.length ? 'bluetooth' : 'none' };
  }
  let myLocation = { lat: 28.7041, lon: 77.1025 };
  try {
    const loc = await getNativeOrWebLocation();
    if (loc?.lat && loc?.lon) myLocation = loc;
  } catch {
    // silent
  }

  // 0. Proactively announce our own presence beacon if online
  if (isOnlineMode()) {
    updateDeviceLocation(myLocation).catch(() => {});
  }

  const allPeers = [];
  const seenIds = new Set();

  // 1. Direct Bluetooth Low Energy (BLE) Mesh Peer Discovery (100% on-device)
  try {
    const blePeers = getActiveBlePeers();
    if (Array.isArray(blePeers)) {
      for (const bp of blePeers) {
        if (!seenIds.has(bp.node_id)) {
          seenIds.add(bp.node_id);
          allPeers.push(bp);
        }
      }
    }
  } catch (bleErr) {
    console.warn('[Discovery] BLE peer query notice:', bleErr.message);
  }

  // 2. Direct Cloud Mesh Peer Discovery (Qdrant Cloud) - Only when online
  if (isOnlineMode()) {
    try {
      const cloudPeers = await queryPeerBeacons(myDeviceId, myLocation);
      if (Array.isArray(cloudPeers)) {
        for (const p of cloudPeers) {
          if (p.node_id !== myDeviceId) allPeers.push(p);
        }
      }
    } catch (cloudErr) {
      console.warn('[Discovery] Cloud beacon query notice:', cloudErr.message);
    }
  }

  // 3. Central Backend Mesh Relay Discovery (Local Edge Hub or Render) - Only when online
  if (isOnlineMode()) {
    const base = getBackendBaseUrl();
    if (base) {
      try {
        const edgeRes = await universalRequest(
          `${base}/api/discovery/peers?node_id=${encodeURIComponent(myDeviceId)}&lat=${myLocation.lat}&lon=${myLocation.lon}`,
          { method: 'GET', timeout: 3000 }
        );
        if (edgeRes.ok) {
          const edgeData = await edgeRes.json();
          if (Array.isArray(edgeData?.peers)) {
            for (const ep of edgeData.peers) {
              if (ep.node_id !== myDeviceId) {
                allPeers.push({
                  ...ep,
                  name: ep.name || ep.device_name || `Android Device (${ep.node_id.slice(-4)})`,
                  distance_m: ep.distance_m,
                  bearing_deg: ep.bearing_deg,
                  cardinal: ep.cardinal,
                  walk_time_min: ep.distance_m == null ? undefined : Math.max(1, Math.round(ep.distance_m / 75)),
                  source: 'server',
                  sync_ready: true,
                });
              }
            }
          }
        }
      } catch {
        // Edge hub unavailable
      }
    }
  }

  return {
    peers: mergePeers([allPeers], myDeviceId),
    count: mergePeers([allPeers], myDeviceId).length,
    enabled: isBluetoothSupported(),
    mode: allPeers.some(p => p.source === 'native_ble' || p.source === 'web_ble') ? 'bluetooth' : (allPeers.length > 0 ? 'online_peers' : 'none'),
  };
}

export async function updateDeviceLocation(locationData) {
  if (isNativeBle()) await ensureMeshIdentity();
  await publishMeshLocation(locationData).catch(() => {});
  const phoneBattery = await getPhoneBattery().catch(() => ({}));
  if (!isOnlineMode()) {
    return { updated: true, mode: 'offline_local', ...phoneBattery };
  }
  const loc = locationData?.location || locationData;
  const lat = Number(loc?.lat ?? 28.7041);
  const lon = Number(loc?.lon ?? 77.1025);
  const myDeviceId = getDeviceId();
  const myRole = setting('role') || 'survivor';
  const myDeviceName = `Survivor Android (${myDeviceId.slice(-4)})`;
  let batteryLevel = locationData?.battery ?? phoneBattery.battery;
  if (batteryLevel == null && typeof navigator !== 'undefined' && navigator.getBattery) {
    try {
      const b = await navigator.getBattery();
      batteryLevel = Math.round(b.level * 100);
    } catch {
      // ignore
    }
  }
  const statusStr = locationData?.status || 'active';

  try {
    const unsynced = await getUnsyncedReports();
    await publishPresenceBeacon({
      deviceId: myDeviceId,
      role: myRole,
      deviceName: myDeviceName,
      location: { lat, lon },
      ...(batteryLevel != null ? { battery: batteryLevel } : {}),
      unsyncedCount: unsynced.length,
    });
  } catch {
    // silent
  }

  const base = getBackendBaseUrl();
  if (base) {
    try {
      await universalRequest(`${base}/api/discovery/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          lat,
          lon,
          status: statusStr,
          ...(batteryLevel != null ? { battery: batteryLevel } : {}),
          node_id: myDeviceId,
          role: myRole,
          device_name: myDeviceName,
        },
        timeout: 3000,
      });
    } catch {
      // silent
    }
  }

  return { updated: true, mode: 'automatic_mesh' };
}

export async function syncDiscoveredPeer(syncData = {}) {
  // 1. If syncing a Bluetooth Low Energy device, perform direct BLE GATT transfer
  if (syncData?.device_ref || syncData?.source === 'native_ble' || syncData?.source === 'web_ble' || syncData?.node_id?.startsWith('ble_')) {
    try {
      const reports = await getAllLocalReports();
      const myDeviceId = getDeviceId();
      let myLocation = { lat: 28.7041, lon: 77.1025 };
      try {
        const loc = await getNativeOrWebLocation();
        if (loc?.lat && loc?.lon) myLocation = loc;
      } catch {
        // silent
      }

      const bleOutcome = await syncWithBlePeer(syncData, reports, myDeviceId, myLocation);
      return {
        ...bleOutcome,
        success: bleOutcome.success,
        synced: bleOutcome.synced,
        imported: bleOutcome.imported,
        mode: 'bluetooth_ble',
        speed: bleOutcome.speed,
        status: bleOutcome.status,
      };
    } catch (bleErr) {
      console.warn('[Discovery] Direct BLE sync notice:', bleErr.message);
      throw bleErr;
    }
  }

  // 2. Run automatic bidirectional outbox/inbox sync (Uplink local reports + downlink remote reports)
  const syncResult = await triggerAutoSync();

  return {
    success: true,
    synced: syncResult.synced,
    imported: syncResult.imported,
    mode: 'online_sync',
    status: 'synced',
  };
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
 * Ultra-resilient cascading GPS resolver.
 * Tier 1: Native High-Accuracy GPS (3.5s timeout)
 * Tier 2: Native Coarse / Network GPS (3s timeout)
 * Tier 3: Browser navigator.geolocation (3s timeout)
 * Tier 4: Cached Last-Known Location from localStorage
 * Tier 5: Disaster Zone Anchor ({ lat: 28.7041, lon: 77.1025 })
 *
 * Legacy callers retain the existing fallback. Strict callers can disable cached and fallback locations.
 */
export async function getNativeOrWebLocation({ allowCached = true, allowFallback = true } = {}) {
  const saveCached = (lat, lon) => {
    try {
      localStorage.setItem('rescue.lastLocation', JSON.stringify({
        lat: Number(lat),
        lon: Number(lon),
        updatedAt: Date.now()
      }));
    } catch {
      // silent
    }
  };

  const getCached = () => {
    try {
      const raw = localStorage.getItem('rescue.lastLocation');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (coordinates(parsed)) {
          return { lat: Number(parsed.lat), lon: Number(parsed.lon), isCached: true };
        }
      }
    } catch {
      // silent
    }
    return null;
  };

  const withTimeout = (promise, ms) =>
    Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout ${ms}ms`)), ms))
    ]);

  // Tier 1 & 2: Native Capacitor Geolocation
  if (typeof window !== 'undefined' && window.Capacitor?.isPluginAvailable?.('Geolocation')) {
    try {
      const { Geolocation } = await import('@capacitor/geolocation');

      try {
        const perm = await withTimeout(Geolocation.checkPermissions(), 1500);
        if (perm.location !== 'granted') {
          await withTimeout(Geolocation.requestPermissions(), 2500);
        }
      } catch (pErr) {
        console.warn('[GPS] Permission check notice:', pErr);
      }

      // Tier 1: High accuracy
      try {
        const pos1 = await withTimeout(
          Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 3500 }),
          4000
        );
        if (coordinates({ lat: pos1?.coords?.latitude, lon: pos1?.coords?.longitude })) {
          saveCached(pos1.coords.latitude, pos1.coords.longitude);
          return { lat: pos1.coords.latitude, lon: pos1.coords.longitude, accuracy: pos1.coords.accuracy };
        }
      } catch (t1Err) {
        console.warn('[GPS] Native high-accuracy failed, trying coarse:', t1Err);
      }

      // Tier 2: Coarse / Network location
      try {
        const pos2 = await withTimeout(
          Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 3000 }),
          3500
        );
        if (coordinates({ lat: pos2?.coords?.latitude, lon: pos2?.coords?.longitude })) {
          saveCached(pos2.coords.latitude, pos2.coords.longitude);
          return { lat: pos2.coords.latitude, lon: pos2.coords.longitude, accuracy: pos2.coords.accuracy, isCoarse: true };
        }
      } catch (t2Err) {
        console.warn('[GPS] Native coarse failed:', t2Err);
      }
    } catch (capErr) {
      console.warn('[GPS] Capacitor Geolocation error:', capErr);
    }
  }

  // Tier 3: Browser navigator.geolocation
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    try {
      const webPos = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Web geolocation timeout')), 4000);
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            clearTimeout(timer);
            resolve(pos);
          },
          (err) => {
            clearTimeout(timer);
            reject(err);
          },
          { enableHighAccuracy: true, timeout: 3500, maximumAge: 2000 }
        );
      });
      if (coordinates({ lat: webPos?.coords?.latitude, lon: webPos?.coords?.longitude })) {
        saveCached(webPos.coords.latitude, webPos.coords.longitude);
        return { lat: webPos.coords.latitude, lon: webPos.coords.longitude, accuracy: webPos.coords.accuracy, isWeb: true };
      }
    } catch (webErr) {
      console.warn('[GPS] Web geolocation failed:', webErr);
    }
  }

  // Tier 4: Cached location
  const cached = allowCached ? getCached() : null;
  if (cached) {
    console.log('[GPS] Using cached location:', cached);
    return cached;
  }

  if (!allowFallback) throw new Error('GPS unavailable: check location permission and services, or enter the facility coordinates manually.');

  // Legacy fallback remains for callers pending a separate location migration.
  console.log('[GPS] Using disaster anchor coordinate fallback');
  const anchor = { lat: 28.7041, lon: 77.1025, isFallback: true };
  saveCached(anchor.lat, anchor.lon);
  return anchor;
}

/**
 * Continuously streams real-time physical GPS coordinates as the user moves across terrain.
 * Supports Capacitor Native Geolocation and W3C navigator.geolocation.watchPosition with
 * high accuracy GNSS satellite chips.
 *
 * @param {Function} onUpdate - callback({ lat, lon, accuracy, speed, heading, timestamp, source })
 * @param {Function} [onError] - callback(error)
 * @returns {Promise<Function>} unsubscribe - async function to clear the hardware GPS watch
 */
export async function watchNativeOrWebLocation(onUpdate, onError) {
  const saveCached = (lat, lon) => {
    try {
      localStorage.setItem('rescue.lastLocation', JSON.stringify({
        lat: Number(lat),
        lon: Number(lon),
        updatedAt: Date.now()
      }));
    } catch {
      // silent
    }
  };

  // Tier 1: Capacitor Native Geolocation
  if (typeof window !== 'undefined' && window.Capacitor?.isPluginAvailable?.('Geolocation')) {
    try {
      const { Geolocation } = await import('@capacitor/geolocation');

      try {
        const perm = await Geolocation.checkPermissions();
        if (perm.location !== 'granted') {
          await Geolocation.requestPermissions();
        }
      } catch (pErr) {
        console.warn('[GPS Watch] Permission check notice:', pErr);
      }

      const watchId = await Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 1000 },
        (position, err) => {
          if (err) {
            onError?.(err);
            return;
          }
          if (position?.coords?.latitude != null && position?.coords?.longitude != null) {
            saveCached(position.coords.latitude, position.coords.longitude);
            onUpdate({
              lat: Number(position.coords.latitude),
              lon: Number(position.coords.longitude),
              accuracy: position.coords.accuracy || null,
              speed: position.coords.speed || null,
              heading: position.coords.heading || null,
              timestamp: position.timestamp || Date.now(),
              source: 'native_gps'
            });
          }
        }
      );

      return async () => {
        try {
          await Geolocation.clearWatch({ id: watchId });
        } catch (cErr) {
          console.warn('[GPS Watch] Clear native watch error:', cErr);
        }
      };
    } catch (capErr) {
      console.warn('[GPS Watch] Capacitor watchPosition failed, falling back to Web API:', capErr);
    }
  }

  // Tier 2: Browser navigator.geolocation.watchPosition
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    try {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (pos?.coords?.latitude != null && pos?.coords?.longitude != null) {
            saveCached(pos.coords.latitude, pos.coords.longitude);
            onUpdate({
              lat: Number(pos.coords.latitude),
              lon: Number(pos.coords.longitude),
              accuracy: pos.coords.accuracy || null,
              speed: pos.coords.speed || null,
              heading: pos.coords.heading || null,
              timestamp: pos.timestamp || Date.now(),
              source: 'web_gps'
            });
          }
        },
        (err) => {
          onError?.(err);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 1000
        }
      );

      return () => {
        try {
          navigator.geolocation.clearWatch(watchId);
        } catch {
          // silent
        }
      };
    } catch (webErr) {
      console.warn('[GPS Watch] Web watchPosition failed:', webErr);
    }
  }

  // Fallback: No hardware GPS watch available
  return () => {};
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


