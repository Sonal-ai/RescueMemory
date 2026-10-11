// The build replaces this name and manifest with a deployment-specific version.
const CACHE_NAME = 'rescue-memory-pwa-282fb15f640b9323';
const CACHE_PREFIX = 'rescue-memory-pwa-';
const PRECACHE_ASSETS = ["/","/index.html","/manifest.json","/favicon.ico","/favicon.png","/favicon.svg","/icon-192.png","/icon-512.png","/icon-maskable-512.png","/logo.png","/data/knowledge_cards.json","/data/knowledge_vectors.json","/assets/AdminPortal-BuQR4s9a.js","/assets/CentralHQ-CyQclQux.js","/assets/CommandInspector-Cly5U3Cw.js","/assets/LandingPage-CYKL5ziS.js","/assets/LandingPage-DkP9Qxz3.css","/assets/MapPanel-C5lOkLF5.js","/assets/MapPanel-CcXJxNtP.css","/assets/MeshSyncScanner-CLURCmY4.js","/assets/SafePlace-CNMLajgR.js","/assets/SurvivorHUD-CJiG7ACh.js","/assets/VolunteerBoard-BS4rc7Df.js","/assets/bleMesh-6soqBa_S.js","/assets/circle-plus-COE6VgAO.js","/assets/esm-11Rug7ZI.js","/assets/esm-COKW6ZeE.js","/assets/esm-D4THcIy7.js","/assets/index-D1sGB-cT.css","/assets/index-DqqQDyjU.js","/assets/knowledge_vectors-DItoRhaj.js","/assets/meshRuntime-DkB7fDx_.js","/assets/three.module.min-DPfGchAH.js","/assets/useLiveGps-DiED9wfs.js","/assets/web-6dyg2Ntj.js","/assets/web-P_7ynIqB.js","/offline_tiles/14/11713/6835.png","/offline_tiles/14/11713/6836.png","/offline_tiles/14/11713/6837.png","/offline_tiles/14/11714/6835.png","/offline_tiles/14/11714/6836.png","/offline_tiles/14/11714/6837.png","/offline_tiles/14/11715/6835.png","/offline_tiles/14/11715/6836.png","/offline_tiles/14/11715/6837.png","/offline_tiles/15/23427/13671.png","/offline_tiles/15/23427/13672.png","/offline_tiles/15/23427/13673.png","/offline_tiles/15/23428/13671.png","/offline_tiles/15/23428/13672.png","/offline_tiles/15/23428/13673.png","/offline_tiles/15/23429/13671.png","/offline_tiles/15/23429/13672.png","/offline_tiles/15/23429/13673.png","/offline_tiles/16/46854/27342.png","/offline_tiles/16/46854/27343.png","/offline_tiles/16/46854/27344.png","/offline_tiles/16/46854/27345.png","/offline_tiles/16/46854/27346.png","/offline_tiles/16/46855/27342.png","/offline_tiles/16/46855/27343.png","/offline_tiles/16/46855/27344.png","/offline_tiles/16/46855/27345.png","/offline_tiles/16/46855/27346.png","/offline_tiles/16/46856/27342.png","/offline_tiles/16/46856/27343.png","/offline_tiles/16/46856/27344.png","/offline_tiles/16/46856/27345.png","/offline_tiles/16/46856/27346.png","/offline_tiles/16/46857/27342.png","/offline_tiles/16/46857/27343.png","/offline_tiles/16/46857/27344.png","/offline_tiles/16/46857/27345.png","/offline_tiles/16/46857/27346.png","/offline_tiles/16/46858/27342.png","/offline_tiles/16/46858/27343.png","/offline_tiles/16/46858/27344.png","/offline_tiles/16/46858/27345.png","/offline_tiles/16/46858/27346.png","/offline_tiles/17/93711/54686.png","/offline_tiles/17/93711/54687.png","/offline_tiles/17/93711/54688.png","/offline_tiles/17/93711/54689.png","/offline_tiles/17/93711/54690.png","/offline_tiles/17/93712/54686.png","/offline_tiles/17/93712/54687.png","/offline_tiles/17/93712/54688.png","/offline_tiles/17/93712/54689.png","/offline_tiles/17/93712/54690.png","/offline_tiles/17/93713/54686.png","/offline_tiles/17/93713/54687.png","/offline_tiles/17/93713/54688.png","/offline_tiles/17/93713/54689.png","/offline_tiles/17/93713/54690.png","/offline_tiles/17/93714/54686.png","/offline_tiles/17/93714/54687.png","/offline_tiles/17/93714/54688.png","/offline_tiles/17/93714/54689.png","/offline_tiles/17/93714/54690.png","/offline_tiles/17/93715/54686.png","/offline_tiles/17/93715/54687.png","/offline_tiles/17/93715/54688.png","/offline_tiles/17/93715/54689.png","/offline_tiles/17/93715/54690.png"];

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
