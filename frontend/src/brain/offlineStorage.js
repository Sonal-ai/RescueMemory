/**
 * IndexedDB storage for offline survivor observations, SOS reports, and local sync state.
 * Enables zero-connectivity persistence on the survivor's mobile phone.
 */

const DB_NAME = 'RescueMemoryOfflineDB';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('reports')) {
        const reportStore = db.createObjectStore('reports', { keyPath: 'id' });
        reportStore.createIndex('synced', 'synced', { unique: false });
        reportStore.createIndex('created_at', 'created_at', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
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
    };
    const req = store.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

export async function getUnsyncedReports() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reports', 'readonly');
    const store = tx.objectStore('reports');
    const index = store.index('synced');
    const req = index.getAll(IDBKeyRange.only(false));
    req.onsuccess = () => resolve(req.result || []);
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

export async function markReportsSynced(ids) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reports', 'readwrite');
    const store = tx.objectStore('reports');
    let completed = 0;
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
        completed++;
        if (completed === ids.length) resolve();
      };
    });
    tx.onerror = () => reject(tx.error);
  });
}
