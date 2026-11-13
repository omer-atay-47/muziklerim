// Çalar: sıra, karışık/tekrar, kilit ekranı kontrolleri, uyku zamanlayıcı
import { db } from './db.js';
import { api } from './api.js';
import { emit, isDownloaded, known, lib, pushRecent } from './store.js';

const audio = new Audio();
audio.preload = 'auto';

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

export const current = () => state.queue[state.index] || null;
export const isPlaying = () => !audio.paused;
export const time = () => ({ cur: audio.currentTime || 0, dur: audio.duration || (current() && current().duration) || 0 });

const saveQueue = () => { ls.set('queue', state.queue.slice(0, 300)); ls.set('qindex', state.index); };
const changed = () => emit('player');

export const canPlay = t => isDownloaded(t.id) || (t.source === 'audius' && navigator.onLine);

async function load(autoplay = true, startAt = 0) {
  const t = current();
  if (!t) return;
  const seq = ++loadSeq;
  state.loading = true;
  changed();
  if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
  let src;
  if (isDownloaded(t.id)) {
    const blob = await db.getFile(t.id);
    if (seq !== loadSeq) return;
    if (blob) { objUrl = URL.createObjectURL(blob); src = objUrl; }
  }
  if (!src && t.source === 'audius') src = api.streamUrl(t.aid);
  if (!src) {
    state.loading = false;
    emit('toast', 'Bu şarkı artık telefonda yok');
    return;
  }
  if (!isDownloaded(t.id) && !navigator.onLine) {
    state.loading = false;
    emit('toast', 'İnternet yok. Bu şarkı indirilmemiş.');
    changed();
    return;
  }
  audio.src = src;
  if (startAt) {
    audio.addEventListener('loadedmetadata', () => { try { audio.currentTime = startAt; } catch {} }, { once: true });
  }
  saveQueue();
  ls.set('pos', 0);
  setMediaSession(t);
  if (autoplay) {
    try { await audio.play(); pushRecent(t); } catch (e) { if (e.name !== 'AbortError') console.warn(e); }
  }
  state.loading = false;
  changed();
}

export function playList(list, startIndex = 0) {
  if (!list.length) return;
  const items = list.map(known);
  let start = items[startIndex];
  if (!canPlay(start)) {
    const alt = items.findIndex(canPlay);
    if (alt < 0) { emit('toast', 'İnternet yok. Bu listede indirilmiş şarkı yok.'); return; }
    emit('toast', 'İnternet yok, indirilmiş şarkılar çalınıyor');
    startIndex = alt;
  }
  state.queue = items;
  state.index = startIndex;
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
  changed();
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
  saveQueue(); changed();
  emit('toast', 'Sıradaki şarkı olarak eklendi');
}

export function addToQueue(t) {
  if (!current()) { playList([t]); return; }
  state.queue.push(known(t));
  saveQueue(); changed();
  emit('toast', 'Sıraya eklendi');
}

export function jump(i) { if (state.queue[i]) { state.index = i; load(true); } }

export function removeAt(i) {
  if (i === state.index) return;
  state.queue.splice(i, 1);
  if (i < state.index) state.index--;
  saveQueue(); changed();
}

export function toggle() {
  if (!current()) return;
  if (!audio.src) { load(true, ls.get('pos', 0)); return; }
  if (audio.paused) audio.play().catch(() => {}); else audio.pause();
}

function pickNext(step) {
  const n = state.queue.length;
  if (!n) return -1;
  if (state.shuffle && step > 0 && n > 1) {
    const playable = state.queue.map((t, i) => i).filter(i => i !== state.index && canPlay(state.queue[i]));
    return playable.length ? playable[Math.floor(Math.random() * playable.length)] : -1;
  }
  for (let k = 1; k <= n; k++) {
    let i = state.index + step * k;
    if (i >= n || i < 0) {
      if (step > 0 && state.repeat === 'off' && !manual) return -1;
      i = (i % n + n) % n;
    }
    if (canPlay(state.queue[i])) return i;
  }
  return -1;
}
let manual = false;

