/* ================================================================
   sw.js – Jewellery Live Rates Platform  v6
   ─ /api/config is network-first
   ─ Navigation is network-first
   ─ JS/CSS use Stale-While-Revalidate so normal refreshes work!
   ================================================================ */
const CACHE_NAME = 'jewellers-shell-v8';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/Media/android-chrome-192x192.png',
  '/Media/android-chrome-512x512.png',
  '/Media/apple-touch-icon.png',
  '/Media/favicon.ico',
  '/Media/favicon-32x32.png',
  '/Media/favicon-16x16.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Oswald:wght@500;600;700&display=swap',
];

/* ── Install: pre-cache shell ── */
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .catch(() => { /* ignore pre-cache errors */ })
  );
});

/* ── Activate: purge old caches ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch strategy ── */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  /* Never intercept socket or live-data API */
  if (url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api/rates')) return;
  if (url.pathname.startsWith('/api/debug')) return;

  /* /api/config — network-first so config changes propagate immediately */
  if (url.pathname.startsWith('/api/config')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  /* Navigation (HTML) — network-first, fallback to cached shell */
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  /* All other assets (JS, CSS, Images) — Network-First for instant updates */
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
