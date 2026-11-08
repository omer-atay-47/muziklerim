'use strict';

/* ================== Veritabanı (şarkılar telefonun içinde saklanır) ================== */
const DB_NAME = 'muziklerim';
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(stores, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(t)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('İşlem iptal edildi'));
  }));
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const db = {
  allMeta: () => tx(['meta'], 'readonly', t => reqP(t.objectStore('meta').getAll())),
  getFile: id => tx(['files'], 'readonly', t => reqP(t.objectStore('files').get(id))),
  add: (meta, blob) => tx(['meta', 'files'], 'readwrite', t => {
    t.objectStore('meta').put(meta);
    t.objectStore('files').put(blob, meta.id);
  }),
  putMeta: meta => tx(['meta'], 'readwrite', t => { t.objectStore('meta').put(meta); }),
  remove: id => tx(['meta', 'files'], 'readwrite', t => {
    t.objectStore('meta').delete(id);
    t.objectStore('files').delete(id);
  }),
};

/* ================== Yardımcılar ================== */
const $ = id => document.getElementById(id);
const collator = new Intl.Collator('tr', { sensitivity: 'base', numeric: true });

function cleanTitle(fileName) {
  return fileName
    .replace(/\.[a-z0-9]{2,5}$/i, '')   // uzantıyı at
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Adsız şarkı';
}

function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
}

function fmtSize(bytes) {
  if (bytes > 1e9) return (bytes / 1e9).toFixed(1).replace('.', ',') + ' GB';
  return Math.round(bytes / 1e6) + ' MB';
}

let toastTimer;
function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
  catch { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* önemli değil */ }
}

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|wma|amr|3gp|webm|mp4)$/i;

/* ================== Durum ================== */
let songs = [];            // alfabetik sıralı meta listesi
let currentId = lsGet('currentId', null);
let shuffle = lsGet('shuffle', false);
let repeat = lsGet('repeat', 'all');   // 'all' | 'one' | 'off'
let currentUrl = null;
let menuSongId = null;
let pendingSeek = null;

const audio = $('audio');

/* ================== Liste ================== */
async function loadSongs() {
  songs = await db.allMeta();
  songs.sort((a, b) => collator.compare(a.title, b.title));
  render();
  updateStorage();
}

function render() {
  const q = $('search').value.trim().toLocaleLowerCase('tr');
  const list = $('list');
  list.textContent = '';

  $('count').textContent = songs.length ? songs.length + ' şarkı' : '';
  $('empty').hidden = songs.length > 0;
  $('searchWrap').hidden = songs.length < 8;

  const frag = document.createDocumentFragment();
  songs.forEach((s, i) => {
    if (q && !s.title.toLocaleLowerCase('tr').includes(q)) return;
    const li = document.createElement('li');
    li.className = 'song' + (s.id === currentId ? ' playing' : '');
    li.dataset.id = s.id;

    const main = document.createElement('button');
    main.className = 'song-main';
    main.setAttribute('aria-label', s.title + ' çal');
    const num = document.createElement('span');
    num.className = 'song-num';
    num.textContent = (s.id === currentId && !audio.paused) ? '♪' : String(i + 1);
    const title = document.createElement('span');
    title.className = 'song-title';
    title.textContent = s.title;
    main.append(num, title);
    main.onclick = () => {
      if (s.id === currentId) togglePlay();
      else playSong(s.id);
    };

    const more = document.createElement('button');
    more.className = 'song-more';
    more.setAttribute('aria-label', 'Seçenekler');
    more.textContent = '⋮';
    more.onclick = () => openMenu(s.id);

    li.append(main, more);
    frag.appendChild(li);
  });
  list.appendChild(frag);

  if (q && !list.children.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Bu isimde şarkı bulunamadı.';
    list.appendChild(p);
  }
}

async function updateStorage() {
  if (!navigator.storage || !navigator.storage.estimate) return;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (!songs.length) { $('storage').textContent = ''; return; }
    $('storage').textContent = 'Kullanılan alan: ' + fmtSize(usage) +
      (quota ? '  ·  Boş yer: ' + fmtSize(Math.max(0, quota - usage)) : '');
  } catch { /* yok say */ }
}

/* ================== Şarkı ekleme ================== */
$('addBtn').onclick = () => $('fileInput').click();

