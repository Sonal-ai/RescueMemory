import { reportRadar } from './brain/reportRadar.js';
import { localReportAnswer } from './brain/localReportChat.js';
import { formatOnlineAnswer } from './brain/onlineAnswer.js';
import { gpsPosition, hardwareLocationWatch } from './brain/locationTracking.js';
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
import { localRecordProvenance } from './brain/cloudInspector.js';
import { isCloudApi, offlineCloudResult, requestCloudApi } from './brain/cloudApi.js';
import { isAndroidEdge, preferNativeRetrieval, getQdrantEdgeStatus } from './brain/qdrantEdge.js';

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
  // The APK has no online-mode switch. A saved web preference must not
  // silently prevent its optional Gemini request when connectivity returns.
  return isAndroidEdge() ? navigator.onLine !== false : isOnline;
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
    const isLocalDev = !isAndroidEdge() && typeof window !== 'undefined' && (
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

export function getBackendBaseUrl({ probe = true } = {}) {
  const custom = setting('backendUrl');
  if (custom && (!isAndroidEdge() || !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(custom))) return custom.replace(/\/$/, '');
  if (resolvedBackendUrl && (!isAndroidEdge() || !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(resolvedBackendUrl))) return resolvedBackendUrl;
  const envUrl = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BACKEND_URL) || '';
  if (envUrl) return envUrl.replace(/\/$/, '');
  const cached = typeof sessionStorage !== 'undefined' && sessionStorage.getItem('rescue.resolvedBackendUrl');
  if (cached && (!isAndroidEdge() || !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(cached))) return cached;
  if (probe) probeCandidateBackends().catch(() => {});

  if (isAndroidEdge()) return 'https://rescuememory.onrender.com';

  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return 'http://localhost:8000';
  }
  return 'https://rescuememory.onrender.com';
}

