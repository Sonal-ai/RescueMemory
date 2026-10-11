// The build replaces this name and manifest with a deployment-specific version.
const CACHE_NAME = 'rescue-memory-pwa-bbf61c0c42e200ee';
const CACHE_PREFIX = 'rescue-memory-pwa-';
const PRECACHE_ASSETS = ["/","/index.html","/manifest.json","/favicon.ico","/favicon.png","/favicon.svg","/icon-192.png","/icon-512.png","/icon-maskable-512.png","/logo.png","/data/knowledge_cards.json","/data/knowledge_vectors.json","/assets/AdminPortal-CRWSzcE3.js","/assets/CentralHQ-BDLGNmQ5.js","/assets/CommandInspector-DFX5nQyD.js","/assets/LandingPage-BbXAQ1uW.js","/assets/LandingPage-DkP9Qxz3.css","/assets/MapPanel-Bfar1TPb.js","/assets/MapPanel-CcXJxNtP.css","/assets/MeshSyncScanner-CF87jdN-.js","/assets/SafePlace-O1jGXolc.js","/assets/SurvivorHUD-T8FCuAZw.js","/assets/VolunteerBoard-BOKwSdY3.js","/assets/bleMesh-Dy_a1ogi.js","/assets/circle-plus-CIJbtINL.js","/assets/esm-C3oZ2R4w.js","/assets/esm-CfcXW-2b.js","/assets/esm-CkjDk754.js","/assets/index-BQKrQ2JQ.css","/assets/index-Dj-lAULP.js","/assets/knowledge_vectors-DItoRhaj.js","/assets/meshRuntime-DNeXY9TV.js","/assets/three.module.min-DPfGchAH.js","/assets/useLiveGps-WIw3VsgK.js","/assets/web-BOGAGjen.js","/assets/web-DVmFpCRw.js"];

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
