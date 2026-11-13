import { icon } from './icons.js';
import * as store from './store.js';
import * as player from './player.js';
import * as video from './video.js';
import {
  $, $$, esc, el, fmtTime, fmtSize, art, hydrate, dlBadge, trackList,
  sheet, trackHead, askText, askConfirm, toast, tintFrom, pushLayer, closeLayer, go, setNowPlayingOpener,
} from './ui.js';

const view = $('#view');
const online = () => navigator.onLine;
const fileInput = $('#fileInput');
const folderInput = $('#folderInput');

/* ================== Yönlendirme ================== */
let renderSeq = 0;
const scrollMemory = new Map();
let lastHash = '';

function route() {
  const hash = location.hash || '#/';
  scrollMemory.set(lastHash, window.scrollY);
  lastHash = hash;
  const [, name, arg] = hash.split('/').map(decodeURIComponent);
  const seq = ++renderSeq;
  view.innerHTML = '';
  const page = el('<div class="page"></div>');
  view.appendChild(page);
  if (name === 'listem') myPlaylistView(page, arg); else libraryView(page);
  if (seq === renderSeq) window.scrollTo(0, scrollMemory.get(hash) || 0);
}
window.addEventListener('hashchange', route);

const backBtn = () => el(`<button class="back" aria-label="Geri" onclick="history.length > 1 ? history.back() : (location.hash = '#/')">${icon('back')}</button>`);

function playButtons(getTracks) {
  const box = el(`<div class="actions">
    <button class="btn primary" data-p>${icon('play')}Çal</button>
    <button class="btn" data-s>${icon('shuffle')}Karışık</button>
  </div>`);
  $('[data-p]', box).onclick = () => player.playList(getTracks(), 0);
  $('[data-s]', box).onclick = () => player.playShuffled(getTracks());
  return box;
}

/* ================== Şarkı ekleme ================== */
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) || new URLSearchParams(location.search).has('ios');
const isStandalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const folderSupported = !isIOS && 'webkitdirectory' in document.createElement('input');

function openAdd() {
  // iPhone'da dosya seçici doğrudan dokunuşla açılmalı
  if (isIOS) { fileInput.click(); return; }
  const items = [
    { icon: 'note', label: 'Şarkıları seç', sub: 'Birden fazla şarkıyı birlikte seçebilirsiniz', run: () => fileInput.click() },
  ];
  if (folderSupported) items.push({ icon: 'library', label: 'Bir klasörün tamamını ekle', sub: 'Örneğin Müzik veya İndirilenler klasörü', run: () => folderInput.click() });
  items.push({ icon: 'upload', label: 'Başka uygulamadan gönder', sub: 'Paylaş → Müziklerim (nasıl yapılır?)', run: shareHelp });
  sheet({ title: 'Şarkı ekle', items });
}

function iosHelp() {
  const body = el(`<div class="help">
    <p><b>Şarkı Ekle</b>’ye basınca iPhone’un <b>Dosyalar</b> ekranı açılır.</p>
    <ol>
      <li>Şarkının durduğu yere gidin (<b>iCloud Drive</b>, <b>iPhone’umda</b> veya <b>İndirilenler</b>).</li>
      <li>Birden fazla şarkı için sağ üstteki <b>Seç</b>’e dokunun, şarkıları işaretleyin.</li>
      <li><b>Aç</b>’a basın. Şarkılar Müziklerim’e eklenir.</li>
    </ol>
    <p><b>Şarkılar Dosyalar’a nasıl gelir?</b></p>
    <ul>
      <li><b>WhatsApp’tan gelen şarkı:</b> şarkıya dokunun → Paylaş ${icon('upload')} → <b>Dosyalar’a Kaydet</b>.</li>
      <li><b>Bilgisayardaki şarkılar:</b> bilgisayarda <b>icloud.com</b> → iCloud Drive’a yükleyin. iPhone’da Dosyalar → iCloud Drive’da görünür.</li>
      <li><b>Mail ile gelen şarkı:</b> eke basılı tutun → <b>Dosyalar’a Kaydet</b>.</li>
    </ul>
    <p class="small">Not: Apple Music’ten indirilen şarkılar Apple’ın korumasındadır. Bu şarkıları hiçbir başka uygulama açamaz.</p>
  </div>`);
  sheet({ title: 'iPhone’da şarkı ekleme', body, items: [{ icon: 'downloaded', label: 'Anladım' }] });
}

