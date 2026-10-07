const CACHE_PREFIX = 'ocorrencias-bq-';
const WORKER_VERSION = '2026.10.06.5';
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
  const results = await Promise.allSettled(APP_SHELL.map(async (asset) => {
    const request = new Request(asset, { cache: 'reload' });
    const response = await fetch(request);
    if (!response.ok) throw new Error(`Falha ao armazenar ${asset}: ${response.status}`);
    if (asset === './' || asset === './index.html' || (/\.js\?/.test(asset) && asset !== versioned('./config.js'))) {
      const versions = [...(await response.clone().text()).matchAll(/(?:\?v=|APP_VERSION = ')(\d{4}\.\d{2}\.\d{2}\.\d+)/g)].map(match => match[1]);
      if (!versions.length || versions.some(version => version !== WORKER_VERSION)) throw new Error('Assets de releases diferentes; atualização adiada.');
    }
    await cache.put(request, response);
  }));
  const failed = results.find(result => result.status === 'rejected');
  if (failed) { await caches.delete(CACHE_NAME); throw failed.reason; }
}

async function cacheResponse(cache, request, response) {
  try { await cache.put(request, response); }
  catch (error) { console.warn('[PWA] Resposta disponível; não foi possível atualizar o cache.', { name: error?.name }); }
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
  if (url.searchParams.has('v') && url.searchParams.get('v') !== WORKER_VERSION) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match('./index.html');
        try {
          const response = await fetch(request);
          if (!response.ok) return cached || response;
          const html = await response.clone().text();
          const version = html.match(/app\.js\?v=([^"'&\s>]+)/)?.[1];
          if (cached && version !== WORKER_VERSION) return cached;
          if (version === WORKER_VERSION) event.waitUntil(cacheResponse(cache, './index.html', response.clone()));
          return response;
        } catch { return cached || Response.error(); }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) event.waitUntil(cacheResponse(cache, request, response.clone()));
        return response;
      } catch { return Response.error(); }
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
