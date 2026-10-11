import { canonical, wireReport, validReport } from './meshProtocol.js';
import { prepareReport, originalReportId } from './reportIdentity.js';

/**
 * IndexedDB storage for offline survivor observations, SOS reports, and local sync state.
 * Enables zero-connectivity persistence on the survivor's mobile phone.
 */

const DB_NAME = 'RescueMemoryOfflineDB';
const DB_VERSION = 4;
let databasePromise;
let reportRevision = 0;
export const getLocalDataRevision = () => reportRevision;
export function assertLocalDataRevision(expected) {
  if (expected !== reportRevision) throw new Error('LOCAL_DATA_CLEARED: This exchange started before local data was cleared.');
}

function openDB() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('reports')) {
        const reportStore = db.createObjectStore('reports', { keyPath: 'id' });
        reportStore.createIndex('synced', 'synced', { unique: false });
        reportStore.createIndex('created_at', 'created_at', { unique: false });
      }
      if (!db.objectStoreNames.contains('guides')) {
        const guideStore = db.createObjectStore('guides', { keyPath: 'id' });
        guideStore.createIndex('version', 'version', { unique: false });
      }
      if (!db.objectStoreNames.contains('transfers')) db.createObjectStore('transfers', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('syncState')) db.createObjectStore('syncState', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('receipts')) {
        const receipts = db.createObjectStore('receipts', { keyPath: 'id' });
        receipts.createIndex('report_id', 'report_id');
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); databasePromise = null; };
      resolve(request.result);
    };
    request.onerror = () => { databasePromise = null; reject(request.error); };
  });
  return databasePromise;
}

