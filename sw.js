// Versão do cache — altere este número a cada deploy para forçar atualização
const VERSION = '1.1.4';
const CACHE = `clemar-${VERSION}`;

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

// Instala e faz cache dos assets
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting()) // força ativação imediata
  );
});

// Remove caches antigos e assume controle imediato
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim()) // assume controle de todas as abas
      .then(() => {
        // Avisa todas as abas para recarregar
        self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(client => client.postMessage({ type: 'SW_UPDATED' }));
        });
      })
  );
});

// Estratégia: network first para HTML e JS, cache first para assets estáticos
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Supabase sempre vai para a rede
  if (url.hostname.includes('supabase.co')) {
    e.respondWith(fetch(e.request).catch(() => new Response('offline', { status: 503 })));
    return;
  }

  // CDN libs sempre da rede (jspdf, html2canvas, supabase-js)
  if (url.hostname.includes('cdn.jsdelivr.net') || url.hostname.includes('cdnjs.cloudflare.com')) {
    e.respondWith(
      fetch(e.request).then(resp => {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return resp;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // HTML e JS: network first — garante sempre a versão mais recente
  if (e.request.destination === 'document' ||
      e.request.url.endsWith('.js') ||
      e.request.url.endsWith('.css')) {
    e.respondWith(
      fetch(e.request).then(resp => {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return resp;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Imagens e demais: cache first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
      const clone = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return resp;
    }))
  );
});
