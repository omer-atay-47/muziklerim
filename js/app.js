import { icon } from './icons.js';
import { api, GENRES } from './api.js';
import * as store from './store.js';
import * as player from './player.js';
import {
  $, $$, esc, el, fmtTime, fmtSize, fmtCount, art, hydrate, dlBadge, trackList, trackCard, playlistCard, artistCard,
  skeletonRows, skeletonCards, sheet, trackHead, askText, askConfirm, toast, tintFrom, pushLayer, closeLayer, go,
  setNowPlayingOpener,
} from './ui.js';

const view = $('#view');
const online = () => navigator.onLine;
const genreName = g => (GENRES.find(x => x[0] === g) || [g, g])[1];

/* ================== Alt sekmeler ================== */
const TABS = { kesfet: ['compass', 'Keşfet'], ara: ['search', 'Ara'], kitaplik: ['library', 'Kitaplığım'] };
for (const a of $$('#tabbar .tab')) {
  const [ic, label] = TABS[a.dataset.tab];
  a.innerHTML = icon(ic) + `<span>${label}</span>`;
  a.addEventListener('click', e => {
    // aynı sekmeye tekrar dokununca en üste çık
    if (location.hash === a.getAttribute('href')) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  });
}

/* ================== Yönlendirme ================== */
let renderSeq = 0;
const scrollMemory = new Map();
let lastHash = '';

async function route() {
  const hash = location.hash || '#/kesfet';
  scrollMemory.set(lastHash, window.scrollY);
  lastHash = hash;
  const [, name, arg] = hash.split('/').map(decodeURIComponent);
  const seq = ++renderSeq;
  const tab = ['ara', 'kitaplik'].includes(name) ? name : (name === 'listem' ? 'kitaplik' : (name === 'tur' ? 'ara' : 'kesfet'));
  $$('#tabbar .tab').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  view.innerHTML = '';
  const page = el('<div class="page"></div>');
  view.appendChild(page);
  const alive = () => seq === renderSeq;
  try {
    switch (name) {
      case 'ara': await searchView(page, alive); break;
      case 'kitaplik': await libraryView(page, alive); break;
      case 'tur': await genreView(page, alive, arg); break;
      case 'liste': await playlistView(page, alive, arg); break;
      case 'sanatci': await artistView(page, alive, arg); break;
      case 'listem': await myPlaylistView(page, alive, arg); break;
      default: await discoverView(page, alive);
    }
  } catch (err) {
    console.error(err);
    if (alive()) page.appendChild(errorBox(retryRoute));
  }
  if (alive()) window.scrollTo(0, scrollMemory.get(hash) || 0);
}
const retryRoute = () => route();
window.addEventListener('hashchange', route);

function errorBox(retry) {
  const box = el(`<div class="empty">${icon(online() ? 'note' : 'offline')}<b>${online() ? 'Yüklenemedi' : 'İnternet yok'}</b>
    ${online() ? 'Bir sorun oldu, tekrar deneyin.' : 'Keşfet ve arama için internet gerekir. İndirdiğin şarkılar Kitaplığım’da.'}
    <div class="actions" style="justify-content:center;margin-top:14px"><button class="btn" data-r>Tekrar dene</button>${online() ? '' : '<a class="btn primary" href="#/kitaplik">Kitaplığım</a>'}</div></div>`);
  $('[data-r]', box).onclick = retry;
  return box;
}

const backBtn = () => el(`<button class="back" aria-label="Geri" onclick="history.length > 1 ? history.back() : (location.hash = '#/kesfet')">${icon('back')}</button>`);

function sectionHead(title, linkText, onLink) {
  const h = el(`<div class="sec-head"><h2>${esc(title)}</h2>${linkText ? `<button class="link">${esc(linkText)}</button>` : ''}</div>`);
  if (linkText) $('.link', h).onclick = onLink;
  return h;
}

function cardRow(tracks) {
  const row = el(`<div class="hscroll">${tracks.map(trackCard).join('')}</div>`);
  row.onclick = e => {
    const c = e.target.closest('.card');
    if (c) player.playList(tracks, +c.dataset.i);
  };
  hydrate(row);
  return row;
}