function installHelp() {
  const body = el(`<div class="help">
    <p>Müziklerim’i iPhone’a uygulama olarak eklemek için:</p>
    <ol>
      <li>Bu sayfayı <b>Safari</b>’de açın.</li>
      <li>Alttaki <b>Paylaş</b> ${icon('upload')} düğmesine dokunun.</li>
      <li>Aşağı kaydırıp <b>Ana Ekrana Ekle</b>’ye, sonra <b>Ekle</b>’ye dokunun.</li>
    </ol>
    <p>Ana ekrandaki <b>Müziklerim</b> simgesinden açın. Eklediğiniz şarkılar böylece kalıcı olarak saklanır.</p>
  </div>`);
  sheet({ title: 'Ana ekrana ekle', body, items: [{ icon: 'downloaded', label: 'Anladım' }] });
}

function shareHelp() {
  const body = el(`<div class="help">
    <p>Telefondaki <b>Dosyalar</b>, <b>WhatsApp</b> ya da başka bir müzik uygulamasında:</p>
    <ol>
      <li>Şarkıya (veya birkaç şarkıya) <b>basılı tutup seçin</b>.</li>
      <li><b>Paylaş</b> ${icon('upload')} düğmesine dokunun.</li>
      <li>Listeden <b>Müziklerim</b>’i seçin.</li>
    </ol>
    <p>Şarkılar kendiliğinden buraya eklenir.</p>
    <p class="small">Not: Paylaş listesinde Müziklerim’in görünmesi için uygulamanın <b>ana ekrana yüklenmiş</b> olması gerekir (Chrome menüsü → “Uygulamayı yükle”).</p>
  </div>`);
  sheet({ title: 'Başka uygulamadan gönderme', body, items: [{ icon: 'downloaded', label: 'Anladım' }] });
}

fileInput.addEventListener('change', e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length) store.importFiles(files);
});
folderInput.addEventListener('change', e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length) store.importFiles(files);
});

// Bilgisayarda sürükle-bırak
let dragDepth = 0;
const dropZone = $('#drop');
window.addEventListener('dragenter', e => { if ([...e.dataTransfer.types].includes('Files')) { dragDepth++; dropZone.hidden = false; } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dropZone.hidden = true; } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0; dropZone.hidden = true;
  const files = [...(e.dataTransfer.files || [])];
  if (files.length) store.importFiles(files);
});

// Paylaş menüsünden gelen şarkılar (servis çalışanı "gelen kutusu"na koyar)
function openInbox() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('muziklerim-inbox', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files', { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function checkInbox() {
  try {
    const db = await openInbox();
    const files = await new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      const s = tx.objectStore('files');
      const r = s.getAll();
      r.onsuccess = () => { s.clear(); };
      tx.oncomplete = () => resolve(r.result || []);
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    if (files.length) {
      if (location.hash.startsWith('#/listem')) go('#/');
      await store.importFiles(files);
    }
  } catch (e) { console.warn('inbox', e); }
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', e => { if (e.data === 'inbox') checkInbox(); });
}

/* İçe aktarma ilerlemesi */
const importBar = $('#importBar');
store.on((type, data) => {
  if (type !== 'import') return;
  if (!data) { importBar.hidden = true; return; }
  importBar.hidden = false;
  importBar.innerHTML = `<div class="ib-text">Şarkılar ekleniyor… <b>${data.done} / ${data.total}</b></div><div class="ib-bar"><i style="width:${data.total ? data.done / data.total * 100 : 0}%"></i></div>`;
});

/* ================== Müziklerim (tek ekran) ================== */
let libTab = 'tum';
let libFilter = '';
let libSort = (() => { try { return localStorage.getItem('sort') || 'az'; } catch { return 'az'; } })();
const SORTS = { az: 'A’dan Z’ye', artist: 'Sanatçıya göre', new: 'Son eklenen' };
const collator = new Intl.Collator('tr', { sensitivity: 'base', numeric: true });

function sorted(list) {
  const l = list.slice();
  if (libSort === 'new') l.sort((a, b) => (b.downloadedAt || b.addedAt || 0) - (a.downloadedAt || a.addedAt || 0));
  else if (libSort === 'artist') l.sort((a, b) => collator.compare(a.artist || 'zzz', b.artist || 'zzz') || collator.compare(a.title, b.title));
  else l.sort((a, b) => collator.compare(a.title, b.title));
  return l;
}

