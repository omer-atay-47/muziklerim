// Çalar: sıra, karışık/tekrar, kilit ekranı kontrolleri, uyku zamanlayıcı.
// Her şey telefondaki dosyalardan çalar; internet kullanılmaz.
// Ses dosyaları <audio> ile, klipler (video dosyaları) ekran açıkken <video> ile oynatılır.
//
// iPhone notları:
// - Ekran kilitliyken şarkı bitince sıradakine geçebilmek için sıradaki dosya ÖNCEDEN hazırlanır;
//   böylece "bitti" anında beklemeden çalmaya başlar (bekleme olursa iPhone çalmayı reddedebilir).
// - Kilit ekranına çalıyor/durdu bilgisi her değişimde bildirilir; yoksa iPhone süreyi
//   ilerletmeye devam eder ve "çalıyor ama ses yok" gibi görünür.
// - Bir bekçi, takılan ya da bitip geçmeyen şarkıyı fark edip düzeltir.
import { db } from './db.js';
import { emit, isDownloaded, known, lib, memFile, pushRecent } from './store.js';

const audioEl = new Audio();
audioEl.preload = 'auto';

const videoEl = document.createElement('video');
videoEl.preload = 'auto';
videoEl.playsInline = true;
videoEl.setAttribute('playsinline', '');
videoEl.setAttribute('webkit-playsinline', '');
videoEl.className = 'np-video';
// Çalar kapalıyken video görünmez bir yerde durur
const host = document.getElementById('mediaHost');
host.appendChild(videoEl);

let media = audioEl;   // şu an kullanılan oynatıcı

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

export const state = {
  queue: ls.get('queue', []),
  index: ls.get('qindex', -1),
  shuffle: ls.get('shuffle', false),
  repeat: ls.get('repeat', 'all'),   // all | one | off
  loading: false,
  sleepAt: 0,
  sleepEnd: false,
};
let objUrl = null, artUrl = null;
let loadSeq = 0;
let errStreak = 0;
let sleepTimer = null;
let blocked = false;      // iPhone çalmayı reddetti; kullanıcı dokununca tekrar denenecek
let nextPre = null;       // { id, index, url } önceden hazırlanmış sıradaki şarkı

export const isVideo = t => !!t && t.kind === 'video';
export const current = () => state.queue[state.index] || null;
export const isPlaying = () => !media.paused;
export const time = () => ({ cur: media.currentTime || 0, dur: (isFinite(media.duration) && media.duration) || (current() && current().duration) || 0 });
export const video = videoEl;
export const videoActive = () => media === videoEl;
export const element = () => media;   // şu an çalan oynatıcı (test ve hata ayıklama için)

const saveQueue = () => { ls.set('queue', state.queue.slice(0, 300)); ls.set('qindex', state.index); };
const changed = () => emit('player');

export const canPlay = t => isDownloaded(t.id);

/* ---------- Kilit ekranı bilgisi ---------- */
function syncSession() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  try { ms.playbackState = !current() ? 'none' : (media.paused ? 'paused' : 'playing'); } catch {}
  if (ms.setPositionState && isFinite(media.duration) && media.duration > 0) {
    try {
      ms.setPositionState({
        duration: media.duration,
        position: Math.min(media.currentTime || 0, media.duration),
        playbackRate: media.paused ? 0 : (media.playbackRate || 1),
      });
    } catch {}
  }
}

/* ---------- Oynatıcı değiştirme ---------- */
function useElement(el) {
  if (media === el) return;
  const other = media;
  media = el;
  other.pause();
  other.removeAttribute('src');
  try { other.load(); } catch {}
}

// Çalan şarkıyı kesmeden diğer oynatıcıya aktar (klip ↔ sadece ses)
function transferTo(el) {
  if (media === el || !media.getAttribute('src')) return;
  const from = media;
  const at = from.currentTime || 0;
  const wasPlaying = !from.paused;
  const url = from.getAttribute('src');
  el.src = url;
  el.addEventListener('loadedmetadata', () => { try { el.currentTime = at; } catch {} }, { once: true });
  media = el;
  from.pause();
  from.removeAttribute('src');
  try { from.load(); } catch {}
  if (wasPlaying) el.play().catch(onPlayFail);
  changed();
}

// Klip açıkken ekran kilitlenirse sesi kesmemek için sese geç; ekran açılınca çalar ekranı videoya geri döner
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (media === videoEl && !videoEl.paused) transferTo(audioEl);
  } else {
    if (blocked) retryPlay();
    emit('visible');
  }
});