function playButtons(getTracks, { download = true } = {}) {
  const box = el(`<div class="actions">
    <button class="btn primary" data-p>${icon('play')}Çal</button>
    <button class="btn" data-s>${icon('shuffle')}Karışık</button>
    ${download ? `<button class="btn round" data-d aria-label="Tümünü indir">${icon('download')}</button>` : ''}
  </div>`);
  $('[data-p]', box).onclick = () => player.playList(getTracks(), 0);
  $('[data-s]', box).onclick = () => player.playShuffled(getTracks());
  if (download) $('[data-d]', box).onclick = () => downloadAll(getTracks());
  return box;
}

async function downloadAll(list) {
  const todo = list.filter(t => t.source === 'audius' && !store.isDownloaded(t.id));
  if (!todo.length) { toast('Hepsi zaten indirilmiş'); return; }
  if (!online()) { toast('İndirmek için internet gerekir'); return; }
  if (todo.length > 3 && !await askConfirm('Tümünü indir', todo.length + ' şarkı indirilecek. Mobil veri kullanıyorsanız Wi-Fi önerilir.', 'İndir')) return;
  todo.forEach(store.download);
  toast(todo.length + ' şarkı indiriliyor');
}

/* ================== Keşfet ================== */
let discoverGenre = '';

function greeting() {
  const h = new Date().getHours();
  return h < 6 ? 'İyi geceler' : h < 12 ? 'Günaydın' : h < 18 ? 'İyi günler' : 'İyi akşamlar';
}

async function discoverView(page, alive) {
  page.appendChild(el(`<div class="page-head"><h1>Keşfet</h1></div>`));
  page.appendChild(el(`<div class="greet">${greeting()} 👋</div>`));

  const chips = el(`<div class="chips" style="margin-top:14px"><button class="chip${!discoverGenre ? ' on' : ''}" data-g="">Tümü</button>${GENRES.map(([g, n]) => `<button class="chip${discoverGenre === g ? ' on' : ''}" data-g="${esc(g)}">${esc(n)}</button>`).join('')}</div>`);
  chips.onclick = e => {
    const c = e.target.closest('.chip');
    if (!c) return;
    discoverGenre = c.dataset.g;
    $$('.chip', chips).forEach(x => x.classList.toggle('on', x === c));
    fill();
  };
  page.appendChild(chips);
  requestAnimationFrame(() => { const on = $('.chip.on', chips); if (on && on.offsetLeft > chips.clientWidth) chips.scrollLeft = on.offsetLeft - 20; });

  const content = el('<div></div>');
  page.appendChild(content);

  async function fill() {
    content.innerHTML = '';
    const recent = store.recent();
    if (!online()) {
      if (recent.length) { content.appendChild(el('<div class="section"></div>')).append(sectionHead('Son dinlediklerin'), cardRow(recent)); }
      content.appendChild(errorBox(fill));
      return;
    }
    if (discoverGenre) {
      const sec = el('<div class="section"></div>');
      sec.appendChild(sectionHead(genreName(discoverGenre) + ' · bu hafta'));
      sec.insertAdjacentHTML('beforeend', skeletonRows(8));
      content.appendChild(sec);
      const g = discoverGenre;
      const list = await api.trending(g);
      if (!alive() || g !== discoverGenre) return;
      $$('.skel', sec).forEach(x => x.remove());
      if (!list.length) { sec.appendChild(el('<div class="empty">Bu türde şarkı bulunamadı.</div>')); return; }
      sec.appendChild(playButtons(() => list));
      sec.appendChild(trackList(list, { numbered: true, showPlays: true }, trackMenu));
      return;
    }

    if (recent.length) {
      const s = el('<div class="section"></div>');
      s.append(sectionHead('Son dinlediklerin'), cardRow(recent));
      content.appendChild(s);
    }

    const top = el('<div class="section"></div>');
    top.appendChild(sectionHead('Haftanın en çok dinlenenleri'));
    top.insertAdjacentHTML('beforeend', skeletonRows(5));
    const pls = el('<div class="section"></div>');
    pls.appendChild(sectionHead('Öne çıkan listeler'));
    pls.insertAdjacentHTML('beforeend', skeletonCards());
    const fresh = el('<div class="section"></div>');
    fresh.appendChild(sectionHead('Yükselen yeni sesler'));
    fresh.insertAdjacentHTML('beforeend', skeletonCards());
    const browse = el('<div class="section"></div>');
    browse.appendChild(sectionHead('Türlere göz at'));
    browse.appendChild(genreGrid());
    content.append(top, pls, fresh, browse);

    const [trend, playlists, under] = await Promise.allSettled([api.trending(), api.trendingPlaylists(), api.underground()]);
    if (!alive() || discoverGenre) return;
    if (trend.status === 'rejected' && playlists.status === 'rejected') { content.innerHTML = ''; content.appendChild(errorBox(fill)); return; }

    $$('.skel', top).forEach(x => x.remove());
    if (trend.status === 'fulfilled') {
      const all = trend.value;
      const shown = all.slice(0, 10);
      $('.sec-head', top).replaceWith(sectionHead('Haftanın en çok dinlenenleri', 'Tümü', () => { discoverGenre = ''; showAllTrending(all); }));
      top.appendChild(playButtons(() => all));
      top.appendChild(trackList(shown, { numbered: true, showPlays: true }, trackMenu));
    }
    $$('.skel', pls).forEach(x => x.closest('.hscroll') && x.closest('.hscroll').remove());
    if (playlists.status === 'fulfilled') { const r = el(`<div class="hscroll">${playlists.value.map(playlistCard).join('')}</div>`); pls.appendChild(r); hydrate(r); }
    else pls.remove();
    $$('.skel', fresh).forEach(x => x.closest('.hscroll') && x.closest('.hscroll').remove());
    if (under.status === 'fulfilled' && under.value.length) fresh.appendChild(cardRow(under.value.slice(0, 20)));
    else fresh.remove();
  }

  function showAllTrending(all) {
    content.innerHTML = '';
    const sec = el('<div class="section"></div>');
    sec.append(sectionHead('Haftanın en çok dinlenenleri', 'Geri', fill), playButtons(() => all), trackList(all, { numbered: true, showPlays: true }, trackMenu));
    content.appendChild(sec);
    window.scrollTo(0, 0);
  }

  await fill();
}

