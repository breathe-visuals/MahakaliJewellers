/* ================================================================
   sw.js – Mahakali Jewellers Service Worker
   Caches the shell (HTML/CSS/JS/assets) for offline capability.
   Live socket data is NEVER cached.
   ================================================================ */

const CACHE_NAME = 'mahakali-v1';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/Media/mahakali-logo.png',
  '/Media/android-chrome-192x192.png',
  '/Media/android-chrome-512x512.png',
  '/Media/apple-touch-icon.png',
  '/Media/favicon.ico',
  '/Media/favicon-32x32.png',
  '/Media/favicon-16x16.png',
  '/Media/site.webmanifest',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Oswald:wght@500;600;700&display=swap',
];

/* Install: pre-cache shell */
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS)).catch(() => { })
  );
});

/* Activate: purge old caches */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* Fetch: cache-first for shell, network-only for socket/API */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  /* Never intercept Socket.IO or API routes */
  if (url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api')) return;

  /* Network-first for HTML to always get fresh shell updates */
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  /* Cache-first for all other assets */
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
