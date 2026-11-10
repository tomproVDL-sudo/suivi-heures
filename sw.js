// Service worker : fonctionnement hors-ligne + mises à jour fiables.
// ⚠️ Incrémentez VERSION à chaque déploiement : l'application proposera alors « Mettre à jour ».
const VERSION = 'v2.0.0';
const CACHE = `suivi-heures-${VERSION}`;
const CDN_CACHE = 'suivi-heures-cdn';

const CORE = [
  './', './index.html', './manifest.json', './css/app.css',
  './js/app.js', './js/config.js', './js/util.js', './js/calc.js', './js/db.js', './js/store.js', './js/ui.js', './js/icons.js',
  './js/dialogs.js', './js/charts.js', './js/export.js', './js/backup.js', './js/importer.js',
  './js/views/pointage.js', './js/views/planning.js', './js/views/stats.js', './js/views/donnees.js', './js/views/reglages.js',
  './icons/icon-192.png', './icons/icon-512.png',
];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdn.sheetjs.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('suivi-heures-') && k !== CACHE && k !== CDN_CACHE).map((k) => caches.delete(k)));
    // Nettoyage du cache de l'ancienne version de l'application
    await Promise.all(keys.filter((k) => k.startsWith('sirh-cache')).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => { if (event.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Bibliothèques CDN : cache d'abord, mise à jour en arrière-plan
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CDN_CACHE);
      const hit = await cache.match(req);
      const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })());
    return;
  }

  // Fichiers de l'application : version figée par le cache (cohérence garantie)
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (e) {
        if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
        throw e;
      }
    })());
  }
  // Tout le reste (API Supabase…) : réseau direct, non mis en cache
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => (list[0] ? list[0].focus() : self.clients.openWindow('./'))));
});
