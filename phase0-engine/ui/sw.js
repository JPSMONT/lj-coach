// LJ Coach service worker — offline app shell (Design Principle 1: race-critical paths work with no signal).
// Pages (HTML) are NETWORK-FIRST so a new deploy shows immediately when online, falling back to the cached
// copy only when offline. Static assets (icons, manifest) stay cache-first. Bump CACHE to purge old caches.
const CACHE = 'ljcoach-v3';
const ASSETS = [
  './', './index.html',
  './compare.html', './venue.html', './plan.html', './cockpit.html', './debrief.html', './trimcheck.html', './trimlab.html',
  './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './icon-180.png', './icon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                 // cross-origin (forecast API): let it go to network
  const isPage = req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/');
  if (isPage) {
    // network-first: always try the freshest page; cache it; fall back to cache (then index) offline
    e.respondWith(
      fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
  } else {
    // static assets: cache-first, then network (and cache)
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; }).catch(() => Response.error()))
    );
  }
});