export function next(auto = false) {
  if (auto && state.repeat === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
  manual = !auto;
  const i = pickNext(1);
  manual = false;
  if (i < 0) { audio.pause(); if (auto) { audio.currentTime = 0; } changed(); return; }
  state.index = i;
  load(true);
}

export function prev() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  manual = true;
  const i = pickNext(-1);
  manual = false;
  if (i < 0) { audio.currentTime = 0; return; }
  state.index = i;
  load(true);
}

export function seek(sec) { if (isFinite(sec)) audio.currentTime = sec; }

export function toggleShuffle() { state.shuffle = !state.shuffle; ls.set('shuffle', state.shuffle); changed(); return state.shuffle; }
export function cycleRepeat() {
  state.repeat = state.repeat === 'all' ? 'one' : state.repeat === 'one' ? 'off' : 'all';
  ls.set('repeat', state.repeat); changed(); return state.repeat;
}

export function setSleep(minutes) {
  clearTimeout(sleepTimer);
  state.sleepAt = 0; state.sleepEnd = false;
  if (minutes === 'end') state.sleepEnd = true;
  else if (minutes > 0) {
    state.sleepAt = Date.now() + minutes * 60e3;
    sleepTimer = setTimeout(() => { audio.pause(); state.sleepAt = 0; changed(); emit('toast', 'Uyku zamanlayıcı: müzik durduruldu'); }, minutes * 60e3);
  }
  changed();
}

/* Olaylar */
audio.addEventListener('play', () => { errStreak = 0; changed(); });
audio.addEventListener('pause', () => { ls.set('pos', audio.currentTime); changed(); });
audio.addEventListener('waiting', () => emit('buffer', true));
audio.addEventListener('playing', () => emit('buffer', false));
audio.addEventListener('ended', () => {
  if (state.sleepEnd) { state.sleepEnd = false; changed(); emit('toast', 'Uyku zamanlayıcı: müzik durduruldu'); return; }
  next(true);
});
let lastSave = 0;
audio.addEventListener('timeupdate', () => {
  emit('time');
  const now = Date.now();
  if (now - lastSave > 5000) { lastSave = now; ls.set('pos', audio.currentTime); }
  if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && isFinite(audio.duration)) {
    try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: 1 }); } catch {}
  }
});
audio.addEventListener('error', () => {
  if (!audio.getAttribute('src')) return;
  state.loading = false;
  errStreak++;
  changed();
  if (errStreak >= Math.min(5, state.queue.length)) { emit('toast', 'Şarkı çalınamadı. Bağlantıyı kontrol edin.'); return; }
  emit('toast', 'Şarkı çalınamadı, sıradakine geçiliyor');
  setTimeout(() => next(false), 1200);
});

/* Kilit ekranı / bildirim */
async function setMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  let artwork = [];
  if (artUrl) { URL.revokeObjectURL(artUrl); artUrl = null; }
  const saved = lib.get(t.id);
  if (saved && saved.hasArt) {
    const b = await db.getArt(t.id);
    if (b) { artUrl = URL.createObjectURL(b); artwork = [{ src: artUrl, sizes: '480x480', type: b.type || 'image/jpeg' }]; }
  }
  if (!artwork.length && t.artwork) artwork = [{ src: t.artwork, sizes: '480x480', type: 'image/jpeg' }];
  if (!artwork.length) artwork = [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }];
  navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist || 'Müziklerim', album: 'Müziklerim', artwork });
}
if ('mediaSession' in navigator) {
  const set = (a, h) => { try { navigator.mediaSession.setActionHandler(a, h); } catch {} };
  set('play', () => audio.play());
  set('pause', () => audio.pause());
  set('previoustrack', prev);
  set('nexttrack', () => next(false));
  set('seekto', d => { if (d.seekTime != null) audio.currentTime = d.seekTime; });
  set('seekbackward', () => { audio.currentTime = Math.max(0, audio.currentTime - 10); });
  set('seekforward', () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10); });
}

/* Uygulama açılınca: son şarkıyı hazırla (çalmadan) */
export function restore() {
  state.queue = state.queue.map(known);
  if (!current()) { state.index = -1; return; }
  setMediaSession(current());
  changed();
}

export function refreshQueueMeta() {
  state.queue = state.queue.map(t => lib.get(t.id) || t);
}

export { audio };
