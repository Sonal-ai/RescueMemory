import { Capacitor, registerPlugin } from '@capacitor/core';

export const isAndroidEdge = () => Capacitor.getPlatform() === 'android';
export const preferNativeRetrieval = (path, android = isAndroidEdge()) => android &&
  ['/api/chat', '/api/assess', '/health', '/api/sync/status'].includes(path);

function checkedStatus(result) {
  if (result?.engine !== 'qdrant-edge' || result.retrieval !== 'bm25' || result.ready !== true ||
      result.on_device !== true || !Number.isSafeInteger(result.indexed_cards) || result.indexed_cards < 1 ||
      !Number.isSafeInteger(result.bundled_cards) || result.indexed_cards < result.bundled_cards || !result.pack_version) {
    throw new Error('Native Qdrant Edge did not confirm a ready, indexed reference shard.');
  }
  return result;
}

// Injectable transport lets contract tests exercise the actual initialization,
// update/retry and query flow without substituting a fake vector engine in production.
export function createEdgeClient(plugin, android = isAndroidEdge) {
  let initialization, guideSignature = '', updateQueue = Promise.resolve();
  async function initialize() {
    if (!android()) throw new Error('On-device Qdrant Edge requires the Android APK.');
    if (!initialization) {
      initialization = Promise.resolve().then(() => plugin.initialize()).then(checkedStatus).catch(error => {
        initialization = undefined; throw error;
      });
    }
    return initialization;
  }
  async function syncGuides(guides = []) {
    await initialize();
    const work = updateQueue.then(async () => {
      if (!Array.isArray(guides)) throw new Error('Invalid local guide inventory.');
      const signature = JSON.stringify(guides);
      if (signature === guideSignature) return;
      for (let offset = 0; offset < guides.length; offset += 64) {
        checkedStatus(await plugin.upsertGuides({ guides: guides.slice(offset, offset + 64) }));
      }
      // Commit only after all native writes/flushes succeeded. A failed batch retries.
      guideSignature = signature;
    });
    updateQueue = work.catch(() => {});
    return work;
  }
  async function search(query, limit = 5, guides = []) {
    if (typeof query !== 'string' || query.length > 4096 || query.includes('\0') ||
        !Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('Invalid guidance query or limit.');
    await syncGuides(guides);
    const response = checkedStatus(await plugin.searchGuidance({ query, limit }));
    if (!Array.isArray(response.cards)) throw new Error('Native Qdrant Edge returned malformed search results.');
    const seen = new Set();
    const cards = response.cards.filter(card => {
      if (!card?.id || !card.title || card.kind === 'checkpoint' || !Number.isFinite(card.score) || card.score <= 0 || seen.has(card.id)) return false;
      seen.add(card.id); return true;
    }).slice(0, limit);
    return { ...response, cards, mode: 'native_qdrant_edge' };
  }
  async function status() { await initialize(); return checkedStatus(await plugin.getStatus()); }
  return { initialize, syncGuides, search, status };
}

const client = createEdgeClient(registerPlugin('QdrantEdge'));
export const initializeQdrantEdge = () => client.initialize();
export const syncEdgeGuides = guides => client.syncGuides(guides);
export const searchEdgeGuidance = (query, limit, guides) => client.search(query, limit, guides);
export const getQdrantEdgeStatus = () => client.status();
