// Kitaplık durumu: telefondan eklenen şarkılar/klipler, favoriler, listeler.
// İnternet kullanılmaz; her şey telefonun içinde saklanır.
import { db, splitName } from './db.js';

const listeners = new Set();
export const on = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const emit = (type, data) => listeners.forEach(fn => { try { fn(type, data); } catch (e) { console.error(e); } });

export const lib = new Map();       // id -> track (veritabanındakiler)
export let playlists = [];
export const progress = new Map();  // (eski sürümden kalma, artık boş)

export async function loadLibrary() {
  const all = await db.allTracks();
  lib.clear();
  for (const t of all) lib.set(t.id, t);
  playlists = (await db.allPlaylists()).sort((a, b) => b.createdAt - a.createdAt);
  emit('library');
}

export const isDownloaded = id => !!(lib.get(id) && lib.get(id).downloaded);
export const isLiked = id => !!(lib.get(id) && lib.get(id).liked);
export const known = t => lib.get(t.id) || t;

const strip = t => {
  const { id, aid, title, artist, artistId, duration, artwork, artSmall, artMirrors, genre, source } = t;
  return { id, aid, title, artist, artistId, duration, artwork, artSmall, artMirrors, genre, source };
};

async function saveMeta(t) {
  if (!t.liked && !t.downloaded && !t.inPlaylist) {
    lib.delete(t.id);
    await db.deleteTrack(t.id);
  } else {
    lib.set(t.id, t);
    await db.putTrack(t);
  }
}

export async function toggleLike(track) {
  const cur = lib.get(track.id) || { ...strip(track), addedAt: Date.now() };
  cur.liked = !cur.liked;
  cur.likedAt = Date.now();
  await saveMeta(cur);
  emit('library');
  return cur.liked;
}

export async function removeDownload(track) {
  const cur = lib.get(track.id);
  if (!cur) return;
  await db.deleteTrack(cur.id);
  lib.delete(cur.id);
  for (const p of playlists) {
    if (p.trackIds.includes(cur.id)) { p.trackIds = p.trackIds.filter(x => x !== cur.id); await db.putPlaylist(p); }
  }
  emit('library');
}

/* ---------- Telefondan dosya ekleme ---------- */
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|wma|amr)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|3gp)$/i;

const MIME = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
  flac: 'audio/flac', amr: 'audio/amr', wma: 'audio/x-ms-wma',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', '3gp': 'video/3gpp',
};
export const isVideoFile = f => (f.type || '').startsWith('video/') || VIDEO_EXT.test(f.name);
export const isAudioFile = f => (f.type || '').startsWith('audio/') || AUDIO_EXT.test(f.name) || isVideoFile(f);

// Videodan kapak olarak bir kare ve süre al
function videoInfo(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    let done = false;
    const finish = (thumb, duration, audioOnly = false) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      try { v.load(); } catch {}
      URL.revokeObjectURL(url);
      resolve({ thumb, duration: isFinite(duration) ? duration : 0, audioOnly });
    };
    const timer = setTimeout(() => finish(null, v.duration), 8000);
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onloadedmetadata = () => {
      if (!v.videoWidth) { finish(null, v.duration, true); return; }   // sadece ses içeren dosya
      const d = isFinite(v.duration) ? v.duration : 0;
      try { v.currentTime = Math.min(d * 0.25, 20) || 1; } catch { finish(null, d); }
    };
    v.onseeked = () => {
      try {
        const w = Math.min(640, v.videoWidth);
        const h = Math.round(w * v.videoHeight / v.videoWidth);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(v, 0, 0, w, h);
        c.toBlob(b => finish(b, v.duration), 'image/jpeg', 0.82);
      } catch { finish(null, v.duration); }
    };
    v.onerror = () => finish(null, 0);
    v.src = url;
  });
}
let importChain = Promise.resolve();

// Dosyaları sırayla ekler; aynı anda gelen eklemeler sıraya girer
export function importFiles(files) {
  const job = importChain.then(() => doImport(files));
  importChain = job.catch(e => console.error(e));
  return job.catch(e => { console.error(e); return { added: 0, ids: [] }; });
}

