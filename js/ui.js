// Ortak arayüz parçaları: şarkı satırı, kartlar, menüler, pencereler
import { icon } from './icons.js';
import { db } from './db.js';
import { lib, progress, isDownloaded } from './store.js';
import * as player from './player.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = Math.floor(s % 60);
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
}

export function fmtSize(b) {
  if (b >= 1e9) return (b / 1e9).toFixed(1).replace('.', ',') + ' GB';
  return Math.max(1, Math.round(b / 1e6)) + ' MB';
}

export function fmtCount(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',').replace(',0', '') + ' Mn';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.', ',').replace(',0', '') + ' B';
  return String(n);
}

/* ---------- Kapak görselleri ---------- */
function hashColor(str) {
  let h = 0;
  for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  return [`hsl(${hue} 38% 34%)`, `hsl(${(hue + 40) % 360} 42% 18%)`];
}
const localArt = new Map();

// Kapak yüklenemezse yedek sunuculardan dene
window.__artErr = img => {
  const list = (img.dataset.m || '').split('|').filter(Boolean);
  const nextHost = list.shift();
  if (!nextHost || !img.src.startsWith('http')) { img.remove(); return; }
  img.dataset.m = list.join('|');
  const u = new URL(img.src);
  img.src = nextHost.replace(/\/$/, '') + u.pathname + u.search;
};

export function art(item, cls = '', fallbackIcon = 'note') {
  const key = item.id || item.name || item.title || '';
  const [c1, c2] = hashColor(item.title || item.name || key);
  const saved = item.id && lib.get(item.id);
  const useLocal = saved && saved.hasArt;
  const src = useLocal ? '' : (item.artwork || item.avatar || '');
  const mirrors = (item.artMirrors || []).join('|');
  return `<div class="art ${cls}" style="--c1:${c1};--c2:${c2}">${icon(fallbackIcon)}` +
    (src || useLocal ? `<img alt="" loading="lazy" decoding="async" ${useLocal ? `data-local="${esc(item.id)}"` : `src="${esc(src)}"`}${mirrors ? ` data-m="${esc(mirrors)}"` : ''} onload="this.classList.add('ok')" onerror="__artErr(this)">` : '') +
    `</div>`;
}

// İndirilen şarkıların kapaklarını telefondan yükle (internetsiz de görünsün)
export async function hydrate(root) {
  for (const img of $$('img[data-local]', root)) {
    const id = img.dataset.local;
    img.removeAttribute('data-local');
    let url = localArt.get(id);
    if (!url) {
      const b = await db.getArt(id).catch(() => null);
      if (!b) { const t = lib.get(id); if (t && t.artwork && navigator.onLine) img.src = t.artwork; else img.remove(); continue; }
      url = URL.createObjectURL(b);
      localArt.set(id, url);
    }
    img.src = url;
  }
}

/* ---------- Şarkı satırı ---------- */
export function dlBadge(id) {
  if (progress.has(id)) return `<span class="dlb ing" data-dl="${esc(id)}">%${progress.get(id)}</span>`;
  return `<span class="dlb" data-dl="${esc(id)}"></span>`;
}

export function trackRow(t, i, opts = {}) {
  const cur = player.current();
  const now = cur && cur.id === t.id;
  const off = !navigator.onLine && !isDownloaded(t.id);
  const sub = [t.artist, opts.showPlays && t.plays ? fmtCount(t.plays) + ' dinlenme' : '', t.duration ? fmtTime(t.duration) : '']
    .filter(Boolean).join(' · ');
  return `<div class="row${now ? ' now' : ''}${off ? ' off' : ''}" data-i="${i}" data-id="${esc(t.id)}">
    ${opts.numbered ? `<span class="num">${i + 1}</span>` : ''}
    <div class="art-wrap" style="position:relative">${art(t, 'sm')}<div class="eq"><i></i><i></i><i></i></div></div>
    <div class="meta"><div class="t">${esc(t.title)}</div><div class="s">${dlBadge(t.id)}${t.kind === 'video' ? `<span class="vbadge" title="Klip">${icon('video')}</span>` : ''}<span class="a">${esc(sub || 'Bilinmeyen sanatçı')}</span></div></div>
    <button class="icon-btn" data-more aria-label="Seçenekler">${icon('more')}</button>
  </div>`;
}

// Bir şarkı listesi kutusu; satıra dokununca listeyi o şarkıdan çalar
export function trackList(tracks, opts = {}, onMore) {
  const box = el(`<div class="list"></div>`);
  box.innerHTML = tracks.map((t, i) => trackRow(t, i, opts)).join('');
  box.addEventListener('click', e => {
    const row = e.target.closest('.row');
    if (!row) return;
    const t = tracks[+row.dataset.i];
    if (e.target.closest('[data-more]')) { onMore(t, opts.ctx); return; }
    const cur = player.current();
    if (cur && cur.id === t.id) {
      player.adoptQueue(tracks, +row.dataset.i);
      if (!player.isPlaying()) player.toggle();
      openNowPlaying();
      return;
    }
    player.playList(tracks, +row.dataset.i);
  });
  hydrate(box);
  return box;
}
let openNowPlaying = () => {};
export function setNowPlayingOpener(fn) { openNowPlaying = fn; }

export function trackCard(t, i) {
  return `<div class="card" data-i="${i}">${art(t)}<div class="t">${esc(t.title)}</div><div class="s">${esc(t.artist)}</div></div>`;
}
export function playlistCard(p) {
  return `<a class="card" href="#/liste/${encodeURIComponent(p.id)}">${art(p, '', 'playlist')}<div class="t">${esc(p.name)}</div><div class="s">${esc(p.owner || '')}${p.count ? ' · ' + p.count + ' şarkı' : ''}</div></a>`;
}
export function artistCard(u) {
  return `<a class="card artist" href="#/sanatci/${encodeURIComponent(u.id)}">${art({ ...u, title: u.name }, 'round', 'user')}<div class="t">${esc(u.name)}</div><div class="s">${fmtCount(u.followers)} takipçi</div></a>`;
}