function genreGrid() {
  return el(`<div class="genre-grid">${GENRES.map(([g, n, c]) => `<a class="genre-tile" style="background:${c}" href="#/tur/${encodeURIComponent(g)}">${esc(n)}</a>`).join('')}</div>`);
}

async function genreView(page, alive, g) {
  page.appendChild(backBtn());
  const color = (GENRES.find(x => x[0] === g) || [])[2] || '#333';
  page.appendChild(el(`<div class="hero" style="--hero:${color}"><div class="art" style="--c1:${color};--c2:#141418">${icon('note')}</div><h1>${esc(genreName(g))}</h1><div class="sub">Bu haftanın en sevilenleri</div></div>`));
  const holder = el(`<div>${skeletonRows(8)}</div>`);
  page.appendChild(holder);
  const list = await api.trending(g);
  if (!alive()) return;
  holder.innerHTML = '';
  if (!list.length) { holder.appendChild(el('<div class="empty">Bu türde şarkı bulunamadı.</div>')); return; }
  holder.append(playButtons(() => list), trackList(list, { numbered: true, showPlays: true }, trackMenu));
}

/* ================== Ara ================== */
let searchQ = '';
let searchCache = null;

function recentSearches() { try { return JSON.parse(localStorage.getItem('searches') || '[]'); } catch { return []; } }
function saveSearch(q) {
  const l = recentSearches().filter(x => x.toLocaleLowerCase('tr') !== q.toLocaleLowerCase('tr'));
  l.unshift(q);
  try { localStorage.setItem('searches', JSON.stringify(l.slice(0, 8))); } catch {}
}

