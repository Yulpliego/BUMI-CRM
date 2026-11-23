const offlineCache = 'nexo-offline-v2';
const offlinePage = '/sin-conexion.html';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(offlineCache).then(cache => cache.add(offlinePage)));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('nexo-offline-') && key !== offlineCache)
      .map(key => caches.delete(key))
  )));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.mode !== 'navigate' || request.method !== 'GET' ||
      url.origin !== self.location.origin || /^\/api(?:\/|$)/.test(url.pathname)) return;
  event.respondWith(fetch(request).catch(async () => {
    const cache = await caches.open(offlineCache);
    return (await cache.match(offlinePage)) || Response.error();
  }));
});
