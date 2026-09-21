const CACHE_PREFIX = 'ocorrencias-bq-';
const WORKER_VERSION = '2026.09.21.1';
const CACHE_NAME = `${CACHE_PREFIX}${WORKER_VERSION}`;
const versioned = (path) => `${path}?v=${WORKER_VERSION}`;
const APP_SHELL = [
  './',
  './index.html',
  versioned('./styles.css'),
  versioned('./config.js'),
  versioned('./core.js'),
  versioned('./db.js'),
  versioned('./api.js'),
  versioned('./app.js'),
  versioned('./manifest.webmanifest'),
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png'
];

async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(APP_SHELL.map(async (asset) => {
    const request = new Request(asset, { cache: 'reload' });
    const response = await fetch(request);
    if (!response.ok) throw new Error(`Falha ao armazenar ${asset}: ${response.status}`);
    await cache.put(request, response);
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheAppShell());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(async () => (
          await caches.match(request, { ignoreSearch: true })
          || await caches.match('./index.html')
        ))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached || Response.error());
      return cached || network;
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
