// Minimal PWA service worker. Network-first for navigations (so deploys go
// live immediately), cache-first for hashed build assets. No cache-busting
// footguns: only files that exist are cached at runtime.
const CACHE = 'reimon-games-v3';
const INDEX_URL = new URL('index.html', self.registration.scope).href;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  if (request.mode === 'navigate') {
    // Network-first for pages: fresh deploys are visible on next reload.
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(INDEX_URL, copy));
          return res;
        })
        .catch(() => caches.match(INDEX_URL)),
    );
    return;
  }

  // Cache-first for build assets (hashed filenames never change).
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((res) => {
        if (res.ok) caches.open(CACHE).then((cache) => cache.put(request, res.clone()));
        return res;
      });
      return cached || network;
    }),
  );
});