// Ekran açıkken klip videoyla gösterilsin (çalar ekranı açılınca çağrılır)
export function ensureVideo() {
  const t = current();
  if (!t || !isVideo(t) || document.hidden || media === videoEl) return;
  transferTo(videoEl);
}

function onPlayFail(e) {
  if (e && e.name === 'AbortError') return;
  console.warn('çalma reddedildi', e);
  blocked = true;
  syncSession();
  changed();
}
function retryPlay() {
  if (!blocked || !media.getAttribute('src')) return;
  blocked = false;
  media.play().catch(onPlayFail);
}
// İlk dokunuşta iki oynatıcıyı da "kilitsiz" hale getir (iPhone ancak dokunuşla izin veriyor)
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
let unlocked = false;
function unlock() {
  if (blocked) retryPlay();
  if (unlocked) return;
  unlocked = true;
  for (const el of [audioEl, videoEl]) {
    if (el.getAttribute('src')) continue;
    el.muted = true;
    el.src = SILENT;
    el.play().then(() => {
      if (el.getAttribute('src') === SILENT) el.pause();   // gerçek şarkı başladıysa dokunma
    }).catch(() => {}).finally(() => {
      if (el.getAttribute('src') === SILENT) { el.removeAttribute('src'); try { el.load(); } catch {} }
      el.muted = false;
    });
  }
}
document.addEventListener('pointerdown', unlock, true);
document.addEventListener('touchend', unlock, true);

/* ---------- Sıradakini önceden hazırla ---------- */
function dropPre() {
  if (nextPre && nextPre.url !== objUrl) URL.revokeObjectURL(nextPre.url);
  nextPre = null;
}

async function preloadNext() {
  const i = pickNext(1, true);
  if (i < 0 || i === state.index) { dropPre(); return; }
  const t = state.queue[i];
  if (nextPre && nextPre.id === t.id && nextPre.index === i) return;
  dropPre();
  const blob = memFile(t.id) || await db.getFile(t.id).catch(() => null);
  if (!blob) return;
  // bu arada sıra değiştiyse vazgeç
  if (state.queue[i] !== t) return;
  if (nextPre) dropPre();
  nextPre = { id: t.id, index: i, url: URL.createObjectURL(blob) };
}

/* ---------- Yükle ve çal ---------- */
async function load(autoplay = true, startAt = 0) {
  const t = current();
  if (!t) return;
  const seq = ++loadSeq;
  let url = null;
  if (nextPre && nextPre.id === t.id) {
    // hazır: hiç beklemeden çal (kilit ekranında da çalışsın)
    url = nextPre.url;
    nextPre = null;
  } else {
    state.loading = true;
    changed();
    // yeni seçilen şarkı henüz kaydedilmediyse bellekteki dosyadan hemen çal
    const blob = memFile(t.id) || await db.getFile(t.id).catch(() => null);
    if (seq !== loadSeq) return;
    if (!blob) {
      state.loading = false;
      emit('toast', 'Bu şarkı artık telefonda yok');
      changed();
      return;
    }
    url = URL.createObjectURL(blob);
  }
  const old = objUrl;
  objUrl = url;
  // ekran kilitliyken klipler de ses oynatıcısıyla çalar
  useElement(isVideo(t) && !document.hidden ? videoEl : audioEl);
  media.src = url;
  if (startAt) {
    media.addEventListener('loadedmetadata', () => { try { media.currentTime = startAt; } catch {} }, { once: true });
  }
  if (old && old !== url) setTimeout(() => URL.revokeObjectURL(old), 3000);
  saveQueue();
  ls.set('pos', 0);
  setMediaSession(t);
  blocked = false;
  if (autoplay) {
    const p = media.play();
    state.loading = false;
    changed();
    try { await p; pushRecent(t); } catch (e) { onPlayFail(e); }
  } else {
    state.loading = false;
    changed();
  }
  preloadNext();
}

export function playList(list, startIndex = 0) {
  if (!list.length) return;
  const items = list.map(known);
  if (!canPlay(items[startIndex])) {
    const alt = items.findIndex(canPlay);
    if (alt < 0) { emit('toast', 'Bu listede çalınabilecek şarkı yok'); return; }
    startIndex = alt;
  }
  state.queue = items;
  state.index = startIndex;
  dropPre();
  load(true);
}

// Çalan şarkıyı kesmeden sırayı yeni listeyle değiştir
export function adoptQueue(list, index) {
  const items = list.map(known);
  if (!items[index] || !current() || items[index].id !== current().id) return;
  const same = items.length === state.queue.length && items.every((t, i) => t.id === state.queue[i].id);
  if (same) return;
  state.queue = items;
  state.index = index;
  saveQueue();
  queueChanged();
}