export async function saveOfflineReport(report) {
  report = prepareReport(report, localStorage.getItem('rescue.device_id') || report.reporter_id);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reports', 'readwrite');
    const store = tx.objectStore('reports');
    const record = {
      ...report,
      id: originalReportId(report),
      synced: false,
      created_at: report.created_at || new Date().toISOString(),
      offline_created: true,
      origin_device: report.origin_device || localStorage.getItem('rescue.device_id') || report.reporter_id,
    };
    const req = store.put(record);
    tx.oncomplete = () => {
      window.dispatchEvent(new Event('rescue:reports-changed'));
      resolve(record);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getUnsyncedReports() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reports', 'readonly');
    const store = tx.objectStore('reports');
    const req = store.getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      resolve(all.filter((r) => !r.synced));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getAllLocalReports() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reports', 'readonly');
    const store = tx.objectStore('reports');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function sameSourceReport(a, b) {
  if (a.id !== b.id || (a.source_report_id !== a.id && b.source_report_id !== b.id)) return false;
  const left = wireReport(a), right = wireReport(b);
  return ['kind', 'text', 'reporter_id', 'status', 'severity', 'entity_id', 'visibility', 'group_id', 'observed_at']
    .every(key => left[key] === right[key]) && left.location?.lat === right.location?.lat && left.location?.lon === right.location?.lon;
}

export async function saveImportedReports(reports, { markForRelay = false, expectedRevision = reportRevision } = {}) {
  if (!Array.isArray(reports) || reports.length === 0) return 0;
  const db = await openDB();
  assertLocalDataRevision(expectedRevision);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['reports', 'syncState'], 'readwrite');
    const store = tx.objectStore('reports');
    let importedCount = 0;
    let metadataChanged = false;
    const removed = tx.objectStore('syncState').get('removedCloudReportIds');
    removed.onsuccess = () => {
      const removedIds = new Set(removed.result?.ids || []);
      reports.forEach((incoming) => {
        if (!incoming || !incoming.id) return;
        const rep = { ...incoming, id: originalReportId(incoming) };
        if (removedIds.has(rep.id)) return;
        const getReq = store.get(rep.id);
        getReq.onsuccess = () => {
          const existing = getReq.result;
          const incomingTime = Date.parse(rep.observed_at || rep.created_at || '');
          const existingTime = Date.parse(existing?.observed_at || existing?.created_at || '');
          if (Number.isFinite(incomingTime) && Number.isFinite(existingTime) && incomingTime < existingTime) return;
          // Don't overwrite unsynced local changes with older remote copy
          const same = existing && sameSourceReport(existing, rep);
          if (same) {
            const metadata = Object.fromEntries(['verified', 'authority_tag', 'source_role', 'content_hash', 'expires_at']
              .filter(key => rep[key] !== undefined).map(key => [key, rep[key]]));
            const updated = { ...existing, ...metadata,
              ...(!markForRelay ? { synced: true, cloud_synced: true } : {}) };
            if (canonical(updated) !== canonical(existing)) {
              store.put(updated); metadataChanged = true;
            }
            return;
          }
          const changed = !existing || canonical(wireReport(existing)) !== canonical(wireReport(rep));
          if ((!existing || existing.synced || same || incomingTime > existingTime) && changed) {
            store.put({
              ...existing,
              ...rep,
              synced: !markForRelay,
              cloud_synced: !markForRelay,
              imported: true,
              imported_at: new Date().toISOString(),
            });
            importedCount++;
          }
        };
      });
    };
    tx.oncomplete = () => {
      if (importedCount || metadataChanged) window.dispatchEvent(new Event('rescue:reports-changed'));
      resolve(importedCount);
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function markReportsSynced(ids, { channel = 'cloud', expectedRevision = reportRevision } = {}) {
  const db = await openDB();
  assertLocalDataRevision(expectedRevision);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reports', 'readwrite');
    const store = tx.objectStore('reports');
    if (!ids.length) return resolve();
    ids.forEach((id) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const item = getReq.result;
        if (item) {
          item[`${channel}_synced`] = true;
          item.synced = channel === 'cloud' || item.visibility === 'group' || item.cloud_synced === true;
          item.synced_at = new Date().toISOString();
          store.put(item);
        }
      };
    });
    tx.oncomplete = () => { window.dispatchEvent(new Event('rescue:reports-changed')); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveImportedGuides(guides) {
  if (!Array.isArray(guides) || guides.length === 0) return 0;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('guides', 'readwrite');
    const store = tx.objectStore('guides');
    let count = 0;
    guides.forEach((g) => {
      if (!g || !g.id) return;
      store.put({ ...g, imported: true, imported_at: new Date().toISOString() });
      count++;
    });
    tx.oncomplete = () => {
      window.dispatchEvent(new Event('rescue:guides-changed'));
      resolve(count);
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllLocalGuides() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('guides', 'readonly');
    const store = tx.objectStore('guides');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function clearOfflineReports() {
  return clearLocalMeshData();
}

// One committed transaction clears reports, the outbox and their transfer history.
// The revision invalidates network/BLE responses from exchanges started earlier.
export async function clearLocalMeshData() {
  reportRevision++;
  window.dispatchEvent(new Event('rescue:local-data-reset'));
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['reports', 'receipts', 'transfers', 'syncState'], 'readwrite');
    const previous = tx.objectStore('syncState').get('removedCloudReportIds');
    previous.onsuccess = () => {
      const read = tx.objectStore('reports').getAll();
      read.onsuccess = () => {
        const ids = new Set([...(previous.result?.ids || []), ...read.result.map(r => r.id)]);
        for (const name of ['reports', 'receipts', 'transfers', 'syncState']) tx.objectStore(name).clear();
        // Keep prior suppression across repeated clears, too. A subsequent
        // actual Cloud snapshot may explicitly restore its current records.
        tx.objectStore('syncState').put({ id: 'removedCloudReportIds', ids: [...ids] });
      };
    };
    tx.oncomplete = () => {
      window.dispatchEvent(new Event('rescue:reports-changed'));
      window.dispatchEvent(new Event('rescue:transfers-changed'));
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Local data could not be cleared.'));
  });
}

export async function getRemovedCloudReportIds() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('syncState', 'readonly');
    const request = tx.objectStore('syncState').get('removedCloudReportIds');
    request.onsuccess = () => resolve(new Set(request.result?.ids || []));
    request.onerror = () => reject(request.error);
  });
}

