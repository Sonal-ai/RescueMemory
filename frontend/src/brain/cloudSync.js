/**
 * RescueMemory Direct Cloud Mesh & Qdrant Sync Engine
 * 
 * Enables autonomous peer-to-peer discovery and bidirectional sync
 * between Android devices and Central Server using Qdrant Cloud.
 */

export const QDRANT_CLOUD_URL = 'https://59916dae-f8fa-454e-9b92-96755f1251d4.us-east-1-1.aws.cloud.qdrant.io';
export const QDRANT_CLOUD_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MiOiJtIiwic3ViamVjdCI6ImFwaS1rZXk6NGNmOGY1MDUtZjhhMi00ZTEzLWFhOGMtZjBlMjk0MjRmNzViIn0.Bw1GfzE8jD61Yx179dU4Oj7bMKaMzLNXZP5Z9Wj-o2E';

export const PUBLIC_EVENTS_COLLECTION = 'rescue_public_events';
export const RESPONDER_EVENTS_COLLECTION = 'rescue_responder_events';
export const GUIDES_COLLECTION = 'rescue_approved_guides';

/**
 * Universal resilient HTTP fetcher supporting Capacitor native HTTP and standard browser fetch.
 */
export async function universalRequest(url, options = {}) {
  const { method = 'GET', headers = {}, body, timeout = 5000 } = options;
  const isNative = typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.());

  if (isNative) {
    try {
      const { CapacitorHttp } = await import('@capacitor/core');
      const parsedBody = body ? (typeof body === 'string' ? JSON.parse(body) : body) : undefined;
      const res = await CapacitorHttp.request({
        url,
        method,
        headers,
        data: parsedBody,
        connectTimeout: timeout,
        readTimeout: timeout,
      });
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        headers: {
          get: (name) => res.headers?.[name] || res.headers?.[name?.toLowerCase()],
        },
        json: async () => res.data,
        text: async () => (typeof res.data === 'string' ? res.data : JSON.stringify(res.data)),
      };
    } catch {
      // Fallback to standard fetch below
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generates an RFC 4122 v4-compliant UUID deterministically from any string.
 */
export async function strToUuid(str) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const enc = new TextEncoder().encode(String(str));
      const buf = await crypto.subtle.digest('SHA-256', enc);
      const arr = Array.from(new Uint8Array(buf.slice(0, 16)));
      arr[6] = (arr[6] & 0x0f) | 0x40; // Version 4
      arr[8] = (arr[8] & 0x3f) | 0x80; // Variant RFC 4122
      const hex = arr.map((b) => b.toString(16).padStart(2, '0')).join('');
      return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20, 32),
      ].join('-');
    } catch {
      // Fallback to synchronous hash
    }
  }

  // Fallback deterministic UUID
  let hash1 = 5381;
  let hash2 = 52711;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash1 = ((hash1 << 5) + hash1) ^ ch;
    hash2 = ((hash2 << 5) + hash2) ^ ch;
  }
  const h1 = Math.abs(hash1).toString(16).padStart(8, '0');
  const h2 = Math.abs(hash2).toString(16).padStart(8, '0');
  const h3 = Math.abs(hash1 ^ hash2).toString(16).padStart(8, '0');
  const h4 = Math.abs(hash1 + hash2).toString(16).padStart(8, '0');
  return `${h1}-${h2.slice(0, 4)}-4${h2.slice(5, 8)}-a${h3.slice(1, 4)}-${h4}${h3.slice(4, 8)}`.slice(0, 36);
}

/**
 * Generates a normalized 384-dimensional dense vector for Qdrant storage.
 */
export function generateVector384(text = '') {
  const vec = new Float32Array(384);
  let seed = 0;
  for (let i = 0; i < text.length; i++) {
    seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
  }
  let sumSq = 0;
  for (let i = 0; i < 384; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const val = (seed / 4294967296) * 2 - 1;
    vec[i] = val;
    sumSq += val * val;
  }
  const norm = Math.sqrt(sumSq) || 1;
  return Array.from(vec).map((v) => Number((v / norm).toFixed(6)));
}

/**
 * Geodesic distance in meters between two lat/lon coordinates.
 */
