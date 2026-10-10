import { isNativeBle, isBleBackgroundBusy, hasIncomingBleSession, startBleReceiver, getActiveBlePeers, syncWithBlePeer, onBlePeersChange } from './bleMesh.js';
import { meshTrace } from './meshDiagnostics.js';

// Native scanner emits observations as soon as they arrive. This owner connects
// and transfers without a Mesh page, manual tap, or waiting for a scan window.
let running = false, busy = false, timer, wakeTimer, unsubscribe, rerun = false, reportsChanged = false;
const retries = new Map(), observations = new Set(), seen = new Map();
async function cycle() {
  if (!running || document.hidden) return;
  if (busy) { rerun = true; return; }
  busy = true;
  try {
    if (!await startBleReceiver({ automatic: true })) return;
    if (hasIncomingBleSession() || (isBleBackgroundBusy() && !observations.size)) return;
    if (localStorage.getItem('rescue.mesh_auto') === 'false') return;
    const forceReports = reportsChanged; reportsChanged = false;
    for (const peer of getActiveBlePeers()) {
      if (!running || document.hidden || hasIncomingBleSession()) break;
      if (!peer?.node_id || !peer.available || (!peer.sync_ready && !peer.node_id.startsWith('unresolved_'))) continue;
      if ((retries.get(peer.address)?.next || 0) > Date.now()) continue;
      observations.delete(peer.address);
      if (!forceReports && peer.last_sync?.status === 'complete' && Date.now() - Date.parse(peer.last_sync.started_at) < 15000) continue;
      meshTrace('auto.connect', 'STARTING', 'Detected phone will be identified and exchanged automatically.', { peer: peer.node_id, address: peer.address });
      try { await syncWithBlePeer(peer); retries.delete(peer.address); }
      catch (error) {
        const failures = (retries.get(peer.address)?.failures || 0) + 1;
        const delay = Math.min(30000, 2000 * 2 ** (failures - 1));
        retries.set(peer.address, { failures, next: Date.now() + delay });
        meshTrace('auto.retry', 'SCHEDULED', error.message, { address: peer.address, retry_in_ms: delay });
        // An idle refresh failure does not undo a completed exchange. Retain
        // its exact diagnostics; alert only when sharing is still outstanding.
        if (forceReports || peer.last_sync?.status !== 'complete')
          window.dispatchEvent(new CustomEvent('rescue:mesh-error', { detail: { error: error.message, peer: peer.node_id } }));
        setTimeout(wake, delay);
      }
    }
  } catch (error) {
    meshTrace('auto.start', 'FAILED', error.message);
    window.dispatchEvent(new CustomEvent('rescue:mesh-error', { detail: { error: error.message } }));
  } finally { busy = false; if (rerun) { rerun = false; wake(); } }
}
function wake() {
  if (!running || document.hidden) return;
  clearTimeout(wakeTimer);
  // Small jitter reduces simultaneous connection attempts; no 20/30-second hold.
  wakeTimer = setTimeout(cycle, 50 + Math.floor(Math.random() * 150));
}
function detected(event) { observations.add(event.detail.address); wake(); }
function changed() { reportsChanged = true; wake(); }
export function startAppMesh() {
  if (!isNativeBle() || running) return;
  running = true; unsubscribe = onBlePeersChange(peers => {
    let changed = false;
    for (const peer of peers) {
      if (seen.get(peer.node_id) !== peer.last_seen_epoch) changed = true;
      seen.set(peer.node_id, peer.last_seen_epoch);
    }
    if (changed) wake();
  });
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('rescue:mesh-auto-changed', wake);
  window.addEventListener('rescue:ble-discovered', detected);
  window.addEventListener('rescue:ble-idle', wake);
  window.addEventListener('rescue:reports-changed', changed);
  timer = setInterval(cycle, 10000); cycle();
}
export function detachAppMesh() {
  running = false; clearInterval(timer); clearTimeout(wakeTimer); unsubscribe?.();
  document.removeEventListener('visibilitychange', wake);
  window.removeEventListener('rescue:mesh-auto-changed', wake);
  window.removeEventListener('rescue:ble-discovered', detected);
  window.removeEventListener('rescue:ble-idle', wake);
  window.removeEventListener('rescue:reports-changed', changed);
  // The native background receiver remains alive until explicitly stopped.
}