function libraryView(page) {
  const head = el(`<div class="page-head"><div style="flex:1"><h1>Müziklerim</h1><div class="greet" style="padding:0" data-count></div></div></div>`);
  const add = el(`<div style="padding:12px 20px 4px"><button class="add-btn">${icon('plus')}Şarkı Ekle</button>${isIOS ? '<button class="help-link">Şarkılar iPhone’da nerede? Nasıl eklenir? ›</button>' : ''}</div>`);
  $('.add-btn', add).onclick = openAdd;
  if (isIOS) $('.help-link', add).onclick = iosHelp;
  const segs = el('<div class="seg" style="padding-top:14px"></div>');
  const body = el('<div></div>');
  let dismissed = false;
  try { dismissed = localStorage.getItem('installHint') === '0'; } catch {}
  if (isIOS && !isStandalone && !dismissed) {
    const hint = el(`<div class="install-hint"><div>${icon('upload')}</div><div class="ih-text"><b>Ana ekrana ekleyin</b><span>Safari’de Paylaş → Ana Ekrana Ekle</span></div><button class="icon-btn" aria-label="Kapat">${icon('close')}</button></div>`);
    hint.onclick = e => {
      if (e.target.closest('.icon-btn')) { hint.remove(); try { localStorage.setItem('installHint', '0'); } catch {} return; }
      installHelp();
    };
    page.append(head, hint);
  }
  if (!page.contains(head)) page.append(head);
  page.append(add, segs, body);

  let listHolder = null;
  function draw() {
    const all = [...store.lib.values()];
    const songs = all.filter(t => t.downloaded);
    const liked = all.filter(t => t.liked);
    const pls = store.playlists;
    $('[data-count]', head).textContent = songs.length ? songs.length + ' şarkı · internetsiz çalar' : 'Reklamsız müzik çalar';
    segs.innerHTML = [['tum', 'Tüm şarkılar', songs.length], ['fav', 'Favoriler', liked.length], ['liste', 'Listelerim', pls.length]]
      .map(([k, n, c]) => `<button class="chip${libTab === k ? ' on' : ''}" data-k="${k}">${n} <span style="opacity:.6">${c}</span></button>`).join('');
    segs.onclick = e => { const c = e.target.closest('.chip'); if (c && c.dataset.k !== libTab) { libTab = c.dataset.k; libFilter = ''; draw(); } };
    body.innerHTML = '';

    if (libTab === 'liste') {
      const nb = el(`<div class="actions"><button class="btn">${icon('plus')}Yeni liste</button></div>`);
      nb.firstElementChild.onclick = async () => {
        const name = await askText('Yeni çalma listesi', '', 'Oluştur', 'Liste adı');
        if (name) { const p = await store.createPlaylist(name); go('#/listem/' + p.id); }
      };
      body.appendChild(nb);
      if (!pls.length) { body.appendChild(el(`<div class="empty">${icon('playlist')}<b>Henüz listen yok</b>Bir şarkının ⋮ menüsünden “Listeye ekle” diyerek de liste oluşturabilirsin.</div>`)); return; }
      const list = el('<div class="list"></div>');
      list.innerHTML = pls.map(p => {
        const first = p.trackIds.map(id => store.lib.get(id)).find(Boolean);
        return `<a class="row" href="#/listem/${p.id}">${art(first ? { ...first, title: p.name } : { id: p.id, title: p.name }, 'sm', 'playlist')}<div class="meta"><div class="t">${esc(p.name)}</div><div class="s"><span class="a">${p.trackIds.length} şarkı</span></div></div></a>`;
      }).join('');
      body.appendChild(list);
      hydrate(list);
      return;
    }

    const isAll = libTab === 'tum';
    const items = sorted(isAll ? songs : liked);
    if (!items.length) {
      body.appendChild(el(isAll
        ? `<div class="empty welcome">${icon('note')}<b>Hoş geldiniz!</b>Yukarıdaki <b>Şarkı Ekle</b> düğmesine basın ve telefonunuzdaki şarkıları seçin. ${isIOS ? 'Şarkılar iPhone’un <b>Dosyalar</b> uygulamasından seçilir; birden fazla şarkıyı birlikte seçebilirsiniz.' : 'İsterseniz bir klasörün tamamını da tek seferde ekleyebilirsiniz.'}<br><br>Eklenen şarkılar <b>internet olmadan</b> ve <b>reklamsız</b> çalar.</div>`
        : `<div class="empty">${icon('heart')}<b>Favori şarkın yok</b>Çalarken ♡ simgesine dokunarak şarkıları buraya ekle.</div>`));
      return;
    }
    const tools = el(`<div class="lib-tools">
      ${items.length > 8 ? `<div class="search-field small">${icon('search')}<input type="search" placeholder="Şarkı veya sanatçı ara" autocomplete="off"></div>` : '<div style="flex:1"></div>'}
      <button class="btn ghost sort">${icon('queue')}${SORTS[libSort]}</button>
    </div>`);
    const inp = $('input', tools);
    if (inp) { inp.value = libFilter; inp.oninput = () => { libFilter = inp.value; drawList(); }; }
    $('.sort', tools).onclick = () => sheet({
      title: 'Sırala',
      items: Object.entries(SORTS).map(([k, label]) => ({ icon: k === libSort ? 'downloaded' : 'queue', label, on: k === libSort, run: () => { libSort = k; try { localStorage.setItem('sort', k); } catch {} draw(); } })),
    });
    body.append(playButtons(() => filtered()), tools);
    listHolder = el('<div></div>');
    body.appendChild(listHolder);
    const filtered = () => {
      const q = libFilter.trim().toLocaleLowerCase('tr');
      return q ? items.filter(t => (t.title + ' ' + (t.artist || '') + ' ' + (t.album || '')).toLocaleLowerCase('tr').includes(q)) : items;
    };
    function drawList() {
      listHolder.innerHTML = '';
      const l = filtered();
      listHolder.appendChild(l.length ? trackList(l, {}, trackMenu) : el('<div class="empty">Bulunamadı.</div>'));
    }
    drawList();
    if (isAll) {
      const st = el('<div class="storage"></div>');
      body.appendChild(st);
      if (navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate().then(({ usage, quota }) => {
          st.textContent = 'Kullanılan alan: ' + fmtSize(usage || 0) + (quota ? ' · Boş: ' + fmtSize(Math.max(0, quota - usage)) : '');
        }).catch(() => {});
      }
    }
  }
  draw();
  let pending = false;
  const off = store.on(type => {
    if (!document.body.contains(page)) { off(); return; }
    if (type !== 'library' || pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      const y = window.scrollY;
      const focused = document.activeElement && document.activeElement.matches('.lib-tools input');
      draw();
      window.scrollTo(0, y);
      if (focused) { const i = $('.lib-tools input', page); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
    });
  });
}

