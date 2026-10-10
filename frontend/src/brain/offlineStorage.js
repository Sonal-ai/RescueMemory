import { canonical, wireReport, validReport } from './meshProtocol.js';

/**
 * IndexedDB storage for offline survivor observations, SOS reports, and local sync state.
 * Enables zero-connectivity persistence on the survivor's mobile phone.
 */

const DB_NAME = 'RescueMemoryOfflineDB';
const DB_VERSION = 3;
let databasePromise;

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
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reports', 'readwrite');
    const store = tx.objectStore('reports');
    const record = {
      ...report,
      id: report.id || `offline_evt_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
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
  return a.kind === b.kind && a.text === b.text && a.reporter_id === b.reporter_id &&
    a.visibility === b.visibility && a.location?.lat === b.location?.lat &&
    a.location?.lon === b.location?.lon;
}

export async function saveImportedReports(reports, { markForRelay = false } = {}) {
  if (!Array.isArray(reports) || reports.length === 0) return 0;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reports', 'readwrite');
    const store = tx.objectStore('reports');
    let importedCount = 0;
    reports.forEach((rep) => {
      if (!rep || !rep.id) return;
      const getReq = store.get(rep.id);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (existing && rep.source_report_id === rep.id) {
          if (!existing.synced) store.put({ ...existing, synced: true });
          return;
        }
        const incomingTime = Date.parse(rep.observed_at || rep.created_at || '');
        const existingTime = Date.parse(existing?.observed_at || existing?.created_at || '');
        if (Number.isFinite(incomingTime) && Number.isFinite(existingTime) && incomingTime < existingTime) return;
        // Don't overwrite unsynced local changes with older remote copy
        if ((!existing || (!markForRelay && existing.synced)) &&
            (!existing || canonical(wireReport(existing)) !== canonical(wireReport(rep)))) {
          store.put({
            ...rep,
            synced: !markForRelay,
            imported: true,
            imported_at: new Date().toISOString(),
          });
          importedCount++;
        }
      };
    });
    tx.oncomplete = () => {
      if (importedCount) window.dispatchEvent(new Event('rescue:reports-changed'));
      resolve(importedCount);
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function markReportsSynced(ids) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reports', 'readwrite');
    const store = tx.objectStore('reports');
    if (!ids.length) return resolve();
    ids.forEach((id) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const item = getReq.result;
        if (item) {
          item.synced = true;
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
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reports', 'readwrite');
    const store = tx.objectStore('reports');
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Receipts are independent of cloud upload state. Resolve only after transaction commit.
export async function commitMeshReports(reports, { sessionId, peerId, transport = 'bluetooth' }) {
  if (!Array.isArray(reports) || reports.some(r => !validReport(r))) throw new Error('Malformed report batch.');
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['reports', 'receipts'], 'readwrite');
    const store = tx.objectStore('reports');
    const result = { received: 0, duplicates: 0, conflicts: 0, acceptedIds: [] };
    for (const report of reports) {
      const read = store.get(report.id);
      read.onsuccess = () => {
        const existing = read.result;
        if (existing && canonical(wireReport(existing)) !== canonical(wireReport(report)) && !sameSourceReport(existing, report)) { result.conflicts++; return; }
        if (existing) {
          if (sameSourceReport(existing, report) && existing.source_report_id === existing.id && report.source_report_id !== report.id) {
            store.put({ ...wireReport(report), synced: existing.synced, imported: true,
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
    tx.oncomplete = () => { window.dispatchEvent(new Event('rescue:reports-changed')); resolve(result); };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Local storage transaction aborted.'));
  });
}

export async function recordMeshSent(ids, sessionId, peerId, direction = 'sent') {
  const db = await openDB();
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