async function searchView(page, alive) {
  const box = el(`<form class="search-box" role="search"><div class="search-field">${icon('search')}<input type="search" enterkeyhint="search" placeholder="Şarkı, sanatçı veya liste ara" autocomplete="off"><button type="button" class="icon-btn" data-x aria-label="Temizle" hidden>${icon('close')}</button></div></form>`);
  const input = $('input', box);
  const clear = $('[data-x]', box);
  input.value = searchQ;
  clear.hidden = !searchQ;
  page.appendChild(box);
  const results = el('<div></div>');
  page.appendChild(results);

  let timer;
  input.addEventListener('input', () => {
    clear.hidden = !input.value;
    clearTimeout(timer);
    timer = setTimeout(() => run(input.value.trim()), 450);
  });
  box.onsubmit = e => { e.preventDefault(); clearTimeout(timer); input.blur(); run(input.value.trim(), true); };
  clear.onclick = () => { input.value = ''; clear.hidden = true; run(''); input.focus(); };

  let runSeq = 0;
  async function run(q, commit = false) {
    searchQ = q;
    const my = ++runSeq;
    results.innerHTML = '';
    if (!q) { searchCache = null; idle(); return; }
    if (commit) saveSearch(q);

    // Önce kitaplıkta ara (internetsiz de çalışır)
    const ql = q.toLocaleLowerCase('tr');
    const local = [...store.lib.values()].filter(t => (t.downloaded || t.liked) &&
      ((t.title || '').toLocaleLowerCase('tr').includes(ql) || (t.artist || '').toLocaleLowerCase('tr').includes(ql)));
    if (local.length) {
      const s = el('<div class="section" style="margin-top:8px"></div>');
      s.append(sectionHead('Kitaplığında'), trackList(local.slice(0, 5), {}, trackMenu));
      results.appendChild(s);
    }
    if (!online()) {
      results.appendChild(el(`<div class="empty">${icon('offline')}<b>İnternet yok</b>Yeni şarkı aramak için internete bağlanın.</div>`));
      return;
    }
    const loading = el(`<div>${skeletonRows(6)}</div>`);
    results.appendChild(loading);
    let data = searchCache && searchCache.q === q ? searchCache : null;
    if (!data) {
      const [tr, us, pl] = await Promise.allSettled([api.searchTracks(q), api.searchUsers(q), api.searchPlaylists(q)]);
      data = { q, tracks: tr.value || [], users: us.value || [], playlists: pl.value || [], failed: tr.status === 'rejected' };
      if (!data.failed) searchCache = data;
    }
    if (my !== runSeq || !alive()) return;
    loading.remove();
    if (data.failed) { results.appendChild(errorBox(() => run(q))); return; }
    if (!data.tracks.length && !data.users.length && !data.playlists.length) {
      results.appendChild(el(`<div class="empty">${icon('search')}<b>Sonuç yok</b>“${esc(q)}” için bir şey bulunamadı. Başka bir kelime deneyin.</div>`));
      return;
    }
    if (data.tracks.length) {
      const s = el('<div class="section" style="margin-top:8px"></div>');
      s.append(sectionHead('Şarkılar'), trackList(data.tracks.slice(0, 20), { showPlays: true }, trackMenu));
      results.appendChild(s);
    }
    const users = data.users.filter(u => u.trackCount > 0);
    if (users.length) {
      const s = el('<div class="section"></div>');
      const r = el(`<div class="hscroll">${users.map(artistCard).join('')}</div>`);
      s.append(sectionHead('Sanatçılar'), r);
      results.appendChild(s);
      hydrate(r);
    }
    if (data.playlists.length) {
      const s = el('<div class="section"></div>');
      const r = el(`<div class="hscroll">${data.playlists.map(playlistCard).join('')}</div>`);
      s.append(sectionHead('Listeler'), r);
      results.appendChild(s);
      hydrate(r);
    }
  }

  function idle() {
    const rs = recentSearches();
    if (rs.length) {
      const s = el('<div class="section" style="margin-top:6px"></div>');
      s.appendChild(sectionHead('Son aramalar', 'Temizle', () => { try { localStorage.removeItem('searches'); } catch {} s.remove(); }));
      const c = el(`<div class="chips" style="flex-wrap:wrap">${rs.map(q => `<button class="chip" type="button">${esc(q)}</button>`).join('')}</div>`);
      c.onclick = e => { const b = e.target.closest('.chip'); if (b) { input.value = b.textContent; clear.hidden = false; run(b.textContent, true); } };
      s.appendChild(c);
      results.appendChild(s);
    }
    const g = el('<div class="section"></div>');
    g.append(sectionHead('Türlere göz at'), genreGrid());
    results.appendChild(g);
  }

  if (searchQ) await run(searchQ); else idle();
  if (!searchQ) setTimeout(() => { if (alive() && matchMedia('(hover: hover)').matches) input.focus(); }, 50);
}