/* ================== Kendi listem ================== */
function myPlaylistView(page, id) {
  page.appendChild(backBtn());
  const p = store.playlists.find(x => x.id === id);
  if (!p) { page.appendChild(el('<div class="empty" style="padding-top:80px">Liste bulunamadı.</div>')); return; }
  const draw = () => {
    [...page.children].slice(1).forEach(x => x.remove());
    const tracks = p.trackIds.map(i => store.lib.get(i)).filter(Boolean);
    const first = tracks[0];
    const hero = el(`<div class="hero">${art(first ? { ...first } : { id: p.id, title: p.name }, '', 'playlist')}<h1>${esc(p.name)}</h1><div class="sub">Listem · ${tracks.length} şarkı</div></div>`);
    page.appendChild(hero);
    const acts = playButtons(() => tracks);
    const more = el(`<button class="btn round" aria-label="Liste seçenekleri">${icon('more')}</button>`);
    more.onclick = () => sheet({
      title: p.name,
      items: [
        { icon: 'edit', label: 'Adını değiştir', run: async () => { const n = await askText('Liste adı', p.name); if (n) await store.renamePlaylist(p, n); } },
        { icon: 'trash', label: 'Listeyi sil', danger: true, run: async () => { if (await askConfirm('Liste silinsin mi?', '“' + p.name + '” silinecek. Şarkılar silinmez.', 'Sil', true)) { await store.deletePlaylist(p); go('#/'); } } },
      ],
    });
    acts.appendChild(more);
    page.appendChild(acts);
    if (!tracks.length) page.appendChild(el(`<div class="empty">${icon('playlist')}<b>Liste boş</b>Şarkıların ⋮ menüsünden “Listeye ekle” ile şarkı ekle.</div>`));
    else page.appendChild(trackList(tracks, { ctx: p }, trackMenu));
    hydrate(hero);
    if (first) heroTint(first, hero);
  };
  draw();
  const off = store.on(type => {
    if (!document.body.contains(page)) { off(); return; }
    if (type === 'library') draw();
  });
}

async function heroTint(t, hero) {
  const img = $('img', hero);
  await new Promise(r => setTimeout(r, 50));
  const url = img && img.src && img.src.startsWith('blob:') ? img.src : (online() ? t.artwork : '');
  const c = await tintFrom(url, t.id);
  if (c) hero.style.setProperty('--hero', c);
}

