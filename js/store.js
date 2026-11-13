// Kitaplık durumu: indirilenler, beğenilenler, listeler, indirme kuyruğu
import { db, splitName } from './db.js';
import { api } from './api.js';

const listeners = new Set();
export const on = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const emit = (type, data) => listeners.forEach(fn => { try { fn(type, data); } catch (e) { console.error(e); } });

export const lib = new Map();       // id -> track (veritabanındakiler)
export let playlists = [];
export const progress = new Map();  // id -> 0..100 (indiriliyor)
const queue = [];
let busy = false;

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

/* ---------- İndirme ---------- */
export function download(track) {
  if (track.source !== 'audius' || isDownloaded(track.id) || progress.has(track.id)) return;
  progress.set(track.id, 0);
  queue.push(track);
  emit('progress', { id: track.id, p: 0 });
  pump();
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const t = queue.shift();
    try {
      await fetchTrack(t);
      emit('toast', '“' + t.title + '” indirildi');
    } catch (err) {
      console.error(err);
      emit('toast', err && err.name === 'QuotaExceededError' ? 'Telefonda yer kalmadı' : '“' + t.title + '” indirilemedi');
    }
    progress.delete(t.id);
    emit('progress', { id: t.id, done: true });
    emit('library');
  }
  busy = false;
}

async function fetchTrack(t) {
  if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch {} }
  const res = await fetch(api.streamUrl(t.aid));
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const total = +res.headers.get('content-length') || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0, last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    const p = total ? Math.floor(got / total * 100) : Math.min(95, Math.floor(got / 8e6 * 100));
    if (p !== last) { last = p; progress.set(t.id, p); emit('progress', { id: t.id, p }); }
  }
  const file = new Blob(chunks, { type: res.headers.get('content-type') || 'audio/mpeg' });
  let artBlob = null;
  if (t.artwork) {
    const u = new URL(t.artwork);
    const urls = [t.artwork, ...(t.artMirrors || []).map(h => h.replace(/\/$/, '') + u.pathname)];
    for (const src of urls) {
      try { const r = await fetch(src); if (r.ok) { artBlob = await r.blob(); break; } } catch {}
    }
  }
  const cur = lib.get(t.id) || { ...strip(t), addedAt: Date.now() };
  Object.assign(cur, { downloaded: true, downloadedAt: Date.now(), size: file.size, hasArt: !!artBlob });
  await db.saveDownload(cur, file, artBlob);
  lib.set(cur.id, cur);
}

export async function removeDownload(track) {
  const cur = lib.get(track.id);
  if (!cur) return;
  if (cur.source === 'local') {
    await db.deleteTrack(cur.id);
    lib.delete(cur.id);
    for (const p of playlists) {
      if (p.trackIds.includes(cur.id)) { p.trackIds = p.trackIds.filter(x => x !== cur.id); await db.putPlaylist(p); }
    }
  } else {
    cur.downloaded = false;
    cur.hasArt = false;
    await db.removeFiles(cur.id);
    await saveMeta(cur);
  }
  emit('library');
}

/* ---------- Telefondan dosya ekleme ---------- */
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|wma|amr|3gp|webm|mp4)$/i;

const MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', webm: 'audio/webm', mp4: 'audio/mp4', amr: 'audio/amr', '3gp': 'audio/3gpp', wma: 'audio/x-ms-wma' };
export const isAudioFile = f => (f.type || '').startsWith('audio/') || AUDIO_EXT.test(f.name);
let importChain = Promise.resolve();

// Dosyaları sırayla ekler; aynı anda gelen eklemeler sıraya girer
export function importFiles(files) {
  importChain = importChain.then(() => doImport(files)).catch(e => console.error(e));
  return importChain;
}

async function doImport(all) {
  const files = [...all].filter(isAudioFile).filter(f => f.size > 20e3);
  const ignored = all.length - files.length;
  if (!files.length) {
    emit('toast', all.length ? 'Seçilenler arasında şarkı dosyası bulunamadı' : 'Dosya seçilmedi');
    return { added: 0 };
  }
  if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch {} }
  const { readTags } = await import('./tags.js');
  const existing = new Set([...lib.values()].filter(t => t.source === 'local').map(t => t.fileName + '|' + t.size));
  let added = 0, skipped = 0, failed = 0, full = false;
  emit('import', { done: 0, total: files.length });
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (existing.has(f.name + '|' + f.size)) { skipped++; emit('import', { done: i + 1, total: files.length }); continue; }
    const tags = /\.mp3$/i.test(f.name) || f.type === 'audio/mpeg' ? await readTags(f) : {};
    const base = f.name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() || 'Adsız şarkı';
    const fromName = splitName(base);
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    const type = f.type || MIME[ext] || 'audio/mpeg';
    const t = {
      id: 'l:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      title: tags.title || fromName.title,
      artist: tags.artist || fromName.artist,
      album: tags.album || '',
      duration: 0, source: 'local', downloaded: true,
      fileName: f.name, size: f.size, type, addedAt: Date.now() + i,
      hasArt: !!tags.picture,
    };
    try {
      const blob = f.type ? f : new Blob([f], { type });
      await db.saveDownload(t, blob, tags.picture || null);
      lib.set(t.id, t);
      existing.add(f.name + '|' + f.size);
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
  emit('toast', msg);
  return { added };
}

export async function setVideo(track, videoId) {
  const cur = lib.get(track.id) || { ...strip(track), addedAt: Date.now() };
  if (videoId) cur.videoId = videoId; else delete cur.videoId;
  lib.set(cur.id, cur);
  await db.putTrack(cur);
  emit('library');
  return cur;
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