async function doImport(all) {
  const files = [...all].filter(isAudioFile).filter(f => f.size > 20e3);
  const ignored = all.length - files.length;
  if (!files.length) {
    emit('toast', all.length ? 'Seçilenler arasında şarkı ya da klip dosyası bulunamadı' : 'Dosya seçilmedi');
    return { added: 0, ids: [] };
  }
  if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch {} }
  const { readTags } = await import('./tags.js');
  const existing = new Map([...lib.values()].map(t => [t.fileName + '|' + t.size, t.id]));
  const ids = [];   // seçilen dosyaların şarkı kimlikleri (yeni ya da zaten var)
  let added = 0, skipped = 0, failed = 0, full = false;
  emit('import', { done: 0, total: files.length });
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const key = f.name + '|' + f.size;
    if (existing.has(key)) { skipped++; ids.push(existing.get(key)); emit('import', { done: i + 1, total: files.length }); continue; }
    const video = isVideoFile(f);
    const tags = /\.mp3$/i.test(f.name) || f.type === 'audio/mpeg' ? await readTags(f) : {};
    const vinfo = video ? await videoInfo(f) : null;
    const base = f.name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() || 'Adsız şarkı';
    const fromName = splitName(base);
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    const type = f.type || MIME[ext] || (video ? 'video/mp4' : 'audio/mpeg');
    const t = {
      id: 'l:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      title: tags.title || fromName.title,
      artist: tags.artist || fromName.artist,
      album: tags.album || '',
      duration: (vinfo && vinfo.duration) || 0, source: 'local', downloaded: true,
      kind: video && !(vinfo && vinfo.audioOnly) ? 'video' : 'audio',
      fileName: f.name, size: f.size, type, addedAt: Date.now() + i,
      hasArt: !!(tags.picture || (vinfo && vinfo.thumb)),
    };
    try {
      const blob = f.type ? f : new Blob([f], { type });
      await db.saveDownload(t, blob, tags.picture || (vinfo && vinfo.thumb) || null);
      lib.set(t.id, t);
      existing.set(key, t.id);
      ids.push(t.id);
      added++;
    } catch (err) {
      console.error(err);
      failed++;
      if (err && err.name === 'QuotaExceededError') { full = true; break; }
    }
    emit('import', { done: i + 1, total: files.length });
    if (added && added % 15 === 0) emit('library');
  }
  emit('import', null);
  emit('library');
  let msg = full ? 'Telefonda yer kalmadı! ' : '';
  msg += added ? added + ' şarkı eklendi ✓' : 'Yeni şarkı eklenmedi';
  if (skipped) msg += ' · ' + skipped + ' tanesi zaten vardı';
  if (failed && !full) msg += ' · ' + failed + ' dosya eklenemedi';
  if (ignored && !added) msg += ' · ' + ignored + ' dosya şarkı değildi';
  if (!(added === 1 && !skipped && !failed)) emit('toast', msg);
  return { added, ids };
}

export async function renameTrack(track, title, artist) {
  const cur = lib.get(track.id);
  if (!cur) return;
  cur.title = title;
  cur.artist = artist;
  await db.putTrack(cur);
  emit('library');
}

/* ---------- Çalma listelerim ---------- */
export async function createPlaylist(name) {
  const p = { id: 'p' + Date.now().toString(36), name, trackIds: [], createdAt: Date.now() };
  await db.putPlaylist(p);
  playlists.unshift(p);
  emit('library');
  return p;
}

export async function addToPlaylist(p, track) {
  if (p.trackIds.includes(track.id)) return false;
  const cur = lib.get(track.id) || { ...strip(track), addedAt: Date.now() };
  cur.inPlaylist = true;
  await saveMeta(cur);
  p.trackIds.push(track.id);
  await db.putPlaylist(p);
  emit('library');
  return true;
}

export async function removeFromPlaylist(p, id) {
  p.trackIds = p.trackIds.filter(x => x !== id);
  await db.putPlaylist(p);
  const cur = lib.get(id);
  if (cur && !playlists.some(x => x.trackIds.includes(id))) { cur.inPlaylist = false; await saveMeta(cur); }
  emit('library');
}

export async function renamePlaylist(p, name) {
  p.name = name;
  await db.putPlaylist(p);
  emit('library');
}

export async function deletePlaylist(p) {
  await db.deletePlaylist(p.id);
  playlists = playlists.filter(x => x.id !== p.id);
  for (const id of p.trackIds) {
    const cur = lib.get(id);
    if (cur && !playlists.some(x => x.trackIds.includes(id))) { cur.inPlaylist = false; await saveMeta(cur); }
  }
  emit('library');
}

/* ---------- Son çalınanlar ---------- */
export function recent() {
  try { return JSON.parse(localStorage.getItem('recent') || '[]'); } catch { return []; }
}
export function pushRecent(t) {
  const list = recent().filter(x => x.id !== t.id);
  list.unshift(strip(t));
  try { localStorage.setItem('recent', JSON.stringify(list.slice(0, 20))); } catch {}
}