export function distM(lat1, lon1, lat2, lon2) {
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

/**
 * Geodesic bearing in degrees from start to end coordinates.
 */
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

const CARDINALS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function cardinalDirection(b) {
  const idx = Math.round((b % 360) / 22.5) % 16;
  return CARDINALS[idx];
}

/**
 * Publishes or updates this device's presence beacon in Qdrant Cloud.
 */
export async function publishPresenceBeacon({
  deviceId,
  role = 'survivor',
  deviceName = '',
  location = { lat: 28.7041, lon: 77.1025 },
  battery = 90,
  unsyncedCount = 0,
}) {
  if (!deviceId) return false;
  try {
    const pointId = await strToUuid(`beacon_${deviceId}`);
    const name = deviceName || `Android Mesh Node (${deviceId.slice(-4)})`;
    const point = {
      id: pointId,
      vector: { dense: generateVector384(deviceId) },
      payload: {
        id: `beacon_${deviceId}`,
        node_id: deviceId,
        kind: 'peer_beacon',
        visibility: 'public',
        device_name: name,
        role,
        location: {
          lat: Number(location.lat || 28.7041),
          lon: Number(location.lon || 77.1025),
        },
        battery: Number(battery || 90),
        unsynced_count: Number(unsyncedCount || 0),
        last_seen: Date.now(),
        status: 'active',
      },
    };

    const res = await universalRequest(`${QDRANT_CLOUD_URL}/collections/${PUBLIC_EVENTS_COLLECTION}/points`, {
      method: 'PUT',
      headers: {
        'api-key': QDRANT_CLOUD_KEY,
        'Content-Type': 'application/json',
      },
      body: { points: [point] },
      timeout: 3500,
    });
    return res.ok;
  } catch (err) {
    console.warn('[CloudMesh] publishPresenceBeacon error:', err.message);
    return false;
  }
}

/**
 * Queries active peer beacons from Qdrant Cloud and computes distance/bearing.
 */
export async function queryPeerBeacons(myDeviceId, myLocation = { lat: 28.7041, lon: 77.1025 }) {
  try {
    const res = await universalRequest(`${QDRANT_CLOUD_URL}/collections/${PUBLIC_EVENTS_COLLECTION}/points/scroll`, {
      method: 'POST',
      headers: {
        'api-key': QDRANT_CLOUD_KEY,
        'Content-Type': 'application/json',
      },
      body: {
        filter: {
          must: [
            { key: 'kind', match: { value: 'peer_beacon' } },
          ],
        },
        limit: 32,
        with_payload: true,
        with_vector: false,
      },
      timeout: 3500,
    });

    if (!res.ok) return [];
    const data = await res.json();
    const points = data?.result?.points || [];

    const now = Date.now();
    const activeCutoffMs = 300000; // Beacons within last 5 minutes
    const myLat = myLocation?.lat || 28.7041;
    const myLon = myLocation?.lon || 77.1025;

    const peers = [];
    for (const pt of points) {
      const p = pt.payload;
      if (!p || !p.node_id) continue;
      if (p.node_id === myDeviceId) continue; // Exclude self
      const lastSeen = Number(p.last_seen || 0);
      if (now - lastSeen > activeCutoffMs) continue; // Skip stale beacons

      const pLat = Number(p.location?.lat || myLat);
      const pLon = Number(p.location?.lon || myLon);
      const dist = Math.round(distM(myLat, myLon, pLat, pLon));
      const b = bearingDeg(myLat, myLon, pLat, pLon);
      const card = cardinalDirection(b);

      peers.push({
        node_id: p.node_id,
        name: p.device_name || `Android Device (${p.node_id.slice(-4)})`,
        role: p.role || 'survivor',
        status: p.status || 'active',
        battery: p.battery || 85,
        last_seen: lastSeen,
        location: { lat: pLat, lon: pLon },
        distance_m: dist,
        bearing_deg: b,
        cardinal: card,
        walk_time_min: Math.max(1, Math.round(dist / 75)),
        source: 'cloud_mesh',
        sync_ready: true,
      });
    }

    peers.sort((a, b) => a.distance_m - b.distance_m);
    return peers;
  } catch (err) {
    console.warn('[CloudMesh] queryPeerBeacons error:', err.message);
    return [];
  }
}

/**
 * Pushes local reports to Qdrant Cloud public events collection.
 */
export async function pushReportsToCloud(reports = []) {
  if (!Array.isArray(reports) || reports.length === 0) return [];
  try {
    const publicPoints = [];
    const responderPoints = [];
    const idMap = [];

    for (const rep of reports) {
      if (!rep || !rep.id) continue;
      const pointId = await strToUuid(rep.id);
      const vector = generateVector384(rep.text || rep.kind || 'sos emergency');
      const payload = {
        id: rep.id,
        entity_id: rep.entity_id || rep.id,
        kind: rep.kind || 'sos',
        visibility: rep.visibility || 'public',
        severity: rep.severity || 'red',
        status: rep.status || 'needs_help',
        text: rep.text || '',
        reporter_id: rep.reporter_id || 'survivor-mobile',
        location: {
          lat: Number(rep.location?.lat || 28.7041),
          lon: Number(rep.location?.lon || 77.1025),
        },
        materials: rep.materials || [],
        breathing: rep.breathing || null,
        bleeding_type: rep.bleeding_type || null,
        observed_at: rep.observed_at || rep.created_at || new Date().toISOString(),
        created_at: rep.created_at || new Date().toISOString(),
      };
      const pt = {
        id: pointId,
        vector: { dense: vector },
        payload,
      };
      if (rep.visibility === 'responders') {
        responderPoints.push(pt);
      } else {
        publicPoints.push(pt);
      }
      idMap.push(rep.id);
    }

    if (publicPoints.length === 0 && responderPoints.length === 0) return [];

    const pushBatch = async (col, pts) => {
      if (pts.length === 0) return true;
      const res = await universalRequest(`${QDRANT_CLOUD_URL}/collections/${col}/points`, {
        method: 'PUT',
        headers: {
          'api-key': QDRANT_CLOUD_KEY,
          'Content-Type': 'application/json',
        },
        body: { points: pts },
        timeout: 5000,
      });
      return res.ok;
    };

    const res1 = await pushBatch(PUBLIC_EVENTS_COLLECTION, publicPoints);
    const res2 = await pushBatch(RESPONDER_EVENTS_COLLECTION, responderPoints);

    if (res1 || res2) {
      console.log(`[CloudMesh] Successfully pushed ${idMap.length} report(s) to Qdrant Cloud.`);
      return idMap;
    }
    return [];
  } catch (err) {
    console.warn('[CloudMesh] pushReportsToCloud error:', err.message);
    return [];
  }
}

/**
 * Downloads public reports from Qdrant Cloud (excludes peer beacons).
 */
export async function pullReportsFromCloud(limit = 64) {
  try {
    const res = await universalRequest(`${QDRANT_CLOUD_URL}/collections/${PUBLIC_EVENTS_COLLECTION}/points/scroll`, {
      method: 'POST',
      headers: {
        'api-key': QDRANT_CLOUD_KEY,
        'Content-Type': 'application/json',
      },
      body: {
        filter: {
          must: [
            { key: 'visibility', match: { value: 'public' } },
          ],
        },
        limit,
        with_payload: true,
        with_vector: false,
      },
      timeout: 5000,
    });

    if (!res.ok) return [];
    const data = await res.json();
    const points = data?.result?.points || [];

    const reports = points
      .filter((pt) => pt.payload && pt.payload.kind !== 'peer_beacon')
      .map((pt) => ({
        ...pt.payload,
        id: pt.payload.id || pt.id,
        synced: true,
      }));

    return reports;
  } catch (err) {
    console.warn('[CloudMesh] pullReportsFromCloud error:', err.message);
    return [];
  }
}

/**
 * Downloads emergency guides from Qdrant Cloud.
 */
export async function pullGuidesFromCloud(limit = 64) {
  try {
    const res = await universalRequest(`${QDRANT_CLOUD_URL}/collections/${GUIDES_COLLECTION}/points/scroll`, {
      method: 'POST',
      headers: {
        'api-key': QDRANT_CLOUD_KEY,
        'Content-Type': 'application/json',
      },
      body: {
        limit,
        with_payload: true,
        with_vector: false,
      },
      timeout: 5000,
    });

    if (!res.ok) return [];
    const data = await res.json();
    const points = data?.result?.points || [];
    return points.map((pt) => pt.payload).filter(Boolean);
  } catch (err) {
    console.warn('[CloudMesh] pullGuidesFromCloud error:', err.message);
    return [];
  }
}