/* ================== Kitaplığım ================== */
let libTab = 'indirilen';
let libFilter = '';

async function libraryView(page, alive) {
  const head = el(`<div class="page-head"><h1>Kitaplığım</h1><button class="btn" data-up>${icon('upload')}Telefondan ekle</button></div>`);
  $('[data-up]', head).onclick = () => $('#fileInput').click();
  page.appendChild(head);

  const segs = el('<div class="seg"></div>');
  const body = el('<div></div>');
  page.append(segs, body);

  function draw() {
    const all = [...store.lib.values()];
    const downloaded = all.filter(t => t.downloaded).sort((a, b) => (b.downloadedAt || b.addedAt || 0) - (a.downloadedAt || a.addedAt || 0));
    const liked = all.filter(t => t.liked).sort((a, b) => (b.likedAt || 0) - (a.likedAt || 0));
    const pls = store.playlists;
    segs.innerHTML = [['indirilen', 'İndirilenler', downloaded.length], ['begenilen', 'Beğendiklerim', liked.length], ['listeler', 'Listelerim', pls.length]]
      .map(([k, n, c]) => `<button class="chip${libTab === k ? ' on' : ''}" data-k="${k}">${n} <span style="opacity:.6">${c}</span></button>`).join('');
    segs.onclick = e => { const c = e.target.closest('.chip'); if (c) { libTab = c.dataset.k; draw(); } };
    body.innerHTML = '';

    if (libTab === 'listeler') {
      const nb = el(`<div class="actions"><button class="btn primary">${icon('plus')}Yeni liste</button></div>`);
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

    const isDl = libTab === 'indirilen';
    let items = isDl ? downloaded : liked;
    const downloading = isDl ? [...store.progress.keys()] : [];
    if (!items.length && !downloading.length) {
      body.appendChild(el(isDl
        ? `<div class="empty">${icon('download')}<b>İndirilmiş şarkı yok</b>Bir şarkıyı indirmek için yanındaki ⋮ düğmesine ya da çalarken ${'⬇'} simgesine dokun. İndirilenler internetsiz çalar.<div class="actions" style="justify-content:center;margin-top:14px"><a class="btn primary" href="#/kesfet">Keşfet’e git</a></div></div>`
        : `<div class="empty">${icon('heart')}<b>Beğendiğin şarkı yok</b>Çalarken ♡ simgesine dokunarak şarkıları buraya ekle.</div>`));
      return;
    }
    if (downloading.length) body.appendChild(el(`<div class="note">${downloading.length} şarkı indiriliyor...</div>`));
    if (items.length > 12) {
      const f = el(`<input class="filter" type="search" placeholder="Bu listede ara...">`);
      f.value = libFilter;
      f.oninput = () => { libFilter = f.value; drawList(); };
      body.appendChild(f);
    }
    const listHolder = el('<div></div>');
    const btns = playButtons(() => filtered(), { download: !isDl });
    body.append(btns, listHolder);
    const filtered = () => {
      const q = libFilter.trim().toLocaleLowerCase('tr');
      return q ? items.filter(t => (t.title + ' ' + (t.artist || '')).toLocaleLowerCase('tr').includes(q)) : items;
    };
    function drawList() {
      listHolder.innerHTML = '';
      const l = filtered();
      listHolder.appendChild(l.length ? trackList(l, {}, trackMenu) : el('<div class="empty">Bulunamadı.</div>'));
    }
    drawList();
    if (isDl) {
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
  const off = store.on(type => {
    if (!document.body.contains(page)) { off(); return; }
    if (type === 'library') draw();
  });
}

$('#fileInput').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length) { libTab = 'indirilen'; await store.importFiles(files); }
});

