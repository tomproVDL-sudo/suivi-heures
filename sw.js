const CACHE_NAME = 'sirh-cache-v1';
const urlsToCache = [
  '/suivi-heures/',
  '/suivi-heures/index.html',
  '/suivi-heures/manifest.json',
  '/suivi-heures/icon-192.png',
  '/suivi-heures/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response; // Retourne la version en cache
        }
        return fetch(event.request); // Sinon, va chercher sur le réseau
      })
  );
});
