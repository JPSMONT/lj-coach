// LJ Coach service worker — offline app shell (Design Principle 1: race-critical paths work with no signal).
// Cache-first for our own files; network for cross-origin (e.g. the Plan page's Open-Meteo forecast).
const CACHE = 'ljcoach-v1';
const ASSETS = [
  './', './index.html',
  './compare.html', './venue.html', './plan.html', './cockpit.html', './debrief.html', './trimlab.html',
  './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // same-origin: cache-first, then network (and cache the response). cross-origin (forecast API): network only.
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res;
    }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