/* ================== Şarkı menüsü ================== */
function trackMenu(track, ctxPlaylist) {
  const t = store.known(track);
  const items = [
    { icon: 'playNext', label: 'Sıradaki olarak çal', run: () => player.playNext(t) },
    { icon: 'queue', label: 'Sıraya ekle', run: () => player.addToQueue(t) },
    store.isLiked(t.id)
      ? { icon: 'heartFill', label: 'Favorilerden çıkar', on: true, run: () => store.toggleLike(t).then(() => toast('Favorilerden çıkarıldı')) }
      : { icon: 'heart', label: 'Favorilere ekle', run: () => store.toggleLike(t).then(() => toast('Favorilere eklendi')) },
    { icon: 'addList', label: 'Listeye ekle', run: () => chooseList(t) },
  ];
  if (ctxPlaylist) items.push({ icon: 'close', label: 'Bu listeden çıkar', run: () => store.removeFromPlaylist(ctxPlaylist, t.id) });
  items.push({ icon: 'video', label: t.videoId ? 'Klibi değiştir' : 'Klip ekle', sub: t.videoId ? '' : 'YouTube’daki klibini bu şarkıya bağla', run: () => openClipSheet(t) });
  if (t.videoId) items.push({ icon: 'close', label: 'Klibi kaldır', run: async () => { await store.setVideo(t, null); player.refreshQueueMeta(); if (video.state.trackId === t.id) exitVideo(true); toast('Klip kaldırıldı'); } });
  if (t.source === 'local') items.push({ icon: 'edit', label: 'Adını düzenle', run: () => renameLocal(t) });
  if (t.downloaded) {
    items.push({ icon: 'trash', label: 'Sil', danger: true, run: async () => {
      if (await askConfirm('Şarkı silinsin mi?', '“' + t.title + '” uygulamadan silinecek. Telefondaki asıl dosyaya dokunulmaz.', 'Sil', true)) { await store.removeDownload(t); toast('Silindi'); }
    } });
  }
  sheet({ head: trackHead(t), items });
}

async function renameLocal(t) {
  const n = await askText('Şarkı adı', t.artist ? t.artist + ' - ' + t.title : t.title, 'Kaydet', 'Sanatçı - Şarkı adı');
  if (!n) return;
  const parts = n.split(/\s+[-–—]\s+/);
  const artist = parts.length > 1 ? parts[0].trim() : '';
  const title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : n;
  await store.renameTrack(t, title, artist);
  player.refreshQueueMeta();
  renderMini(); if (!np.hidden) renderNP();
}

/* ================== Klip bağlama ================== */
function openClipSheet(track) {
  const t = store.known(track);
  const body = el(`<div class="help">
    <p>Şarkının YouTube’daki klibini <b>bir kez</b> bağlayın; sonra çalarken <b>Klip</b>’e basınca video oynar.</p>
    <ol>
      <li><b>YouTube’da bul</b>’a basın ve klibi açın.</li>
      <li>Videonun altındaki <b>Paylaş</b> → <b>Kopyala</b>’ya dokunun.</li>
      <li>Buraya dönüp <b>Bağlantıyı yapıştır</b>’a basın.</li>
    </ol>
    <div class="clip-actions">
      <a class="btn" target="_blank" rel="noopener" href="${esc(video.searchUrl(t))}">${icon('search')}YouTube’da bul</a>
      <button class="btn primary" data-paste>${icon('link')}Bağlantıyı yapıştır</button>
    </div>
    <p class="small">Klip YouTube’dan oynatılır, bu yüzden internet gerekir. Şarkının kendisi yine internetsiz çalar.</p>
  </div>`);
  // Pano okuma, dokunuşun hemen içinde yapılmalı (iPhone için)
  $('[data-paste]', body).onclick = async () => {
    let text = '';
    try { if (navigator.clipboard && navigator.clipboard.readText) text = await navigator.clipboard.readText(); } catch {}
    let id = video.parseVideoId(text);
    await closeLayer();
    if (!id) {
      const v = await askText('Klip bağlantısı', text && text.length < 300 ? text : '', 'Kaydet', 'https://youtu.be/…');
      if (!v) return;
      id = video.parseVideoId(v);
      if (!id) { toast('Bu bir YouTube bağlantısı değil'); return; }
    }
    await store.setVideo(t, id);
    player.refreshQueueMeta();
    toast('Klip bağlandı ✓');
    const cur = player.current();
    if (cur && cur.id === t.id) {
      if (np.hidden) openNP();
      enterVideo();
    }
  };
  sheet({ head: trackHead(t), body, items: t.videoId ? [{ icon: 'close', label: 'Klibi kaldır', run: async () => { await store.setVideo(t, null); player.refreshQueueMeta(); if (video.state.trackId === t.id) exitVideo(true); toast('Klip kaldırıldı'); } }] : [] });
}

function chooseList(t) {
  const items = [{ icon: 'plus', label: 'Yeni liste oluştur', run: async () => {
    const name = await askText('Yeni çalma listesi', '', 'Oluştur', 'Liste adı');
    if (!name) return;
    const p = await store.createPlaylist(name);
    await store.addToPlaylist(p, t);
    toast('“' + name + '” listesine eklendi');
  } }];
  for (const p of store.playlists) {
    const has = p.trackIds.includes(t.id);
    items.push({ icon: has ? 'downloaded' : 'playlist', label: p.name, right: p.trackIds.length + ' şarkı', on: has, run: async () => {
      const ok = await store.addToPlaylist(p, t);
      toast(ok ? '“' + p.name + '” listesine eklendi' : 'Bu şarkı zaten listede');
    } });
  }
  sheet({ title: 'Listeye ekle', items });
}