$('fileInput').onchange = async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;

  // Tarayıcıdan, şarkıları kalıcı saklamasını iste (silinmesin diye)
  if (navigator.storage && navigator.storage.persist) {
    try { await navigator.storage.persist(); } catch { /* yok say */ }
  }

  const existing = new Set(songs.map(s => s.fileName + '|' + s.size));
  let added = 0, skipped = 0, failed = 0;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!(f.type.startsWith('audio/') || AUDIO_EXT.test(f.name) || f.type === 'video/mp4')) { failed++; continue; }
    if (existing.has(f.name + '|' + f.size)) { skipped++; continue; }
    if (files.length > 1) toast('Ekleniyor... ' + (i + 1) + ' / ' + files.length, 60000);
    const meta = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      title: cleanTitle(f.name),
      fileName: f.name,
      size: f.size,
      type: f.type || 'audio/mpeg',
      added: Date.now(),
    };
    try {
      await db.add(meta, f);
      existing.add(f.name + '|' + f.size);
      added++;
    } catch (err) {
      console.error(err);
      failed++;
      if (err && err.name === 'QuotaExceededError') { toast('Telefonda yer kalmadı!', 5000); break; }
    }
  }

  await loadSongs();
  let msg = added ? added + ' şarkı eklendi ✓' : 'Şarkı eklenmedi';
  if (skipped) msg += ' · ' + skipped + ' tanesi zaten vardı';
  if (failed) msg += ' · ' + failed + ' dosya eklenemedi';
  toast(msg, 4000);
};

/* ================== Çalma ================== */
async function playSong(id, { autoplay = true, startAt = 0 } = {}) {
  const meta = songs.find(s => s.id === id);
  if (!meta) return;
  const blob = await db.getFile(id);
  if (!blob) { toast('Şarkı dosyası bulunamadı'); return; }

  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = URL.createObjectURL(blob);
  currentId = id;
  lsSet('currentId', id);
  lsSet('position', 0);

  audio.src = currentUrl;
  pendingSeek = startAt > 0 ? startAt : null;
  $('player').hidden = false;
  $('nowTitle').textContent = meta.title;
  document.title = meta.title + ' · Müziklerim';
  updateMediaSession(meta);

  if (autoplay) {
    try { await audio.play(); }
    catch (err) { console.warn(err); if (err.name === 'NotSupportedError') toast('Bu dosya çalınamıyor'); }
  }
  render();
  scrollToCurrent();
}

function scrollToCurrent() {
  const el = document.querySelector('.song.playing');
  if (!el) return;
  const r = el.getBoundingClientRect();
  const bottomLimit = window.innerHeight - $('player').offsetHeight;
  if (r.top < 0 || r.bottom > bottomLimit) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function togglePlay() {
  if (!currentId) { if (songs.length) playSong(songs[0].id); return; }
  if (!audio.src) { playSong(currentId); return; }
  if (audio.paused) audio.play().catch(() => {}); else audio.pause();
}

function indexOfCurrent() { return songs.findIndex(s => s.id === currentId); }

function next(auto = false) {
  if (!songs.length) return;
  if (auto && repeat === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
  let idx = indexOfCurrent();
  if (shuffle && songs.length > 1) {
    let r;
    do { r = Math.floor(Math.random() * songs.length); } while (r === idx);
    idx = r;
  } else {
    idx++;
    if (idx >= songs.length) {
      if (auto && repeat === 'off') { audio.pause(); audio.currentTime = 0; return; }
      idx = 0;
    }
  }
  playSong(songs[idx].id);
}

function prev() {
  if (!songs.length) return;
  // Şarkının başından 3 saniyeden fazla geçtiyse başa sar
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  let idx = indexOfCurrent() - 1;
  if (idx < 0) idx = songs.length - 1;
  playSong(songs[idx].id);
}

$('playBtn').onclick = togglePlay;
$('nextBtn').onclick = () => next(false);
$('prevBtn').onclick = prev;

function updateModeButtons() {
  $('shuffleBtn').classList.toggle('on', shuffle);
  $('repeatBtn').classList.toggle('on', repeat !== 'off');
  $('repeatLabel').textContent = repeat === 'one' ? 'Bu şarkı' : repeat === 'all' ? 'Tekrar' : 'Tekrar yok';
}
$('shuffleBtn').onclick = () => {
  shuffle = !shuffle; lsSet('shuffle', shuffle); updateModeButtons();
  toast(shuffle ? 'Karışık çalma açık' : 'Sırayla çalınacak');
};
$('repeatBtn').onclick = () => {
  repeat = repeat === 'all' ? 'one' : repeat === 'one' ? 'off' : 'all';
  lsSet('repeat', repeat); updateModeButtons();
  toast(repeat === 'all' ? 'Liste bitince baştan başlar' : repeat === 'one' ? 'Bu şarkı tekrar tekrar çalar' : 'Liste bitince durur');
};

/* Ses olayları */
audio.addEventListener('loadedmetadata', () => {
  $('dur').textContent = fmtTime(audio.duration);
  if (pendingSeek) { audio.currentTime = Math.min(pendingSeek, audio.duration - 1); pendingSeek = null; }
});
let seeking = false;
let lastSave = 0;
audio.addEventListener('timeupdate', () => {
  if (!seeking && audio.duration) $('seek').value = Math.round(audio.currentTime / audio.duration * 1000);
  $('cur').textContent = fmtTime(audio.currentTime);
  const now = Date.now();
  if (now - lastSave > 4000) { lastSave = now; lsSet('position', audio.currentTime); }
  if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && audio.duration) {
    try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: audio.currentTime, playbackRate: 1 }); } catch {}
  }
});
function syncPlayIcon() {
  const playing = !audio.paused;
  $('icoPlay').toggleAttribute('hidden', playing);
  $('icoPause').toggleAttribute('hidden', !playing);
  $('playBtn').setAttribute('aria-label', playing ? 'Duraklat' : 'Çal');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  const num = document.querySelector('.song.playing .song-num');
  if (num) num.textContent = playing ? '♪' : String(indexOfCurrent() + 1);
}
audio.addEventListener('play', syncPlayIcon);
audio.addEventListener('pause', () => { syncPlayIcon(); lsSet('position', audio.currentTime); });
audio.addEventListener('ended', () => next(true));
let errorStreak = 0;
audio.addEventListener('playing', () => { errorStreak = 0; });
audio.addEventListener('error', () => {
  if (!audio.getAttribute('src')) return;
  errorStreak++;
  if (errorStreak >= songs.length) { toast('Şarkılar çalınamadı', 4000); return; }
  toast('Bu şarkı çalınamadı, sıradakine geçiliyor');
  setTimeout(() => next(false), 1500);
});