function queueChanged() {
  dropPre();
  changed();
  preloadNext();
}

export function playShuffled(list) {
  if (!list.length) return;
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  playList(arr, 0);
}

export function playNext(t) {
  if (!current()) { playList([t]); return; }
  state.queue.splice(state.index + 1, 0, known(t));
  saveQueue(); queueChanged();
  emit('toast', 'Sıradaki şarkı olarak eklendi');
}

export function addToQueue(t) {
  if (!current()) { playList([t]); return; }
  state.queue.push(known(t));
  saveQueue(); queueChanged();
  emit('toast', 'Sıraya eklendi');
}

export function jump(i) { if (state.queue[i]) { state.index = i; load(true); } }

export function removeAt(i) {
  if (i === state.index) return;
  state.queue.splice(i, 1);
  if (i < state.index) state.index--;
  saveQueue(); queueChanged();
}

export function toggle() {
  if (!current()) return;
  if (!media.getAttribute('src') || media.getAttribute('src') === SILENT) { load(true, ls.get('pos', 0)); return; }
  if (media.paused) { blocked = false; media.play().catch(onPlayFail); } else media.pause();
}

// peek: sadece bak (karışıkta önceden seçilen sıradakini kullan)
function pickNext(step, peek = false) {
  const n = state.queue.length;
  if (!n) return -1;
  if (state.shuffle && step > 0 && n > 1) {
    if (nextPre && state.queue[nextPre.index] && state.queue[nextPre.index].id === nextPre.id) return nextPre.index;
    const playable = state.queue.map((t, i) => i).filter(i => i !== state.index && canPlay(state.queue[i]));
    return playable.length ? playable[Math.floor(Math.random() * playable.length)] : -1;
  }
  for (let k = 1; k <= n; k++) {
    let i = state.index + step * k;
    if (i >= n || i < 0) {
      if (step > 0 && state.repeat === 'off' && !manual && !peek) return -1;
      if (step > 0 && state.repeat === 'off' && peek) return -1;
      i = (i % n + n) % n;
    }
    if (canPlay(state.queue[i])) return i;
  }
  return -1;
}
let manual = false;

export function next(auto = false) {
  if (auto && state.repeat === 'one') { media.currentTime = 0; media.play().catch(onPlayFail); return; }
  manual = !auto;
  const i = pickNext(1);
  manual = false;
  if (i < 0) { media.pause(); if (auto) media.currentTime = 0; changed(); return; }
  state.index = i;
  load(true);
}

export function prev() {
  if (media.currentTime > 3) { media.currentTime = 0; return; }
  manual = true;
  const i = pickNext(-1);
  manual = false;
  if (i < 0) { media.currentTime = 0; return; }
  state.index = i;
  load(true);
}

export function seek(sec) { if (isFinite(sec)) { media.currentTime = sec; syncSession(); } }

export function toggleShuffle() { state.shuffle = !state.shuffle; ls.set('shuffle', state.shuffle); queueChanged(); return state.shuffle; }
export function cycleRepeat() {
  state.repeat = state.repeat === 'all' ? 'one' : state.repeat === 'one' ? 'off' : 'all';
  ls.set('repeat', state.repeat); queueChanged(); return state.repeat;
}

export function setSleep(minutes) {
  clearTimeout(sleepTimer);
  state.sleepAt = 0; state.sleepEnd = false;
  if (minutes === 'end') state.sleepEnd = true;
  else if (minutes > 0) {
    state.sleepAt = Date.now() + minutes * 60e3;
    sleepTimer = setTimeout(() => { media.pause(); state.sleepAt = 0; changed(); emit('toast', 'Uyku zamanlayıcı: müzik durduruldu'); }, minutes * 60e3);
  }
  changed();
}