/* ================== Mini çalar ================== */
const mini = $('#mini');
function renderMini() {
  const t = player.current();
  mini.hidden = !t;
  document.body.classList.toggle('has-mini', !!t);
  if (!t) return;
  const playing = player.isPlaying();
  mini.innerHTML = `${art(t)}<div class="meta"><div class="t">${esc(t.title)}</div><div class="s">${esc(t.artist || 'Müziklerim')}</div></div>
    <button class="icon-btn" data-pp aria-label="${playing ? 'Duraklat' : 'Çal'}">${icon(playing ? 'pause' : 'play')}</button>
    <button class="icon-btn" data-nx aria-label="Sonraki">${icon('next')}</button><div class="bar"><i></i></div>`;
  hydrate(mini).then(() => applyTint(t));
  updateTime();
}
mini.addEventListener('click', e => {
  if (e.target.closest('[data-pp]')) { player.toggle(); return; }
  if (e.target.closest('[data-nx]')) { player.next(); return; }
  openNP();
});

let tintFor = '';
async function applyTint(t) {
  if (tintFor === t.id) return;
  tintFor = t.id;
  const img = $('img', mini);
  let url = img && img.src && img.src.startsWith('blob:') ? img.src : (online() ? t.artwork : '');
  const c = url ? await tintFrom(url, t.id) : null;
  if (tintFor !== t.id) return;
  document.documentElement.style.setProperty('--tint', c || '#3a2f1b');
}

/* ================== Tam ekran çalar ================== */
const np = $('#np');
function openNP() {
  if (!np.hidden || !player.current()) return;
  np.hidden = false;
  document.body.style.overflow = 'hidden';
  renderNP();
  pushLayer(() => {
    np.hidden = true;
    document.body.style.overflow = '';
    if (video.state.active) exitVideo(true);
    videoSticky = false;
  });
}
setNowPlayingOpener(openNP);

/* ---------- Klip modu ---------- */
let videoSticky = false;   // kullanıcı klip modundaysa sonraki şarkıda da klibi aç
let videoTimer = null;

function enterVideo() {
  const t = player.current();
  if (!t || !t.videoId) return;
  if (!online()) { toast('Klip için internet gerekir'); return; }
  const start = player.time().cur;
  if (player.isPlaying()) player.audio.pause();
  videoSticky = true;
  video.open(t.videoId, t.id, start, {
    onState: () => { renderNPControls(); },
    onEnded: () => { exitVideo(false); player.next(true); },
    onError: msg => { toast(msg, 5000); exitVideo(true); videoSticky = false; },
  });
  renderNP();
  clearInterval(videoTimer);
  videoTimer = setInterval(updateTime, 500);
}

// resume: klibin kaldığı yerden şarkıyı devam ettir
function exitVideo(resume) {
  if (!video.state.active) return;
  const at = video.close();
  clearInterval(videoTimer);
  if (resume) {
    const { dur } = player.time();
    if (at > 0 && (!dur || at < dur)) player.seek(at);
    player.audio.play().catch(() => {});
  }
  if (!np.hidden) renderNP();
}

function placeVideo() {
  if (!video.state.active || np.hidden) return;
  video.place($('.video-slot', np));
}
window.addEventListener('resize', placeVideo);
np.addEventListener('animationend', placeVideo);
// Düzen değişirse (yazı tipi, döndürme vb.) videoyu yerinde tut
if ('ResizeObserver' in window) new ResizeObserver(placeVideo).observe(np);
window.addEventListener('orientationchange', () => setTimeout(placeVideo, 300));

function renderNPControls() {
  const btn = $('[data-pp]', np);
  if (!btn) return;
  const playing = video.state.active ? video.state.playing : player.isPlaying();
  btn.innerHTML = icon(playing ? 'pause' : 'play');
  btn.setAttribute('aria-label', playing ? 'Duraklat' : 'Çal');
}