/* ================== Audius listesi / sanatçı ================== */
async function playlistView(page, alive, id) {
  page.appendChild(backBtn());
  page.insertAdjacentHTML('beforeend', `<div class="hero"><div class="art skel"></div><h1>&nbsp;</h1></div>${skeletonRows(6)}`);
  const [p, list] = await Promise.all([api.playlist(id), api.playlistTracks(id)]);
  if (!alive()) return;
  page.innerHTML = '';
  page.appendChild(backBtn());
  const hero = el(`<div class="hero">${art(p, '', 'playlist')}<h1>${esc(p.name)}</h1><div class="sub">${esc(p.owner || '')} · ${list.length} şarkı</div></div>`);
  page.appendChild(hero);
  hydrate(hero);
  tintFrom(p.artwork, 'pl' + p.id).then(c => c && hero.style.setProperty('--hero', c));
  page.append(playButtons(() => list), trackList(list, {}, trackMenu));
}

async function artistView(page, alive, id) {
  page.appendChild(backBtn());
  page.insertAdjacentHTML('beforeend', `<div class="hero"><div class="art round skel"></div><h1>&nbsp;</h1></div>${skeletonRows(6)}`);
  const [u, list] = await Promise.all([api.user(id), api.userTracks(id)]);
  if (!alive()) return;
  page.innerHTML = '';
  page.appendChild(backBtn());
  const hero = el(`<div class="hero">${art({ ...u, title: u.name }, 'round', 'user')}<h1>${esc(u.name)}</h1><div class="sub">${fmtCount(u.followers)} takipçi · ${list.length} şarkı</div></div>`);
  page.appendChild(hero);
  hydrate(hero);
  tintFrom(u.avatar, 'u' + u.id).then(c => c && hero.style.setProperty('--hero', c));
  if (!list.length) { page.appendChild(el('<div class="empty">Bu sanatçının dinlenebilir şarkısı yok.</div>')); return; }
  page.append(playButtons(() => list), sectionHead('Popüler şarkılar'), trackList(list, { numbered: true, showPlays: true }, trackMenu));
}

/* ================== Kendi listem ================== */
async function myPlaylistView(page, alive, id) {
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
        { icon: 'trash', label: 'Listeyi sil', danger: true, run: async () => { if (await askConfirm('Liste silinsin mi?', '“' + p.name + '” silinecek. İndirilen şarkılar silinmez.', 'Sil', true)) { await store.deletePlaylist(p); go('#/kitaplik'); } } },
      ],
    });
    acts.appendChild(more);
    page.appendChild(acts);
    if (!tracks.length) page.appendChild(el(`<div class="empty">${icon('playlist')}<b>Liste boş</b>Şarkıların ⋮ menüsünden “Listeye ekle” ile şarkı ekle.</div>`));
    else page.appendChild(trackList(tracks, { ctx: p }, trackMenu));
    hydrate(hero);
    const t0 = first;
    if (t0 && t0.artwork) tintFrom(t0.artwork, t0.id).then(c => c && hero.style.setProperty('--hero', c));
  };
  draw();
  const off = store.on(type => {
    if (!document.body.contains(page)) { off(); return; }
    if (type === 'library') draw();
  });
}

