const RETRY_KEY = 'rescue.chunk-recovery';
const CACHE_PREFIX = 'rescue-memory-pwa-';

export function isChunkLoadError(error) {
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk .* failed|Unable to preload CSS/i.test(error?.message || String(error || ''));
}

export async function reloadLatestApplication({ location, caches, serviceWorker, native = false, now = Date.now }) {
  if (!native) {
    // Remove executable app caches only. IndexedDB reports, guides, and settings
    // are independent and must survive recovery.
    try {
      const registrations = await serviceWorker?.getRegistrations() || [];
      await Promise.all(registrations.filter(registration => {
        const worker = registration.active || registration.waiting || registration.installing;
        return worker && new URL(worker.scriptURL).pathname === '/sw.js';
      }).map(registration => registration.unregister()));
    } catch { /* A fresh navigation can still recover when worker access fails. */ }
    try {
      const names = await caches?.keys() || [];
      await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX)).map(name => caches.delete(name)));
    } catch { /* Browser storage can be disabled or full. */ }
  }
  const url = new URL(location.href);
  url.searchParams.set('rescue_refresh', String(now()));
  location.replace(url.href);
}

export function installChunkRecovery({ target, storage, entry, online, reload, native = false }) {
  const listener = event => {
    if (native || !online() || !isChunkLoadError(event.payload)) return;
    try {
      if (storage.getItem(RETRY_KEY) === entry) return;
      storage.setItem(RETRY_KEY, entry);
    } catch { return; } // Without a persistent guard, avoid a reload loop.
    event.preventDefault();
    void reload();
  };
  target.addEventListener('vite:preloadError', listener);
  return () => target.removeEventListener('vite:preloadError', listener);
}
