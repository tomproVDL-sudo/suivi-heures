// Service worker : fonctionnement hors-ligne + mises à jour fiables.
// Les fichiers de l'application sont toujours demandés au réseau d'abord (une nouvelle
// version déployée sur GitHub est donc prise en compte immédiatement) ; le cache ne sert
// qu'en secours, hors-ligne ou si le réseau met plus de 3 s à répondre.
const VERSION = 'v2.0.2';
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

  // Fichiers de l'application : réseau d'abord, cache en secours
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const network = fetch(req, { cache: 'no-cache' }).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; });
      const timeout = new Promise((resolve) => setTimeout(resolve, 3000));
      try {
        const res = await Promise.race([network, timeout]);
        if (res) return res;
      } catch { /* hors-ligne */ }
      const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
      if (hit) return hit;
      return network.catch(() => Response.error());
    })());
    return;
  }
  // Tout le reste (API Supabase…) : réseau direct, non mis en cache
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => (list[0] ? list[0].focus() : self.clients.openWindow('./'))));
});
