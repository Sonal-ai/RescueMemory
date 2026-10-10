/**
 * RescueMemory Client-Side Offline Brain
 * 
 * Runs 100% locally in the mobile browser / PWA without internet,
 * without a Raspberry Pi, and without an edge laptop server.
 * 
 * Features:
 * 1. In-Browser Vector Engine (Cosine similarity, Float32 dot products).
 * 2. Negative Vector Facility Recommendation (V_target = normalize(V_base - 0.5 * V_hazard)).
 * 3. Native Android Qdrant Edge BM25 retrieval; browser keyword fallback.
 * 4. Auto-Sync outbox manager that synchronizes local reports when connection is restored.
 */

import {
  saveOfflineReport,
  getUnsyncedReports,
  markReportsSynced,
  getAllLocalReports,
  saveImportedReports,
  saveImportedGuides,
  getAllLocalGuides,
} from './offlineStorage.js';
import {
  pushReportsToCloud,
  pullReportsFromCloud,
  pullGuidesFromCloud,
} from './cloudSync.js';
import staticCards from '../../public/data/knowledge_cards.json';
import { isAndroidEdge, searchEdgeGuidance, getQdrantEdgeStatus } from './qdrantEdge.js';
import { formatGuidanceCards } from './guidanceFormat.js';

let cachedCards = Array.isArray(staticCards) ? staticCards : [];
let cachedVectors = null;
let isInitializing = false;
let initPromise = null;

// Listeners for sync events
const syncListeners = new Set();

export function onSyncStateChange(callback) {
  syncListeners.add(callback);
  return () => syncListeners.delete(callback);
}

function notifySync(state) {
  syncListeners.forEach((fn) => {
    try { fn(state); } catch (e) { console.error('Sync listener error:', e); }
  });
}

/**
 * Loads pre-computed knowledge cards and 384-d vectors into browser memory,
 * merging with any newly downloaded guides from Central sync.
 */
export async function initOfflineBrain(forceReload = false) {
  if (forceReload || !cachedCards || cachedCards.length === 0) {
    let base = Array.isArray(staticCards) ? [...staticCards] : [];
    try {
      const localGuides = await getAllLocalGuides();
      if (Array.isArray(localGuides) && localGuides.length > 0) {
        const guideMap = new Map();
        base.forEach((c) => guideMap.set(c.id, c));
        localGuides.forEach((g) => guideMap.set(g.id, { ...guideMap.get(g.id), ...g }));
        base = Array.from(guideMap.values());
      }
    } catch (e) {
      console.warn('[OfflineBrain] Error loading local guides:', e);
    }
    cachedCards = base;
  }
  if (cachedVectors && !forceReload) {
    return { cards: cachedCards, vectors: cachedVectors };
  }
  if (isInitializing) {
    return initPromise;
  }

  isInitializing = true;
  initPromise = (async () => {
    try {
      // 1. Dynamic import vectors for vector cosine similarity
      const vecMod = await import('../../public/data/knowledge_vectors.json');
      cachedVectors = vecMod.default || vecMod;
      return { cards: cachedCards, vectors: cachedVectors };
    } catch (err) {
      console.warn('[OfflineBrain] Dynamic import of vectors failed, attempting fetch:', err);
      try {
        const fetchFile = async (f) => {
          const res = await fetch(`./data/${f}`).catch(() => null) ||
                      await fetch(`/data/${f}`).catch(() => null) ||
                      await fetch(`data/${f}`).catch(() => null);
          return res;
        };
        const vRes = await fetchFile('knowledge_vectors.json');
        if (vRes && vRes.ok) {
          cachedVectors = await vRes.json();
          return { cards: cachedCards, vectors: cachedVectors };
        }
      } catch (fetchErr) {
        console.warn('[OfflineBrain] Vectors fetch fallback error:', fetchErr);
      }
      cachedVectors = {};
      return { cards: cachedCards, vectors: cachedVectors };
    } finally {
      isInitializing = false;
    }
  })();

  return initPromise;
}