// Only a fully downloaded scope can establish absence. Pending offline/hop SOS
// remain available; a timeout or incomplete page never deletes saved reports.
export async function reconcileCloudReports(snapshot, { expectedRevision = reportRevision } = {}) {
  const db = await openDB();
  assertLocalDataRevision(expectedRevision);
  const scopes = new Set(snapshot.completeScopes || []);
  const currentIds = new Set(snapshot.reports.filter(r => scopes.has(r.visibility)).map(originalReportId));
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['reports', 'syncState'], 'readwrite');
    const store = tx.objectStore('reports'), state = tx.objectStore('syncState');
    const readState = state.get('removedCloudReportIds');
    let removedCount = 0;
    readState.onsuccess = () => {
      const removed = new Set(readState.result?.ids || []);
      currentIds.forEach(id => removed.delete(id));
      const read = store.getAll();
      read.onsuccess = () => {
        for (const report of read.result) {
          if (report.cloud_synced === true && report.synced === true && scopes.has(report.visibility) && !currentIds.has(report.id)) {
            store.delete(report.id); removed.add(report.id); removedCount++;
          }
        }
        state.put({ id: 'removedCloudReportIds', ids: [...removed] });
      };
    };
    tx.oncomplete = () => {
      if (removedCount) window.dispatchEvent(new Event('rescue:reports-changed'));
      resolve(removedCount);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Cloud reports could not be reconciled.'));
  });
}

// Receipts are independent of cloud upload state. Resolve only after transaction commit.
export async function commitMeshReports(reports, { sessionId, peerId, transport = 'bluetooth', expectedRevision = reportRevision }) {
  if (!Array.isArray(reports) || reports.some(r => !validReport(r))) throw new Error('Malformed report batch.');
  const db = await openDB();
  assertLocalDataRevision(expectedRevision);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['reports', 'receipts', 'syncState'], 'readwrite');
    const store = tx.objectStore('reports');
    const result = { received: 0, duplicates: 0, conflicts: 0, acceptedIds: [] };
    const removed = tx.objectStore('syncState').get('removedCloudReportIds');
    removed.onsuccess = () => {
      const removedIds = new Set(removed.result?.ids || []);
      for (const report of reports) {
        if (removedIds.has(report.id)) { result.duplicates++; result.acceptedIds.push(report.id); continue; }
        const read = store.get(report.id);
        read.onsuccess = () => {
          const existing = read.result;
          if (existing && canonical(wireReport(existing)) !== canonical(wireReport(report)) && !sameSourceReport(existing, report)) { result.conflicts++; return; }
          if (existing) {
            if (sameSourceReport(existing, report)) {
              // A duplicate relay must not strip a server signature or cloud ACK.
              store.put({ ...existing, imported: true,
                imported_at: existing.imported_at || new Date().toISOString(), received_from: peerId });
            }
            result.duplicates++;
          }
          else {
            store.put({ ...wireReport(report), synced: false, imported: true,
              imported_at: new Date().toISOString(), received_from: peerId });
            result.received++;
          }
          result.acceptedIds.push(report.id);
          tx.objectStore('receipts').put({ id: `${sessionId}:received:${report.id}`, report_id: report.id,
            session_id: sessionId, peer_id: peerId, direction: 'received', transport, at: new Date().toISOString() });
        };
      }
    };
    tx.oncomplete = () => { window.dispatchEvent(new Event('rescue:reports-changed')); resolve(result); };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Local storage transaction aborted.'));
  });
}

export async function recordMeshSent(ids, sessionId, peerId, direction = 'sent', expectedRevision = reportRevision) {
  const db = await openDB();
  assertLocalDataRevision(expectedRevision);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('receipts', 'readwrite');
    for (const id of ids) tx.objectStore('receipts').put({ id: `${sessionId}:${direction}:${id}`, report_id: id,
      session_id: sessionId, peer_id: peerId, direction, transport: 'bluetooth', at: new Date().toISOString() });
    tx.oncomplete = () => { window.dispatchEvent(new Event('rescue:reports-changed')); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveTransferSession(session) {
  const db = await openDB();
  if (session.report_revision !== undefined && session.report_revision !== reportRevision) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('transfers', 'readwrite');
    tx.objectStore('transfers').put({ ...session, updated_at: new Date().toISOString() });
    tx.oncomplete = () => { window.dispatchEvent(new Event('rescue:transfers-changed')); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function getMeshHistory() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['transfers', 'receipts'], 'readonly');
    const transfers = tx.objectStore('transfers').getAll();
    const receipts = tx.objectStore('receipts').getAll();
    tx.oncomplete = () => resolve({ transfers: transfers.result.sort((a, b) => b.updated_at.localeCompare(a.updated_at)), receipts: receipts.result });
    tx.onerror = () => reject(tx.error);
  });
}