$('seek').addEventListener('input', () => {
  seeking = true;
  if (audio.duration) $('cur').textContent = fmtTime($('seek').value / 1000 * audio.duration);
});
$('seek').addEventListener('change', () => {
  if (audio.duration) audio.currentTime = $('seek').value / 1000 * audio.duration;
  seeking = false;
});

/* Kilit ekranı / bildirim kontrolleri */
function updateMediaSession(meta) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: meta.title,
    artist: 'Müziklerim',
    artwork: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  });
}
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const set = (a, h) => { try { ms.setActionHandler(a, h); } catch {} };
  set('play', () => audio.play());
  set('pause', () => audio.pause());
  set('previoustrack', prev);
  set('nexttrack', () => next(false));
  set('seekto', d => { if (d.seekTime != null) audio.currentTime = d.seekTime; });
}

/* ================== Menü: yeniden adlandır / sil ================== */
function openMenu(id) {
  const s = songs.find(x => x.id === id);
  if (!s) return;
  menuSongId = id;
  $('sheetTitle').textContent = s.title;
  $('sheet').hidden = false;
}
function closeMenu() { $('sheet').hidden = true; menuSongId = null; }
$('cancelBtn').onclick = closeMenu;
$('sheet').onclick = e => { if (e.target === $('sheet')) closeMenu(); };

$('renameBtn').onclick = async () => {
  const s = songs.find(x => x.id === menuSongId);
  closeMenu();
  if (!s) return;
  const name = prompt('Şarkının yeni adı:', s.title);
  if (name === null) return;
  const t = name.trim();
  if (!t) return;
  s.title = t;
  await db.putMeta(s);
  if (s.id === currentId) { $('nowTitle').textContent = t; updateMediaSession(s); }
  await loadSongs();
  toast('Ad değiştirildi ✓');
};

$('deleteBtn').onclick = async () => {
  const s = songs.find(x => x.id === menuSongId);
  closeMenu();
  if (!s) return;
  if (!confirm('“' + s.title + '” silinsin mi?\n\nBu şarkı uygulamadan kaldırılır.')) return;
  if (s.id === currentId) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    currentId = null;
    lsSet('currentId', null);
    $('player').hidden = true;
    document.title = 'Müziklerim';
  }
  await db.remove(s.id);
  await loadSongs();
  toast('Şarkı silindi');
};

/* Arama */
$('search').addEventListener('input', render);

/* ================== Başlangıç ================== */
async function init() {
  updateModeButtons();
  try {
    await loadSongs();
  } catch (err) {
    console.error(err);
    toast('Şarkılar yüklenemedi. Uygulamayı kapatıp açın.', 6000);
    return;
  }
  // En son çalınan şarkıyı hazırla (otomatik başlatmadan)
  if (currentId && songs.some(s => s.id === currentId)) {
    await playSong(currentId, { autoplay: false, startAt: lsGet('position', 0) });
  } else {
    currentId = null;
  }
}
init();

/* İnternetsiz çalışma için */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW:', err));
  });
}
