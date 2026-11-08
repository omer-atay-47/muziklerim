// İnternetsiz çalışma + "Paylaş → Müziklerim" ile gelen şarkıları alma
const VERSION = 'v7';
const APP = 'app-' + VERSION;
const IMG = 'img-v1';
const FILES = [
  './', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png',
  'css/app.css', 'js/app.js', 'js/ui.js', 'js/store.js', 'js/player.js', 'js/api.js', 'js/db.js', 'js/icons.js', 'js/tags.js',
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

/* ---------- Paylaşılan dosyaları "gelen kutusu"na koy ---------- */
function openInbox() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('muziklerim-inbox', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files', { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function receiveShare(request) {
  try {
    const form = await request.formData();
    const files = form.getAll('audio').filter(f => f && typeof f === 'object' && f.size);
    if (files.length) {
      const db = await openInbox();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite');
        const s = tx.objectStore('files');
        // File nesnesi adıyla birlikte saklanır
        for (const f of files) s.add(f);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(c => c.postMessage('inbox'));
    }
  } catch (err) {
    console.error('paylaşım alınamadı', err);
  }
  return Response.redirect(new URL('./#/', self.registration.scope).href, 303);
}

async function trimImages() {
  const c = await caches.open(IMG);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - 400; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);

  if (req.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/paylas')) {
    e.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== 'GET') return;

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
});