/**
 * Vector arithmetic helper functions.
 */
function dotProduct(vecA, vecB) {
  let sum = 0;
  for (let i = 0; i < vecA.length; i++) {
    sum += vecA[i] * vecB[i];
  }
  return sum;
}

function magnitude(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) {
    sum += vec[i] * vec[i];
  }
  return Math.sqrt(sum) || 1.0;
}

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  return dotProduct(vecA, vecB) / (magnitude(vecA) * magnitude(vecB));
}

function normalizeVector(vec) {
  const mag = magnitude(vec);
  return vec.map((x) => x / mag);
}

/**
 * Client-Side Negative Vector Facility Recommendation
 * V_rec = normalize(V_compromised - 0.5 * V_hazard)
 */
export async function recommendAlternativeLocal(compromisedId, avoidHazardText = 'flooded entrance live wires') {
  await initOfflineBrain();
  if (!cachedCards || !cachedVectors) {
    throw new Error('Local knowledge vectors not available');
  }

  // 1. Locate base facility
  const baseCard = cachedCards.find(
    (c) => c.id === compromisedId || c.entity_id === compromisedId
  );
  let baseVec = cachedVectors[compromisedId] || (baseCard && cachedVectors[baseCard.id]);

  // Fallback base vector if not explicitly matched
  if (!baseVec) {
    const keys = Object.keys(cachedVectors);
    baseVec = cachedVectors[keys[0]];
  }

  // 2. Select hazard vector profile
  let hazardVec = cachedVectors['__hazard_flood__'];
  const lowerHazard = (avoidHazardText || '').toLowerCase();
  if (lowerHazard.includes('fire') || lowerHazard.includes('smoke')) {
    hazardVec = cachedVectors['__hazard_fire__'] || hazardVec;
  } else if (lowerHazard.includes('collapse') || lowerHazard.includes('debris')) {
    hazardVec = cachedVectors['__hazard_collapse__'] || hazardVec;
  } else if (lowerHazard.includes('chem') || lowerHazard.includes('toxic')) {
    hazardVec = cachedVectors['__hazard_contamination__'] || hazardVec;
  }

  // 3. Compute Negative Vector Arithmetic: V_target = normalize(V_base - 0.5 * V_hazard)
  const targetVec = [];
  for (let i = 0; i < baseVec.length; i++) {
    targetVec.push(baseVec[i] - 0.5 * (hazardVec[i] || 0));
  }
  const normTarget = normalizeVector(targetVec);

  // 4. Scan candidate checkpoints / shelters
  const candidates = [];
  for (const card of cachedCards) {
    const cid = card.id || card.entity_id;
    if (cid === compromisedId || card.entity_id === compromisedId) continue;

    const isFacility =
      card.kind === 'checkpoint' ||
      card.kind === 'facility' ||
      cid.toLowerCase().includes('shelter') ||
      cid.toLowerCase().includes('clinic') ||
      cid.toLowerCase().includes('cp_');

    if (!isFacility) continue;

    const cardVec = cachedVectors[cid];
    if (!cardVec) continue;

    const score = cosineSimilarity(normTarget, cardVec);
    candidates.push({
      card,
      score: Math.round(score * 1000) / 1000,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  if (!best) return null;

  return {
    recommended_entity_id: best.card.entity_id || best.card.id,
    title: best.card.title,
    score: best.score,
    facilities: best.card.facilities || [],
    location: best.card.location,
    reasoning: `Selected by on-device vector arithmetic (score: ${best.score}) neutralizing hazard "${avoidHazardText}".`,
    safe_guidance: 'Check route visibility before movement. Follow marked high-ground evacuation path.',
    on_device: true,
  };
}

const EMERGENCY_SYNONYMS = {
  walk: ['walk', 'leg', 'extremity', 'weight', 'mobility', 'fracture', 'trauma', 'foot', 'ankle', 'broken', 'bone'],
  cant: ['cannot', 'unable', 'inability', 'cant', 'hard', 'fail'],
  hurt: ['injury', 'trauma', 'wound', 'pain', 'sore', 'ache'],
  broken: ['fracture', 'bone', 'splint', 'trauma', 'broken', 'dislocated'],
  water: ['water', 'drinking', 'purify', 'disinfection', 'filtration', 'hydration', 'clean', 'potable', 'boil'],
  burn: ['burn', 'burns', 'thermal', 'scald', 'fire', 'chemical'],
  bleed: ['bleeding', 'blood', 'hemorrhage', 'tourniquet', 'wound', 'cut', 'laceration', 'arterial'],
  breath: ['breathing', 'respiratory', 'airway', 'cpr', 'choking', 'gasping'],
  breathe: ['breathing', 'respiratory', 'airway', 'cpr', 'choking', 'gasping'],
  stuck: ['trapped', 'rubble', 'collapse', 'debris', 'extrication'],
  trapped: ['trapped', 'rubble', 'collapse', 'debris', 'extrication', 'buried'],
  snake: ['snakebite', 'venom', 'envenomation', 'serpent'],
  bite: ['bite', 'snakebite', 'puncture', 'animal', 'rabies'],
  chok: ['choking', 'airway', 'cpr', 'heimlich'],
  cpr: ['cpr', 'resuscitation', 'cardiac', 'unresponsive', 'chest compression', 'heart'],
  shock: ['shock', 'hypovolemic', 'perfusion', 'blanket', 'pale'],
  cold: ['hypothermia', 'frostbite', 'exposure', 'freezing'],
  heat: ['heatstroke', 'exhaustion', 'hyperthermia', 'dehydration'],
  first: ['first aid', 'wound', 'care', 'emergency', 'help'],
  aid: ['first aid', 'wound', 'care', 'treatment'],
};

const STOP_WORDS = new Set([
  'got', 'have', 'had', 'the', 'this', 'that', 'with', 'from', 'and', 'for', 
  'are', 'was', 'were', 'what', 'how', 'can', 'you', 'please', 'make', 'give', 'does'
]);

export function dedupeStrings(arr) {
  const seen = new Set();
  const res = [];
  for (const item of arr || []) {
    if (!item) continue;
    const str = String(item).trim();
    const norm = str.toLowerCase().replace(/^[•\-\*\d\.\s]+/, '').replace(/[^a-z0-9]/g, '');
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    res.push(str);
  }
  return res;
}

function extractStepsFromCard(card) {
  if (card.instructions && card.instructions.length > 0) {
    return dedupeStrings(card.instructions);
  }
  if (!card.summary) return [];
  const parts = card.summary
    .split(/(?<=[.?!;])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
  return dedupeStrings(parts);
}

/**
 * Client-Side Semantic & Keyword Search over 419 Emergency Cards
 */
export async function searchKnowledgeLocal(queryText, limit = 5) {
  if (isAndroidEdge()) {
    if (/^(hi|hello|hey|greetings|halo|howdy)([\s,!.]+.*)?$/i.test((queryText || '').trim())) {
      const status = await getQdrantEdgeStatus();
      return { ...status, source_cards: [], warnings: [], is_greeting: true, mode: 'native_qdrant_edge',
        text: `### Rescue Assistant Ready\n\n${status.indexed_cards} emergency reference cards are indexed on this phone. Describe the injury or hazard to search them offline.` };
    }
    // Reconcile the durable guide inventory before querying, including writes
    // committed just before a crash or while native indexing was unavailable.
    const result = await searchEdgeGuidance(queryText || '', limit, await getAllLocalGuides());
    const { cards, ...metadata } = result;
    return formatGuidanceCards(cards, metadata);
  }
  try {
    await initOfflineBrain();
  } catch (e) {
    console.warn('[OfflineBrain] init check:', e);
  }

  const cards = ((cachedCards && cachedCards.length > 0)
    ? cachedCards
    : (Array.isArray(staticCards) ? staticCards : [])).filter(card => card.kind !== 'checkpoint');

  const isGreetingQuery = /^(hi|hello|hey|greetings|halo|howdy)([\s,!.]+.*)?$/i.test((queryText || '').trim());
  if (isGreetingQuery) {
    return {
      source_cards: [],
      text: `### 🛡️ Rescue Assistant Ready\n\n• **I am here to help you.** You are connected to RescueMemory's offline emergency brain.\n• **On-Device Protocols:** I can guide you through first aid (bleeding, fractures, CPR, burns), finding nearby casualties, and locating shelters.\n• **How can I assist you right now?** Describe any injuries or hazards you observe, or select one of the quick prompts below.`,
      warnings: [],
      on_device: true,
      is_greeting: true,
    };
  }

  const rawWords = (queryText || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));

  const expandedTermsSet = new Set(rawWords);
  for (const w of rawWords) {
    for (const [key, syns] of Object.entries(EMERGENCY_SYNONYMS)) {
      if (w.includes(key) || key.includes(w)) {
        syns.forEach((s) => expandedTermsSet.add(s));
      }
    }
  }
  const queryTerms = Array.from(expandedTermsSet);

  const scoredCards = [];
  if (queryTerms.length > 0) {
    for (const card of cards) {
      let score = 0;
      const id = (card.id || '').toLowerCase().replace(/[-_]/g, ' ');
      const title = (card.title || '').toLowerCase();
      const summary = (card.summary || '').toLowerCase();
      const applicability = (card.applicability || '').toLowerCase();
      const warningsText = (card.warnings || []).join(' ').toLowerCase();

      for (const term of queryTerms) {
        if (id.includes(term)) score += 15;
        if (title.includes(term)) score += 12;
        if (summary.includes(term)) score += 5;
        if (applicability.includes(term)) score += 3;
        if (warningsText.includes(term)) score += 2;
      }

      if (score > 0) {
        scoredCards.push({ card, score });
      }
    }
    scoredCards.sort((a, b) => b.score - a.score);
  }

  const matchesFound = scoredCards.length > 0;
  const topCards = matchesFound
    ? scoredCards.slice(0, limit).map((sc) => sc.card)
    : [];

  const mappedCards = topCards.map((c) => ({
    id: c.id,
    title: c.title,
    summary: c.summary,
    steps: extractStepsFromCard(c),
    instructions: c.instructions || [],
    warnings: dedupeStrings(c.warnings || []),
    source: c.source,
  }));

  const primaryCard = mappedCards[0];
  const allWarnings = dedupeStrings(mappedCards.flatMap((c) => c.warnings || []).filter(Boolean));

  let formattedText = '';
  if (matchesFound && primaryCard) {
    formattedText = `### Reference Protocol: ${primaryCard.title}\n\n`;

    const hasExplicitInstructions = primaryCard.instructions && primaryCard.instructions.length > 0;
    const steps = dedupeStrings(primaryCard.steps);
    const warnings = dedupeStrings(primaryCard.warnings);

    if (hasExplicitInstructions) {
      if (primaryCard.summary) {
        formattedText += `**Protocol Summary:**\n${primaryCard.summary}\n\n`;
      }
      if (steps.length > 0) {
        formattedText += `**Action Steps:**\n` + steps.map((st, i) => `${i + 1}. ${st}`).join('\n') + '\n\n';
      }
    } else {
      // Steps were parsed from summary; avoid duplicating sentences identically as summary and steps
      if (steps.length > 1) {
        formattedText += `**Action Steps:**\n` + steps.map((st, i) => `${i + 1}. ${st}`).join('\n') + '\n\n';
      } else if (primaryCard.summary) {
        formattedText += `**Protocol Guidance:**\n${primaryCard.summary}\n\n`;
      }
    }

    // Deduplicate warnings against steps and summary text
    const cleanWarnings = warnings.filter((w) => {
      const normW = w.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normText = formattedText.toLowerCase().replace(/[^a-z0-9]/g, '');
      return !normText.includes(normW);
    });

    if (cleanWarnings.length > 0) {
      formattedText += `⚠️ **Critical Warnings:**\n` + cleanWarnings.map((w) => `- ${w}`).join('\n') + '\n\n';
    }

    if (mappedCards.length > 1) {
      formattedText += `**Related Reference Protocols:**\n` + mappedCards.slice(1, 4).map((c) => `• **${c.title}**${c.summary ? `: ${c.summary}` : ''}`).join('\n');
    }
  } else {
    formattedText = `### 🛡️ Stay Calm & Safe\n\n` +
      `• **Move away from hazards:** If you are near falling debris, floodwaters, collapsed walls, or downed power lines, move immediately to open ground.\n` +
      `• **Contact emergency services:** Call **112 / 911** or broadcast an immediate responder alert using the **Emergency SOS** tab.\n` +
      `• **Offline Emergency Brain:** I have **419 verified clinical guidelines** stored locally on your device. Ask me about **inability to walk**, **severe bleeding**, **CPR**, **burns**, or **clean water**.`;
  }

  return {
    source_cards: mappedCards,
    text: formattedText,
    warnings: allWarnings.slice(0, 3),
    on_device: true,
    engine: 'javascript-keyword',
    retrieval: 'keyword',
    mode: 'browser_keyword_fallback',
  };
}

/**
 * Offline Report Recording (saves to IndexedDB)
 */
export async function recordReportLocal(reportData) {
  const saved = await saveOfflineReport(reportData);
  console.log('[OfflineBrain] Report saved to on-device outbox:', saved.id);
  // Attempt background sync if network is active
  triggerAutoSync();
  return {
    status: 'saved_locally',
    event_id: saved.id,
    on_device: true,
    message: 'Report saved to phone storage. Will automatically sync to field hub upon connection.',
  };
}

/**
 * Auto-Sync Engine: Syncs local IndexedDB outbox to server whenever connection is restored.
 */
function resolveServerUrl(path) {
  if (path && (path.startsWith('http://') || path.startsWith('https://'))) return path;
  const custom = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('rescue.backendUrl')) || '';
  if (custom) return `${custom.replace(/\/$/, '')}${path ? (path.startsWith('/') ? path : `/${path}`) : ''}`;
  const envUrl = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BACKEND_URL) || '';
  if (envUrl) return `${envUrl.replace(/\/$/, '')}${path ? (path.startsWith('/') ? path : `/${path}`) : ''}`;
  const resolved = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('rescue.resolvedBackendUrl')) || '';
  if (resolved) return `${resolved.replace(/\/$/, '')}${path ? (path.startsWith('/') ? path : `/${path}`) : ''}`;
  const fallback = 'https://rescuememory.onrender.com';
  return `${fallback}${path ? (path.startsWith('/') ? path : `/${path}`) : ''}`;
}

