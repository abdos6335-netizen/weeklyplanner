// Service worker: يخزّن هيكل التطبيق ليعمل أوفلاين. غيّر VERSION عند نشر تحديث.
const VERSION = 'wp-v2.2.0';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/theme.js', 'js/i18n.js', 'js/icons.js', 'js/dates.js', 'js/firebase-config.js',
  'icons/logo.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-48.png',
];
// نطاقات خارجية نخزّنها أثناء التشغيل (الخطوط ووحدات Firebase). باقي الطلبات (Firestore/Auth) تمر مباشرة.
const CACHEABLE_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function staleWhileRevalidate(req, fallbackUrl) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
  const network = fetch(req)
    .then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) { network.catch(() => {}); return cached; }
  const res = await network;
  if (res) return res;
  if (fallbackUrl) { const fb = await cache.match(fallbackUrl); if (fb) return fb; }
  return new Response('', { status: 504, statusText: 'offline' });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(staleWhileRevalidate(req, req.mode === 'navigate' ? 'index.html' : null));
  } else if (CACHEABLE_HOSTS.includes(url.hostname)) {
    e.respondWith(staleWhileRevalidate(req));
  }
});