function renderNP() {
  const t = player.current();
  if (!t) { if (!np.hidden) closeLayer(); return; }
  const s = player.state;
  // klip başka bir şarkıya aitse kapat
  if (video.state.active && video.state.trackId !== t.id) exitVideo(false);
  const vid = video.state.active;
  const playing = vid ? video.state.playing : player.isPlaying();
  const liked = store.isLiked(t.id);
  const sleepOn = s.sleepAt || s.sleepEnd;
  np.classList.toggle('video-mode', vid);
  np.innerHTML = `
    <div class="np-top">
      <button class="icon-btn" data-close aria-label="Kapat">${icon('down')}</button>
      <span class="label">Şimdi çalıyor</span>
      <button class="icon-btn" data-more aria-label="Seçenekler">${icon('more')}</button>
    </div>
    <div class="np-art-wrap">${vid ? '<div class="video-slot"></div>' : art(t, 'np-art')}</div>
    <div class="np-info">
      <div class="meta"><div class="np-title">${esc(t.title)}</div><div class="np-artist">${esc(t.artist || 'Müziklerim')}</div></div>
      <button class="icon-btn${liked ? ' liked' : ''}" data-like aria-label="Favorilere ekle">${icon(liked ? 'heartFill' : 'heart')}</button>
    </div>
    <div class="seekbar"><input type="range" min="0" max="1000" value="0" aria-label="Konum"><div class="times"><span data-cur>0:00</span><span data-dur>0:00</span></div></div>
    <div class="np-ctl">
      <button class="icon-btn side${s.shuffle ? ' on' : ''}" data-sh aria-label="Karışık">${icon('shuffle')}</button>
      <button class="icon-btn" data-pv aria-label="Önceki">${icon('prev')}</button>
      <button class="np-play${s.loading ? ' loading' : ''}" data-pp aria-label="${playing ? 'Duraklat' : 'Çal'}">${icon(playing ? 'pause' : 'play')}</button>
      <button class="icon-btn" data-nx aria-label="Sonraki">${icon('next')}</button>
      <button class="icon-btn side${s.repeat !== 'off' ? ' on' : ''}" data-rp aria-label="Tekrar">${icon(s.repeat === 'one' ? 'repeatOne' : 'repeat')}</button>
    </div>
    <div class="np-bottom">
      <button class="btn" data-q>${icon('queue')}Sıradakiler</button>
      <button class="btn clip${vid ? ' on' : ''}${t.videoId ? ' has' : ''}" data-clip>${icon(vid ? 'note' : 'video')}${vid ? 'Sadece ses' : 'Klip'}</button>
      <button class="btn${sleepOn ? ' on' : ''}" data-sl>${icon('moon')}${sleepLabel()}</button>
    </div>`;
  hydrate(np);
  updateTime();
  if (vid) { setTimeout(placeVideo, 0); setTimeout(placeVideo, 350); }
}

function sleepLabel() {
  const s = player.state;
  if (s.sleepEnd) return 'Şarkı bitince';
  if (s.sleepAt) return Math.max(1, Math.round((s.sleepAt - Date.now()) / 60e3)) + ' dk';
  return 'Uyku';
}

let seeking = false;
np.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const t = player.current();
  if (b.matches('[data-close]')) closeLayer();
  else if (b.matches('[data-clip]')) {
    if (video.state.active) { videoSticky = false; exitVideo(true); }
    else if (t.videoId) enterVideo();
    else openClipSheet(t);
  }
  else if (b.matches('[data-pp]')) { if (video.state.active) video.toggle(); else player.toggle(); }
  else if (b.matches('[data-nx]')) { if (video.state.active) exitVideo(false); player.next(); }
  else if (b.matches('[data-pv]')) {
    if (video.state.active) {
      if (video.time().cur > 3) { video.seek(0); return; }
      exitVideo(false);
      player.seek(0);
    }
    player.prev();
  }
  else if (b.matches('[data-sh]')) toast(player.toggleShuffle() ? 'Karışık çalma açık' : 'Karışık çalma kapalı');
  else if (b.matches('[data-rp]')) { const r = player.cycleRepeat(); toast(r === 'all' ? 'Liste bitince baştan başlar' : r === 'one' ? 'Bu şarkı tekrarlanır' : 'Tekrar kapalı'); }
  else if (b.matches('[data-like]')) store.toggleLike(t).then(l => { toast(l ? 'Favorilere eklendi' : 'Favorilerden çıkarıldı'); renderNP(); });
  else if (b.matches('[data-more]')) trackMenu(t);
  else if (b.matches('[data-q]')) openQueue();
  else if (b.matches('[data-sl]')) openSleep();
});
np.addEventListener('input', e => {
  if (e.target.type !== 'range') return;
  seeking = true;
  const { dur } = nowTime();
  e.target.style.setProperty('--p', (e.target.value / 10) + '%');
  const c = $('[data-cur]', np); if (c) c.textContent = fmtTime(e.target.value / 1000 * dur);
});
np.addEventListener('change', e => {
  if (e.target.type !== 'range') return;
  const { dur } = nowTime();
  if (video.state.active) video.seek(e.target.value / 1000 * dur);
  else player.seek(e.target.value / 1000 * dur);
  seeking = false;
});

