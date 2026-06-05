const CACHE = 'clemar-v1';
const ASSETS = [
  '/Clemar-inspecao/',
  '/Clemar-inspecao/index.html',
  '/Clemar-inspecao/style.css',
  '/Clemar-inspecao/app.js',
  '/Clemar-inspecao/libs.js',
  '/Clemar-inspecao/logo-clemar.png',
  '/Clemar-inspecao/logo-clemar-pequeno.png',
  '/Clemar-inspecao/logo-clemar-cores.png',
  '/Clemar-inspecao/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Requisições ao Supabase sempre vão para a rede
  if (e.request.url.includes('supabase.co')) {
    e.respondWith(fetch(e.request).catch(() => new Response('offline', { status: 503 })));
    return;
  }
  // Demais assets: cache first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
      const clone = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return resp;
    }))
  );
});
