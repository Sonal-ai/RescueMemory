import { isNativeBle, isBleBackgroundBusy, hasIncomingBleSession, startBleReceiver, getActiveBlePeers, syncWithBlePeer, onBlePeersChange } from './bleMesh.js';

// App-owned lifecycle. Native service performs discovery/pings even while this
// WebView is suspended; this loop exchanges stored reports while the app is active.
let running = false, busy = false, timer, wakeTimer, unsubscribe;
const retries = new Map();
const seen = new Map();
async function cycle() {
  if (!running || busy || document.hidden) return;
  busy = true;
  try {
    if (!await startBleReceiver({ automatic: true })) return;
    if (isBleBackgroundBusy() || hasIncomingBleSession()) return;
    if (localStorage.getItem('rescue.mesh_auto') === 'false') return;
    for (const peer of getActiveBlePeers()) {
      if (!running || document.hidden) break;
      if (!peer.available || !peer.sync_ready || (retries.get(peer.node_id)?.next || 0) > Date.now()) continue;
      // Let the smaller ID initiate first, but allow fallback if discovery was
      // asymmetric or that initiator never completed a session.
      const self = localStorage.getItem('rescue.device_id') || '';
      if (self.localeCompare(peer.node_id) > 0 &&
        (Date.now() - (peer.first_seen_epoch || peer.last_seen_epoch) < 20000 ||
          (peer.last_sync?.status === 'complete' && Date.now() - Date.parse(peer.last_sync.started_at) < 60000))) continue;
      if (peer.last_sync && Date.now() - Date.parse(peer.last_sync.started_at) < 25000) continue;
      try { await syncWithBlePeer(peer); retries.delete(peer.node_id); }
      catch (error) {
        const failures = (retries.get(peer.node_id)?.failures || 0) + 1;
        retries.set(peer.node_id, { failures, next: Date.now() + Math.min(120000, 30000 * 2 ** (failures - 1)) });
        window.dispatchEvent(new CustomEvent('rescue:mesh-error', { detail: { error: error.message, peer: peer.node_id } }));
      }
    }
  } catch (error) {
    window.dispatchEvent(new CustomEvent('rescue:mesh-error', { detail: { error: error.message } }));
  } finally { busy = false; }
}
function wake() {
  if (document.hidden) return;
  clearTimeout(wakeTimer); wakeTimer = setTimeout(cycle, 1000);
}
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
  timer = setInterval(cycle, 30000); cycle();
}
export function detachAppMesh() {
  running = false; clearInterval(timer); clearTimeout(wakeTimer); unsubscribe?.();
  document.removeEventListener('visibilitychange', wake);
  window.removeEventListener('rescue:mesh-auto-changed', wake);
  // Native discovery intentionally survives navigation and WebView destruction.
}