export async function triggerAutoSync() {
  const unsyncedInitial = await getUnsyncedReports();
  const isOnline = (typeof localStorage !== 'undefined' ? localStorage.getItem('rescue.online_mode') !== 'false' : true) &&
                   (typeof navigator === 'undefined' || navigator.onLine !== false);
  if (!isOnline) {
    notifySync({ state: 'offline', pendingCount: unsyncedInitial.length });
    return { synced: 0, imported: 0, pending: unsyncedInitial.length, status: 'offline' };
  }

  notifySync({ state: 'syncing', pendingCount: unsyncedInitial.length });
  let totalSyncedCount = 0;
  let remoteImportedCount = 0;
  let anyChannelConnected = false;

  // 1. Channel A: Try Local Edge / Central Server if reachable
  const edgeBase = resolveServerUrl('');
  let edgeReachable = false;
  if (edgeBase) {
    try {
      const healthCheck = await fetch(`${edgeBase}/health`, { method: 'GET', signal: AbortSignal.timeout(2000) });
      if (healthCheck.ok) {
        edgeReachable = true;
        anyChannelConnected = true;
      }
    } catch {
      edgeReachable = false;
    }
  }

  if (edgeReachable) {
    const unsynced = await getUnsyncedReports();
    const syncedIds = [];
    for (const report of unsynced) {
      try {
        const payload = {
          idempotency_key: report.id,
          entity_id: report.entity_id || report.id,
          kind: report.kind || 'sos',
          text: report.text,
          location: report.location,
          visibility: report.visibility || 'public',
          status: report.status || 'needs_help',
          severity: report.severity || 'red',
          reporter_id: report.reporter_id || 'survivor-mobile',
          observed_at: report.created_at || report.observed_at || new Date().toISOString(),
        };
        const res = await fetch(`${edgeBase}/api/reports`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          syncedIds.push(report.id);
        }
      } catch (err) {
        console.warn(`[AutoSync] Edge uplink fail for ${report.id}:`, err.message);
      }
    }
    if (syncedIds.length > 0) {
      await markReportsSynced(syncedIds);
      totalSyncedCount += syncedIds.length;
    }

    // Downlink from Edge
    try {
      const meshKey = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('rescue.meshKey')) || 'rescue-mesh-shared-key-2026';
      const exportRes = await fetch(`${edgeBase}/api/sync/export?scope=public&limit=64`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Mesh-Key': meshKey,
        },
        signal: AbortSignal.timeout(3000),
      });
      if (exportRes.ok) {
        const data = await exportRes.json();
        if (Array.isArray(data?.events) && data.events.length > 0) {
          const imp = await saveImportedReports(data.events);
          remoteImportedCount += imp;
        }
      }
    } catch {
      // silent
    }
  }

  // 2. Channel B: Direct Qdrant Cloud Uplink & Downlink (Guaranteed multi-device mesh channel)
  try {
    const remainingUnsynced = await getUnsyncedReports();
    if (remainingUnsynced.length > 0) {
      const cloudSyncedIds = await pushReportsToCloud(remainingUnsynced);
      if (cloudSyncedIds.length > 0) {
        await markReportsSynced(cloudSyncedIds);
        totalSyncedCount += cloudSyncedIds.length;
        anyChannelConnected = true;
      }
    }

    // Downlink latest remote public reports from other devices in Qdrant Cloud
    const cloudReports = await pullReportsFromCloud(64);
    if (cloudReports.length > 0) {
      const imp = await saveImportedReports(cloudReports);
      remoteImportedCount += imp;
      anyChannelConnected = true;
    }

    // Downlink verified clinical guides
    const cloudGuides = await pullGuidesFromCloud(32);
    if (cloudGuides.length > 0) {
      await saveImportedGuides(cloudGuides);
    }
  } catch (cloudErr) {
    console.warn('[AutoSync] Direct Cloud Sync pass notice:', cloudErr.message);
  }

  const remaining = (await getUnsyncedReports()).length;
  if (!anyChannelConnected && remaining > 0) {
    notifySync({ state: 'server_unreachable', pendingCount: remaining });
  } else {
    notifySync({ state: remaining === 0 ? 'synced' : 'partial', pendingCount: remaining,
      uploadedCount: totalSyncedCount, receivedCount: remoteImportedCount });
  }

  return {
    synced: totalSyncedCount,
    imported: remoteImportedCount,
    pending: remaining,
    status: remaining === 0 ? 'synced' : 'partial',
  };
}

// Attach automatic sync listeners to browser window events
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[OfflineBrain] Network connection restored. Triggering auto-sync...');
    triggerAutoSync();
  });
  // Rapid automated multi-device sync interval (every 8 seconds)
  setInterval(() => {
    triggerAutoSync();
  }, 8000);
}