/* ---------- Olaylar (sadece kullanılan oynatıcıdan gelenler dikkate alınır) ---------- */
let lastSave = 0;
for (const el of [audioEl, videoEl]) {
  const mine = fn => e => { if (e.target === media && media.getAttribute('src') !== SILENT) fn(e); };
  el.addEventListener('play', mine(() => { errStreak = 0; blocked = false; syncSession(); changed(); }));
  el.addEventListener('playing', mine(() => { syncSession(); }));
  el.addEventListener('pause', mine(() => { ls.set('pos', media.currentTime); syncSession(); changed(); }));
  el.addEventListener('seeked', mine(syncSession));
  el.addEventListener('loadedmetadata', mine(() => {
    const t = current();
    if (t && isFinite(media.duration) && !t.duration) {
      t.duration = media.duration;
      const saved = lib.get(t.id);
      if (saved && !saved.duration) { saved.duration = media.duration; db.putTrack(saved).catch(() => {}); }
    }
    syncSession();
    changed();
  }));
  el.addEventListener('ended', mine(() => {
    if (state.sleepEnd) { state.sleepEnd = false; syncSession(); changed(); emit('toast', 'Uyku zamanlayıcı: müzik durduruldu'); return; }
    next(true);
  }));
  el.addEventListener('timeupdate', mine(() => {
    emit('time');
    const now = Date.now();
    if (now - lastSave > 5000) { lastSave = now; ls.set('pos', media.currentTime); syncSession(); }
  }));
  el.addEventListener('error', mine(() => {
    if (!media.getAttribute('src')) return;
    state.loading = false;
    errStreak++;
    changed();
    if (errStreak >= Math.min(5, state.queue.length)) { emit('toast', 'Bu dosya çalınamadı. Dosya bozuk ya da desteklenmiyor olabilir.'); return; }
    emit('toast', 'Bu dosya çalınamadı, sıradakine geçiliyor');
    setTimeout(() => next(false), 1200);
  }));
}

/* ---------- Bekçi: takılmaları fark edip düzelt ---------- */
let lastPos = -1, stuckTicks = 0, endedTicks = 0;
setInterval(() => {
  if (!current() || state.loading || !media.getAttribute('src') || media.getAttribute('src') === SILENT) { stuckTicks = 0; endedTicks = 0; return; }
  // şarkı bitti ama sıradakine geçilmedi
  if (media.ended && !state.sleepEnd) {
    if (++endedTicks >= 2) { endedTicks = 0; next(true); }
    return;
  }
  endedTicks = 0;
  // "çalıyor" görünüyor ama ilerlemiyor
  if (!media.paused) {
    if (Math.abs(media.currentTime - lastPos) < 0.05) stuckTicks++;
    else stuckTicks = 0;
    if (stuckTicks >= 3) {
      stuckTicks = 0;
      const at = media.currentTime;
      // bitime çok yakınsa sıradakine geç, değilse aynı yerden yeniden başlat
      if (isFinite(media.duration) && media.duration - at < 1.5) next(true);
      else {
        try { media.pause(); media.playbackRate = 1; media.currentTime = at + 0.1; } catch {}
        media.play().catch(onPlayFail);
      }
    }
  } else stuckTicks = 0;
  lastPos = media.currentTime;
  syncSession();
}, 2000);

/* ---------- Kilit ekranı / bildirim ---------- */
async function setMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  let artwork = [];
  if (artUrl) { URL.revokeObjectURL(artUrl); artUrl = null; }
  const saved = lib.get(t.id);
  if (saved && saved.hasArt) {
    const b = await db.getArt(t.id).catch(() => null);
    if (b) { artUrl = URL.createObjectURL(b); artwork = [{ src: artUrl, sizes: '480x480', type: b.type || 'image/jpeg' }]; }
  }
  if (!artwork.length) artwork = [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }];
  try { navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist || 'Müziklerim', album: 'Müziklerim', artwork }); } catch {}
  syncSession();
}
if ('mediaSession' in navigator) {
  const set = (a, h) => { try { navigator.mediaSession.setActionHandler(a, h); } catch {} };
  set('play', () => { blocked = false; if (!media.getAttribute('src')) load(true, ls.get('pos', 0)); else media.play().catch(onPlayFail); });
  set('pause', () => media.pause());
  set('stop', () => media.pause());
  set('previoustrack', prev);
  set('nexttrack', () => next(false));
  set('seekto', d => { if (d.seekTime != null) { media.currentTime = d.seekTime; syncSession(); } });
  // 10 sn geri/ileri düğmelerini kaldır ki kilit ekranında önceki/sonraki şarkı düğmeleri görünsün
  set('seekbackward', null);
  set('seekforward', null);
}

/* ---------- Uygulama açılınca: son şarkıyı hazırla (çalmadan) ---------- */
export function restore() {
  const curId = current() && current().id;
  state.queue = state.queue.map(known).filter(t => isDownloaded(t.id));
  state.index = state.queue.findIndex(t => t.id === curId);
  if (!current()) { state.index = -1; return; }
  setMediaSession(current());
  changed();
}

export function refreshQueueMeta() {
  state.queue = state.queue.map(t => lib.get(t.id) || t);
}
