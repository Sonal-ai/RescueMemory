import { parentPort, workerData } from 'node:worker_threads';
import { registerHooks } from 'node:module';
import 'fake-indexeddb/auto';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@capacitor/core') return { url: new URL('./nativeMock.js', import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    const result = next(url, context);
    if (url.endsWith('/meshSecurity.js')) return { ...result,
      source: String(result.source).replace('import.meta.env?.VITE_RESPONDER_ISSUER_PUBLIC_KEY', 'process.env.MESH_TEST_ISSUER') };
    return result;
  },
});
const storage = () => ({ values: new Map(), getItem(k) { return this.values.get(k) || null; }, setItem(k, v) { this.values.set(k, v); } });
globalThis.localStorage = storage(); globalThis.sessionStorage = storage();
globalThis.window = new EventTarget(); globalThis.document = Object.assign(new EventTarget(), { hidden: false });
if (workerData.webviewRejectsEcdsa) {
  const importKey = crypto.subtle.importKey.bind(crypto.subtle);
  crypto.subtle.importKey = (...args) => {
    if (args[2]?.name === 'ECDSA') throw new Error('Android WebView cannot import this ECDSA SPKI');
    return importKey(...args);
  };
}
localStorage.setItem('rescue.device_id', workerData.id);
const engine = await import('../src/brain/bleMesh.js');
const db = await import('../src/brain/offlineStorage.js');
parentPort.on('message', async message => {
  if (message.type !== 'command') return;
  try {
    let result;
    switch (message.action) {
      case 'seed': for (const report of message.reports) await db.saveOfflineReport(report); result = true; break;
      case 'location': result = await engine.publishMeshLocation(message.location); break;
      case 'hidden': document.hidden = message.hidden; document.dispatchEvent(new Event('visibilitychange')); result = true; break;
      case 'scan': result = await engine.scanForNearbyPhones(); break;
      case 'advertisement': { const native = await import('./nativeMock.js'); native.advertise(); result = true; break; }
      case 'diagnostics': result = await engine.getBleDiagnostics(); break;
      case 'syncDetected': result = await engine.syncWithBlePeer(engine.getActiveBlePeers()[0]); break;
      case 'syncPeer': result = await engine.syncWithBlePeer(message.peer); break;
      case 'startRuntime': { const runtime = await import('../src/brain/meshRuntime.js'); runtime.startAppMesh(); result = true; break; }
      case 'detachRuntime': { const runtime = await import('../src/brain/meshRuntime.js'); runtime.detachAppMesh(); result = true; break; }
      case 'sync': {
        const [peer] = await engine.scanForNearbyPhones();
        result = await engine.syncWithBlePeer(peer); break;
      }
      case 'read': result = { reports: await db.getAllLocalReports(), history: await db.getMeshHistory(), peers: engine.getActiveBlePeers() }; break;
      default: throw new Error('Unknown test command');
    }
    parentPort.postMessage({ type: 'command-result', id: message.id, result });
  } catch (error) { parentPort.postMessage({ type: 'command-result', id: message.id, error: error.message }); }
});
await engine.startBleReceiver();
parentPort.postMessage({ type: 'ready' });
