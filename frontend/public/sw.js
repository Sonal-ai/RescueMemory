const CACHE_NAME = 'rescue-memory-pwa-v3';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.png',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
];

// Install: Cache essential app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: Purge older caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch strategy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. API Calls: Network-first. If network fails, return offline indicator so client fallback activates
  if (url.pathname.startsWith('/api')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({
            offline: true,
            detail: 'Edge Node unreachable. Standalone Mobile Brain active.',
          }),
          {
            headers: { 'Content-Type': 'application/json', 'X-Rescue-Offline': 'true' },
            status: 503,
          }
        );
      })
    );
    return;
  }

  // 2. Navigation requests: Serve cached index.html if offline
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('/index.html') || caches.match('/');
      })
    );
    return;
  }

  // 3. Static assets, JS/CSS bundles & offline data: Cache-first, fall back to network & store in cache
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            (url.pathname.startsWith('/assets') ||
             url.pathname.startsWith('/data') ||
             url.pathname.endsWith('.js') ||
             url.pathname.endsWith('.css') ||
             url.pathname.endsWith('.png') ||
             url.pathname.endsWith('.svg') ||
             url.pathname.endsWith('.json'))
          ) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // If offline and requesting index or shell
          if (event.request.destination === 'document') {
            return caches.match('/index.html');
          }
          return new Response('Offline asset unavailable', { status: 404 });
        });
    })
  );
});