const nowTime = () => video.state.active ? video.time() : player.time();

function updateTime() {
  const { cur, dur } = nowTime();
  const p = dur ? Math.min(100, cur / dur * 100) : 0;
  const bar = $('.bar i', mini);
  if (bar) bar.style.width = p + '%';
  if (np.hidden || seeking) return;
  const r = $('input[type=range]', np);
  if (r) { r.value = Math.round(p * 10); r.style.setProperty('--p', p + '%'); }
  const c = $('[data-cur]', np), d = $('[data-dur]', np);
  if (c) c.textContent = fmtTime(cur);
  if (d) d.textContent = fmtTime(dur);
}

function openQueue() {
  const s = player.state;
  const body = el('<div class="list" style="padding:0"></div>');
  const draw = () => {
    body.innerHTML = s.queue.map((t, i) => `<div class="row${i === s.index ? ' now' : ''}${!player.canPlay(t) ? ' off' : ''}" data-i="${i}">
      <div style="position:relative">${art(t, 'sm')}<div class="eq"><i></i><i></i><i></i></div></div>
      <div class="meta"><div class="t">${esc(t.title)}</div><div class="s"><span class="a">${esc(t.artist || '')}</span></div></div>
      ${i !== s.index ? `<button class="icon-btn" data-rm aria-label="Sıradan çıkar">${icon('close')}</button>` : ''}</div>`).join('');
    hydrate(body);
  };
  draw();
  body.onclick = e => {
    const row = e.target.closest('.row');
    if (!row) return;
    const i = +row.dataset.i;
    if (e.target.closest('[data-rm]')) { player.removeAt(i); draw(); return; }
    player.jump(i);
    closeLayer();
  };
  sheet({ title: 'Sıradakiler · ' + s.queue.length + ' şarkı', body });
  requestAnimationFrame(() => { const n = $('.row.now', body); if (n) n.scrollIntoView({ block: 'center' }); });
}

function openSleep() {
  const s = player.state;
  const items = [15, 30, 45, 60, 90].map(m => ({ icon: 'clock', label: m + ' dakika sonra', run: () => { player.setSleep(m); toast('Müzik ' + m + ' dakika sonra duracak'); } }));
  items.push({ icon: 'note', label: 'Bu şarkı bitince', run: () => { player.setSleep('end'); toast('Bu şarkı bitince müzik duracak'); } });
  if (s.sleepAt || s.sleepEnd) items.push({ icon: 'close', label: 'Zamanlayıcıyı kapat', danger: true, run: () => { player.setSleep(0); toast('Uyku zamanlayıcı kapatıldı'); } });
  sheet({ title: 'Uyku zamanlayıcı', items });
}

/* ================== Olaylar ================== */
store.on((type, data) => {
  if (type === 'toast') toast(data, 3500);
  else if (type === 'player') {
    const t = player.current();
    document.body.classList.toggle('playing', player.isPlaying());
    for (const r of $$('.view .row[data-id]')) r.classList.toggle('now', !!t && r.dataset.id === t.id);
    renderMini();
    if (!np.hidden) {
      // klip modundayken şarkı değişirse yeni şarkının klibini aç
      if (videoSticky && !video.state.active && !player.state.loading && t && t.videoId && online() && player.isPlaying()) { enterVideo(); return; }
      if (!video.state.active || video.state.trackId !== (t && t.id)) renderNP();
      else renderNPControls();
    }
  } else if (type === 'time') { if (!video.state.active) updateTime(); }
  else if (type === 'progress') {
    for (const b of $$(`[data-dl="${CSS.escape(data.id)}"]`)) b.outerHTML = dlBadge(data.id);
  }
});

/* Klavye kısayolları (bilgisayarda) */
document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); if (video.state.active) video.toggle(); else player.toggle(); }
  else if (e.key === 'ArrowRight' && e.shiftKey) player.next();
  else if (e.key === 'ArrowLeft' && e.shiftKey) player.prev();
});

/* ================== Başlat ================== */
window.addEventListener('db-blocked', () => {
  view.innerHTML = `<div class="empty" style="padding-top:90px">${icon('note')}<b>Uygulama güncelleniyor</b>Müziklerim başka bir pencerede de açık. Diğer pencereyi kapatın; bu sayfa kendiliğinden devam edecek.</div>`;
});

(async function start() {
  try { await store.loadLibrary(); } catch (e) { console.error(e); toast('Kitaplık yüklenemedi'); }
  player.restore();
  renderMini();
  if (!location.hash || !/^#\/(listem\/.+)?$/.test(location.hash)) history.replaceState(null, '', '#/');
  route();
  checkInbox();
})();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e)));
}