export function buildBackendUrl(path, options) {
  if (!path || path.startsWith('http://') || path.startsWith('https://')) return path;
  const base = getBackendBaseUrl(options);
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
  // Execute Android emergency retrieval before any cache/network decision.
  // Native failure propagates instead of relabeling a fallback as successful Edge.
  if (preferNativeRetrieval(path)) {
    setStandaloneMode(true);
    const local = await handleOfflineFallback(path, method, body);
    if (path === '/api/chat' && body?.use_ai && isOnlineMode() && navigator.onLine !== false)
      return formatOnlineAnswer(local, body.text, { url: buildBackendUrl('/api/chat/format', { probe: false }), online: () => isOnlineMode() && navigator.onLine !== false });
    return local;
  }
  const liveCloud = isCloudApi(path);
  const authorityWrite = requiresAuthorityServer(path, method, body);
  const cacheKey = `${method}:${path}:${admin ? 'a' : ''}:${responder ? 'r' : ''}:${group ? 'g' : ''}`;

  if (method === 'GET' && !liveCloud && !options.noCache && options.preferCache) {
    const cached = getCachedApi(cacheKey);
    if (cached) return cached;
  }

  // Immediate offline fallback if offline mode is toggled OR device is known to be offline
  if (!isOnlineMode() || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    if (liveCloud) return offlineCloudResult(path);
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

  if (liveCloud) {
    const data = await requestCloudApi(fetch, targetUrl, path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    setStandaloneMode(false);
    if (method !== 'GET') invalidateApiCache();
    return data;
  }

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
  if (!isAndroidEdge()) await initOfflineBrain();

  // 1. Local Search & Emergency Guidance
  if (path === '/api/chat' || path.startsWith('/api/chat')) {
    const query = body?.text || body?.message || body?.query || '';
    const qLower = query.toLowerCase();
    const reportAnswer = localReportAnswer(query, await getAllLocalReports(), body?.location);
    if (reportAnswer) return reportAnswer;

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
      engine: answer.engine,
      engine_version: answer.engine_version,
      retrieval: answer.retrieval,
      indexed_cards: answer.indexed_cards,
      elapsed_ms: answer.elapsed_ms,
      pack_version: answer.pack_version,
      ai_answer: null,
      ai_status: 'offline_mode',
      suggested_action: isSosQuery
        ? { kind: 'sos', title: 'Broadcast Emergency SOS' }
        : (topCard?.title ? { kind: 'protocol', title: `Follow protocol: ${topCard.title}` } : null),
      warnings: answer.warnings || [],
      local_fallback: true,
      mode: answer.mode || 'browser_keyword_fallback',
    };
  }

  if (path === '/api/assess' && isAndroidEdge()) {
    const answer = await searchKnowledgeLocal(body?.query || '', body?.limit || 3);
    return { ...answer, cards: answer.source_cards, local_answer: answer.text,
      assessment_available: false, status: 'retrieval_only',
      detail: 'Local reference retrieval is available. Automated clinical assessment is not implemented in this APK.' };
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
    if (isAndroidEdge()) {
      const edge = await getQdrantEdgeStatus();
      return { ...edge, status: 'ok', edge_brain: 'qdrant-edge',
        node_id: getDeviceId(), unsynced_reports_count: unsynced.length,
        guides: edge.indexed_cards, events: (await getAllLocalReports()).length,
        local_fallback: false };
    }
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
  let myLocation = null;
  try {
    const loc = await getNativeOrWebLocation({ allowCached: false, allowFallback: false });
    if (coordinates(loc)) myLocation = loc;
  } catch {
    // silent
  }

  // 0. Proactively announce our own presence beacon if online
  if (isOnlineMode() && myLocation) {
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

  // 2. Online proximity needs an actual device location.
  if (isOnlineMode() && myLocation) {
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

  // 3. Do not announce a fixed anchor as this phone's position.
  if (isOnlineMode() && myLocation) {
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
  const loc = locationData?.location || locationData;
  if (!coordinates(loc)) throw new Error('Cannot publish device presence without real coordinates.');
  if (isNativeBle()) await ensureMeshIdentity();
  await publishMeshLocation(locationData).catch(() => {});
  const phoneBattery = await getPhoneBattery().catch(() => ({}));
  if (!isOnlineMode()) {
    return { updated: true, mode: 'offline_local', ...phoneBattery };
  }
  const lat = Number(loc.lat);
  const lon = Number(loc.lon);
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

  let cloudUpdated = false;
  try {
    const unsynced = await getUnsyncedReports();
    cloudUpdated = await publishPresenceBeacon({
      deviceId: myDeviceId,
      role: myRole,
      deviceName: myDeviceName,
      location: { ...loc, lat, lon },
      ...(batteryLevel != null ? { battery: batteryLevel } : {}),
      unsyncedCount: unsynced.length,
    });
  } catch (error) {
    console.warn('[cloud.presence/PUBLISH]', error.message);
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

  return { updated: true, mode: 'automatic_mesh', cloud_updated: cloudUpdated };
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
  const saveCached = fix => {
    try {
      localStorage.setItem('rescue.lastLocation', JSON.stringify({
        ...fix, updatedAt: fix.timestamp
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
          return { ...parsed, lat: Number(parsed.lat), lon: Number(parsed.lon), timestamp: parsed.timestamp ?? parsed.updatedAt, isCached: true };
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
          Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 3500, maximumAge: 0 }),
          4000
        );
        if (coordinates({ lat: pos1?.coords?.latitude, lon: pos1?.coords?.longitude })) {
          const fix = gpsPosition(pos1, 'native_gps'); saveCached(fix); return fix;
        }
      } catch (t1Err) {
        console.warn('[GPS] Native high-accuracy failed, trying coarse:', t1Err);
      }

      // Tier 2: Coarse / Network location
      try {
        const pos2 = await withTimeout(
          Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 3000, maximumAge: 0 }),
          3500
        );
        if (coordinates({ lat: pos2?.coords?.latitude, lon: pos2?.coords?.longitude })) {
          const fix = gpsPosition(pos2, 'native_gps'); saveCached(fix); return { ...fix, isCoarse: true };
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
          { enableHighAccuracy: true, timeout: 3500, maximumAge: 0 }
        );
      });
      if (coordinates({ lat: webPos?.coords?.latitude, lon: webPos?.coords?.longitude })) {
        const fix = gpsPosition(webPos, 'web_gps'); saveCached(fix); return { ...fix, isWeb: true };
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
  return hardwareLocationWatch(fix => {
    try { localStorage.setItem('rescue.lastLocation', JSON.stringify({ ...fix, updatedAt: fix.timestamp })); }
    catch (error) { console.warn('[GPS cache]', error.message); }
    onUpdate(fix);
  }, onError, {
    nativeAvailable: () => typeof window !== 'undefined' && window.Capacitor?.isPluginAvailable?.('Geolocation'),
    loadNative: () => import('@capacitor/geolocation'),
    geolocation: typeof navigator !== 'undefined' ? navigator.geolocation : null,
  });
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


