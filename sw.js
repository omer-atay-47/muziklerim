// İnternetsiz çalışma: uygulama dosyalarını ve kapak görsellerini telefona kaydeder.
const VERSION = 'v4';
const APP = 'app-' + VERSION;
const IMG = 'img-v1';
const FILES = [
  './', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png',
  'css/app.css', 'js/app.js', 'js/ui.js', 'js/store.js', 'js/player.js', 'js/api.js', 'js/db.js', 'js/icons.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== APP && k !== IMG).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimImages() {
  const c = await caches.open(IMG);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - 400; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Uygulamanın kendi dosyaları: önce internet (güncel kalsın), olmazsa kayıtlı kopya
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(APP).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true })
        .then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
    );
    return;
  }

  // Kapak görselleri: önce kayıtlı kopya
  if (req.destination === 'image' && req.mode === 'no-cors' && /\.(jpe?g|png|webp)$/i.test(url.pathname)) {
    e.respondWith(
      caches.open(IMG).then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); trimImages(); }
        return res;
      })))
    );
  }
  // Ses akışları ve API: tarayıcıya bırak (önbelleğe alınmaz)
});
