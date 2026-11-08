// Telefonun içindeki veritabanı: indirilen şarkılar, beğeniler, listeler
const DB_NAME = 'muziklerim';
const VERSION = 2;
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = e => {
      const db = req.result;
      const tx = req.transaction;
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      if (!db.objectStoreNames.contains('art')) db.createObjectStore('art');
      if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('tracks')) {
        const tracks = db.createObjectStore('tracks', { keyPath: 'id' });
        // Eski sürümde (v1) eklenmiş şarkıları taşı
        if (e.oldVersion === 1 && db.objectStoreNames.contains('meta')) {
          tx.objectStore('meta').openCursor().onsuccess = ev => {
            const cur = ev.target.result;
            if (!cur) return;
            const m = cur.value;
            const split = splitName(m.title);
            tracks.put({
              id: m.id, title: split.title, artist: split.artist, duration: 0,
              source: 'local', downloaded: true, addedAt: m.added || Date.now(),
              size: m.size, type: m.type,
            });
            cur.continue();
          };
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

export function splitName(name) {
  const parts = name.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  return { artist: '', title: name };
}

function run(stores, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let out;
    const r = fn(tx);
    if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('abort'));
  }));
}

export const db = {
  allTracks: () => run(['tracks'], 'readonly', tx => tx.objectStore('tracks').getAll()),
  putTrack: t => run(['tracks'], 'readwrite', tx => { tx.objectStore('tracks').put(t); }),
  deleteTrack: id => run(['tracks', 'files', 'art'], 'readwrite', tx => {
    tx.objectStore('tracks').delete(id);
    tx.objectStore('files').delete(id);
    tx.objectStore('art').delete(id);
  }),
  getFile: id => run(['files'], 'readonly', tx => tx.objectStore('files').get(id)),
  getArt: id => run(['art'], 'readonly', tx => tx.objectStore('art').get(id)),
  saveDownload: (t, file, art) => run(['tracks', 'files', 'art'], 'readwrite', tx => {
    tx.objectStore('tracks').put(t);
    tx.objectStore('files').put(file, t.id);
    if (art) tx.objectStore('art').put(art, t.id);
  }),
  removeFiles: id => run(['files', 'art'], 'readwrite', tx => {
    tx.objectStore('files').delete(id);
    tx.objectStore('art').delete(id);
  }),
  allPlaylists: () => run(['playlists'], 'readonly', tx => tx.objectStore('playlists').getAll()),
  putPlaylist: p => run(['playlists'], 'readwrite', tx => { tx.objectStore('playlists').put(p); }),
  deletePlaylist: id => run(['playlists'], 'readwrite', tx => { tx.objectStore('playlists').delete(id); }),
};
