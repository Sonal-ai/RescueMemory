// The build replaces this name and manifest with a deployment-specific version.
const CACHE_NAME = 'rescue-memory-pwa-22513ca5d43765ce';
const CACHE_PREFIX = 'rescue-memory-pwa-';
const PRECACHE_ASSETS = ["/","/index.html","/manifest.json","/favicon.ico","/favicon.png","/favicon.svg","/icon-192.png","/icon-512.png","/icon-maskable-512.png","/logo.png","/data/knowledge_cards.json","/data/knowledge_vectors.json","/assets/AdminPortal-Du_OcMCu.js","/assets/CentralHQ-DsJG6qkG.js","/assets/CommandInspector-DurWP19U.js","/assets/LandingPage-Dg26Va9O.js","/assets/LandingPage-DkP9Qxz3.css","/assets/MapPanel-CcXJxNtP.css","/assets/MapPanel-DyiQhJb1.js","/assets/MeshSyncScanner-BY2Joiby.js","/assets/SafePlace-DDm9cag1.js","/assets/SurvivorHUD-Be6OXZEd.js","/assets/VolunteerBoard-CsETLDFU.js","/assets/bleMesh-Ct9fd3r4.js","/assets/circle-plus-CqaEDKxh.js","/assets/esm-CjTsNfkp.js","/assets/esm-CpfMAk3M.js","/assets/esm-CrlunyRI.js","/assets/index-BkxpijOZ.js","/assets/index-KnSyGTKc.css","/assets/knowledge_vectors-DItoRhaj.js","/assets/meshRuntime-B31X5-y6.js","/assets/three.module.min-DPfGchAH.js","/assets/useLiveGps-C-iqFXZr.js","/assets/web-dGZNTm0y.js","/assets/web-mj0Cw5nQ.js"];

async function appCacheNames() {
  const names = (await caches.keys()).filter(name => name.startsWith(CACHE_PREFIX));
  return [CACHE_NAME, ...names.reverse().filter(name => name !== CACHE_NAME)];
}

async function cachedAsset(request) {
  for (const name of await appCacheNames()) {
    const response = await (await caches.open(name)).match(request);
    if (response) return response;
  }
}

async function saveAsset(request, response) {
  try {
    await (await caches.open(CACHE_NAME)).put(request, response);
  } catch { /* Storage failure must not discard a working network response. */ }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    await (await caches.open(CACHE_NAME)).addAll(PRECACHE_ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const old = (await caches.keys()).filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME);
    // Keep one previous deployment for tabs that still run its entry script.
    await Promise.all(old.slice(0, -1).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname === '/health') {
    event.respondWith(fetch(request).catch(() => new Response(JSON.stringify({
      offline: true, detail: 'Edge Node unreachable. Standalone Mobile Brain active.',
    }), { status: 503, headers: { 'Content-Type': 'application/json', 'X-Rescue-Offline': 'true' } })));
    return;
  }
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(new Request(request, { cache: 'no-cache' }));
        if (response.ok && response.headers.get('Content-Type')?.includes('text/html')) {
          await saveAsset('/index.html', response.clone());
        }
        return response;
      } catch {
        return await cachedAsset('/index.html') || new Response('App unavailable offline', { status: 503 });
      }
    })());
    return;
  }

  if (url.pathname === '/sw.js') return;
  event.respondWith((async () => {
    const cached = await cachedAsset(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && !response.headers.get('Content-Type')?.includes('text/html') &&
          (/\.(js|css|png|svg|ico|jpg|jpeg|webp|json|woff2?)$/.test(url.pathname))) {
        await saveAsset(request, response.clone());
      }
      return response;
    } catch {
      return new Response('Offline asset unavailable', { status: 404 });
    }
  })());
});
