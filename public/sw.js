/* ================================================================
   sw.js – Jewellery Live Rates Platform  v11
   Strategy: Network-First for all assets (instant updates).
   Falls back to cache when offline.
   ================================================================ */

const CACHE_NAME = 'jewellers-shell-v17';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css?v=17',
  '/app.js?v=17',
  '/manifest.webmanifest',
  '/Media/android-chrome-192x192.png',
  '/Media/android-chrome-512x512.png',
  '/Media/apple-touch-icon.png',
  '/Media/favicon.ico',
  '/Media/favicon-32x32.png',
  '/Media/favicon-16x16.png',
];

/* ── Install: pre-cache shell & skip waiting immediately ── */
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .catch(() => { /* ignore pre-cache errors */ })
  );
});

/* ── Activate: purge old caches & claim all clients ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── SKIP_WAITING message from app.js ── */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ── Fetch strategy: Network-First for instant updates ── */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  /* Never intercept socket, live-data API, or config — always fetch fresh */
  if (url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api/')) return;

  /* Always network-first: get fresh from server, cache as fallback */
  event.respondWith(
    fetch(event.request).then(networkResponse => {
      if (networkResponse && networkResponse.status === 200) {
        const clone = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return networkResponse;
    }).catch(() => caches.match(event.request))
  );
});