/* ================== Şarkı menüsü ================== */
function trackMenu(track, ctxPlaylist) {
  const t = store.known(track);
  const items = [
    { icon: 'playNext', label: 'Sıradaki olarak çal', run: () => player.playNext(t) },
    { icon: 'queue', label: 'Sıraya ekle', run: () => player.addToQueue(t) },
    store.isLiked(t.id)
      ? { icon: 'heartFill', label: 'Beğendiklerimden çıkar', on: true, run: () => store.toggleLike(t).then(() => toast('Beğendiklerinden çıkarıldı')) }
      : { icon: 'heart', label: 'Beğen', run: () => store.toggleLike(t).then(() => toast('Beğendiklerine eklendi')) },
    { icon: 'addList', label: 'Listeye ekle', run: () => chooseList(t) },
  ];
  if (ctxPlaylist) items.push({ icon: 'close', label: 'Bu listeden çıkar', run: () => store.removeFromPlaylist(ctxPlaylist, t.id) });
  if (t.source === 'audius') {
    if (store.isDownloaded(t.id)) items.push({ icon: 'trash', label: 'İndirilenlerden sil', danger: true, run: () => store.removeDownload(t).then(() => toast('İndirme silindi')) });
    else if (store.progress.has(t.id)) items.push({ icon: 'download', label: 'İndiriliyor... %' + store.progress.get(t.id) });
    else items.push({ icon: 'download', label: 'İndir (internetsiz dinle)', run: () => { if (!online()) return toast('İndirmek için internet gerekir'); store.download(t); toast('İndiriliyor...'); } });
    if (t.artistId) items.push({ icon: 'user', label: 'Sanatçıya git', run: () => go('#/sanatci/' + encodeURIComponent(t.artistId)) });
  } else {
    items.push({ icon: 'edit', label: 'Adını düzenle', run: () => renameLocal(t) });
    items.push({ icon: 'trash', label: 'Telefondan sil', danger: true, run: async () => {
      if (await askConfirm('Şarkı silinsin mi?', '“' + t.title + '” uygulamadan silinecek.', 'Sil', true)) { await store.removeDownload(t); toast('Silindi'); }
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
  renderMini(); if (!$('#np').hidden) renderNP();
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
  hydrate(mini);
  updateTime();
  applyTint(t);
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
  let url = t.artwork;
  const saved = store.lib.get(t.id);
  const img = $('img[src^="blob:"]', mini);
  if (saved && saved.hasArt && img) url = img.src;
  let c = null;
  if (url && (online() || url.startsWith('blob:'))) c = await tintFrom(url, t.id);
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
  pushLayer(() => { np.hidden = true; document.body.style.overflow = ''; });
}
setNowPlayingOpener(openNP);

function renderNP() {
  const t = player.current();
  if (!t) { if (!np.hidden) closeLayer(); return; }
  const s = player.state;
  const playing = player.isPlaying();
  const liked = store.isLiked(t.id);
  const dl = store.isDownloaded(t.id), ing = store.progress.has(t.id);
  const sleepOn = s.sleepAt || s.sleepEnd;
  np.innerHTML = `
    <div class="np-top">
      <button class="icon-btn" data-close aria-label="Kapat">${icon('down')}</button>
      <span class="label">Şimdi çalıyor</span>
      <button class="icon-btn" data-more aria-label="Seçenekler">${icon('more')}</button>
    </div>
    <div class="np-art-wrap">${art(t, 'np-art')}</div>
    <div class="np-info">
      <div class="meta"><div class="np-title">${esc(t.title)}</div><div class="np-artist${t.artistId ? ' link' : ''}" data-artist>${esc(t.artist || 'Müziklerim')}</div></div>
      ${t.source === 'audius' ? `<button class="icon-btn${dl ? ' done' : ''}" data-dl aria-label="İndir">${ing ? `<span class="pct">%${store.progress.get(t.id)}</span>` : icon(dl ? 'downloaded' : 'download')}</button>` : ''}
      <button class="icon-btn${liked ? ' liked' : ''}" data-like aria-label="Beğen">${icon(liked ? 'heartFill' : 'heart')}</button>
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
      <button class="btn${sleepOn ? ' on' : ''}" data-sl>${icon('moon')}${sleepLabel()}</button>
    </div>`;
  hydrate(np);
  updateTime();
}

function sleepLabel() {
  const s = player.state;
  if (s.sleepEnd) return 'Şarkı bitince';
  if (s.sleepAt) return Math.max(1, Math.round((s.sleepAt - Date.now()) / 60e3)) + ' dk';
  return 'Uyku';
}

let seeking = false;
np.addEventListener('click', e => {
  const b = e.target.closest('button, [data-artist]');
  if (!b) return;
  const t = player.current();
  if (b.matches('[data-close]')) closeLayer();
  else if (b.matches('[data-pp]')) player.toggle();
  else if (b.matches('[data-nx]')) player.next();
  else if (b.matches('[data-pv]')) player.prev();
  else if (b.matches('[data-sh]')) toast(player.toggleShuffle() ? 'Karışık çalma açık' : 'Karışık çalma kapalı');
  else if (b.matches('[data-rp]')) { const r = player.cycleRepeat(); toast(r === 'all' ? 'Liste bitince baştan başlar' : r === 'one' ? 'Bu şarkı tekrarlanır' : 'Tekrar kapalı'); }
  else if (b.matches('[data-like]')) store.toggleLike(t).then(l => { toast(l ? 'Beğendiklerine eklendi' : 'Beğendiklerinden çıkarıldı'); renderNP(); });
  else if (b.matches('[data-dl]')) {
    if (store.isDownloaded(t.id)) toast('Bu şarkı indirilmiş, internetsiz çalar');
    else if (!store.progress.has(t.id)) { if (!online()) return toast('İndirmek için internet gerekir'); store.download(t); toast('İndiriliyor...'); }
  }
  else if (b.matches('[data-artist]')) { if (t.artistId) go('#/sanatci/' + encodeURIComponent(t.artistId)); }
  else if (b.matches('[data-more]')) trackMenu(t);
  else if (b.matches('[data-q]')) openQueue();
  else if (b.matches('[data-sl]')) openSleep();
});
np.addEventListener('input', e => {
  if (e.target.type !== 'range') return;
  seeking = true;
  const { dur } = player.time();
  e.target.style.setProperty('--p', (e.target.value / 10) + '%');
  const c = $('[data-cur]', np); if (c) c.textContent = fmtTime(e.target.value / 1000 * dur);
});
np.addEventListener('change', e => {
  if (e.target.type !== 'range') return;
  const { dur } = player.time();
  player.seek(e.target.value / 1000 * dur);
  seeking = false;
});

function updateTime() {
  const { cur, dur } = player.time();
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
      <div class="meta"><div class="t">${esc(t.title)}</div><div class="s">${dlBadge(t.id)}<span class="a">${esc(t.artist || '')}</span></div></div>
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
  if (type === 'toast') toast(data);
  else if (type === 'progress') {
    for (const b of $$(`[data-dl="${CSS.escape(data.id)}"]`)) b.outerHTML = dlBadge(data.id);
    const t = player.current();
    if (t && t.id === data.id && !np.hidden) {
      const btn = $('[data-dl]', np);
      if (btn) { btn.classList.toggle('done', store.isDownloaded(t.id)); btn.innerHTML = store.progress.has(t.id) ? `<span class="pct">%${store.progress.get(t.id)}</span>` : icon(store.isDownloaded(t.id) ? 'downloaded' : 'download'); }
    }
  } else if (type === 'library') {
    for (const b of $$('[data-dl]')) if (b.classList.contains('dlb')) b.outerHTML = dlBadge(b.dataset.dl);
  } else if (type === 'player') {
    const t = player.current();
    document.body.classList.toggle('playing', player.isPlaying());
    for (const r of $$('.view .row[data-id]')) r.classList.toggle('now', !!t && r.dataset.id === t.id);
    renderMini();
    if (!np.hidden) renderNP();
  } else if (type === 'time') updateTime();
});

/* İnternet durumu */
function netChanged() {
  const bar = $('#offlineBar');
  bar.hidden = online();
  bar.innerHTML = icon('offline') + 'İnternet yok · İndirdiğin şarkılar çalabilir';
  for (const r of $$('.view .row[data-id]')) r.classList.toggle('off', !online() && !store.isDownloaded(r.dataset.id));
}
window.addEventListener('online', () => { netChanged(); toast('İnternet geri geldi'); if (/kesfet|^#?$|ara/.test(location.hash)) route(); });
window.addEventListener('offline', netChanged);

/* Klavye kısayolları (bilgisayarda) */
document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); player.toggle(); }
  else if (e.key === 'ArrowRight' && e.shiftKey) player.next();
  else if (e.key === 'ArrowLeft' && e.shiftKey) player.prev();
});

/* ================== Başlat ================== */
(async function start() {
  netChanged();
  try { await store.loadLibrary(); } catch (e) { console.error(e); toast('Kitaplık yüklenemedi'); }
  player.restore();
  renderMini();
  if (!location.hash) history.replaceState(null, '', '#/kesfet');
  route();
})();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e)));
}