export function skeletonRows(n = 6) { return Array.from({ length: n }, () => '<div class="skel skel-row"></div>').join(''); }
export function skeletonCards(n = 4) { return `<div class="hscroll">${Array.from({ length: n }, () => '<div class="skel skel-card"></div>').join('')}</div>`; }

/* ---------- Geri tuşuyla kapanan katmanlar ---------- */
const stack = [];
let popWaiter = null;

export function pushLayer(close) {
  stack.push(close);
  history.pushState({ layer: stack.length }, '');
}
export function closeLayer() {
  return new Promise(res => {
    if (!stack.length) return res();
    const close = stack.pop();
    close();
    popWaiter = res;
    history.back();
  });
}
export const hasLayer = () => stack.length > 0;
window.addEventListener('popstate', () => {
  if (popWaiter) { const r = popWaiter; popWaiter = null; r(); return; }
  if (stack.length) stack.pop()();
});
export async function go(hash) {
  while (stack.length) await closeLayer();
  if (location.hash !== hash) location.hash = hash;
}

/* ---------- Alttan açılan menü ---------- */
const layer = () => $('#layer');

function showLayer(content, center = false) {
  const L = layer();
  L.className = 'layer' + (center ? ' center' : '');
  L.innerHTML = '';
  L.appendChild(content);
  L.hidden = false;
  const close = () => { L.hidden = true; L.innerHTML = ''; L.onclick = null; };
  L.onclick = e => { if (e.target === L) closeLayer(); };
  pushLayer(close);
}

// items: [{icon, label, run, danger, on, right}]
export function sheet({ head, title, items = [], body }) {
  const box = el(`<div class="sheet"><div class="grab"></div></div>`);
  if (head) box.appendChild(el(head));
  if (title) box.appendChild(el(`<h3>${esc(title)}</h3>`));
  if (body) box.appendChild(body);
  for (const it of items) {
    const b = el(`<button class="item${it.danger ? ' danger' : ''}${it.on ? ' on' : ''}">${icon(it.icon)}<span>${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>${it.right ? `<span class="r">${esc(it.right)}</span>` : ''}</button>`);
    b.onclick = async () => { await closeLayer(); it.run && it.run(); };
    box.appendChild(b);
  }
  showLayer(box);
  hydrate(box);
  return box;
}

export function trackHead(t) {
  return `<div class="sheet-head">${art(t, 'sm')}<div class="meta"><div class="t">${esc(t.title)}</div><div class="s">${esc(t.artist || '')}</div></div></div>`;
}

export function askText(title, value = '', okLabel = 'Kaydet', placeholder = '') {
  return new Promise(resolve => {
    let done = false;
    const box = el(`<form class="dialog"><h3>${esc(title)}</h3><input maxlength="120" placeholder="${esc(placeholder)}"><div class="row-btns"><button type="button" class="btn ghost" data-c>Vazgeç</button><button class="btn primary">${esc(okLabel)}</button></div></form>`);
    const input = $('input', box);
    input.value = value;
    const finish = v => { if (done) return; done = true; closeLayer().then(() => resolve(v)); };
    box.onsubmit = e => { e.preventDefault(); const v = input.value.trim(); finish(v || null); };
    $('[data-c]', box).onclick = () => finish(null);
    showLayer(box, true);
    stack[stack.length - 1] = (orig => () => { orig(); if (!done) { done = true; resolve(null); } })(stack[stack.length - 1]);
    setTimeout(() => { input.focus(); input.select(); }, 60);
  });
}

export function askConfirm(title, text, okLabel = 'Evet', danger = false) {
  return new Promise(resolve => {
    let done = false;
    const box = el(`<div class="dialog"><h3>${esc(title)}</h3><p>${esc(text)}</p><div class="row-btns"><button class="btn ghost" data-c>Vazgeç</button><button class="btn primary" data-ok ${danger ? 'style="background:var(--danger);color:#fff"' : ''}>${esc(okLabel)}</button></div></div>`);
    const finish = v => { if (done) return; done = true; closeLayer().then(() => resolve(v)); };
    $('[data-c]', box).onclick = () => finish(false);
    $('[data-ok]', box).onclick = () => finish(true);
    showLayer(box, true);
    stack[stack.length - 1] = (orig => () => { orig(); if (!done) { done = true; resolve(false); } })(stack[stack.length - 1]);
  });
}

/* ---------- Bildirim ---------- */
let toastTimer;
export function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------- Kapaktan renk çıkar ---------- */
const tintCache = new Map();
export function tintFrom(url, key) {
  if (tintCache.has(key)) return Promise.resolve(tintCache.get(key));
  return new Promise(async resolve => {
    if (!url) return resolve(null);
    let src = url, tmp = null;
    if (!url.startsWith('blob:')) {
      try {
        const r = await fetch(url, { mode: 'cors' });
        if (!r.ok) return resolve(null);
        tmp = src = URL.createObjectURL(await r.blob());
      } catch { return resolve(null); }
    }
    const img = new Image();
    img.onload = () => {
      if (tmp) setTimeout(() => URL.revokeObjectURL(tmp), 0);
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 16;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0, 16, 16);
        const d = x.getImageData(0, 0, 16, 16).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
          const w = 1 + (mx - mn) / 40;   // canlı renklere ağırlık ver
          r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; n += w;
        }
        r /= n; g /= n; b /= n;
        const k = 0.62;   // koyulaştır
        const col = `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
        tintCache.set(key, col);
        resolve(col);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
