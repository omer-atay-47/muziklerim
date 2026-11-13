// Klip: YouTube'un resmi gömülü oynatıcısıyla (IFrame Player API) videoyu gösterir.
// Video indirilmez; YouTube'dan doğrudan oynatılır, bu yüzden internet gerekir.

export function parseVideoId(text) {
  if (!text) return null;
  const s = String(text).trim();
  const m = s.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/|v\/))([\w-]{11})/i)
    || s.match(/^([\w-]{11})$/);
  return m ? m[1] : null;
}

export const searchUrl = t =>
  'https://www.youtube.com/results?search_query=' + encodeURIComponent([t.artist, t.title, 'klip'].filter(Boolean).join(' '));

export const thumbUrl = id => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

let apiP = null;
function loadApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiP) return apiP;
  apiP = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => { apiP = null; reject(new Error('YouTube oynatıcısı yüklenemedi')); };
    document.head.appendChild(s);
    setTimeout(() => { if (!(window.YT && window.YT.Player)) { apiP = null; reject(new Error('zaman aşımı')); } }, 15000);
  });
  return apiP;
}

const box = document.getElementById('videoBox');
let yt = null;
let ready = false;
let handlers = {};

export const state = { active: false, trackId: null, playing: false };

const ERRORS = {
  2: 'Klip bağlantısı hatalı.',
  5: 'Bu klip bu cihazda oynatılamıyor.',
  100: 'Klip YouTube’dan kaldırılmış ya da gizli.',
  101: 'Bu klip uygulama içinde oynatılamıyor (sahibi izin vermiyor ya da bağlantı hatalı). Başka bir bağlantı deneyin.',
  150: 'Bu klip uygulama içinde oynatılamıyor (sahibi izin vermiyor ya da bağlantı hatalı). Başka bir bağlantı deneyin.',
  153: 'Klip oynatılamadı.',
};

// handlers: { onState(playing), onEnded(), onError(message) }
export async function open(videoId, trackId, startSec, h) {
  handlers = h || {};
  close();
  state.active = true;
  state.trackId = trackId;
  state.playing = false;
  box.hidden = false;
  box.innerHTML = '<div class="video-loading">Klip yükleniyor…</div><div id="ytFrame"></div>';
  let YT;
  try { YT = await loadApi(); } catch (e) {
    if (state.trackId === trackId) handlers.onError && handlers.onError('Klip yüklenemedi. İnternet bağlantısını kontrol edin.');
    return;
  }
  if (!state.active || state.trackId !== trackId) return;
  ready = false;
  yt = new YT.Player('ytFrame', {
    width: '100%',
    height: '100%',
    videoId,
    playerVars: {
      autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, fs: 1,
      start: Math.max(0, Math.floor(startSec || 0)),
      origin: location.origin,
    },
    events: {
      onReady: e => { ready = true; try { e.target.playVideo(); } catch {} },
      onStateChange: e => {
        const loading = box.querySelector('.video-loading');
        if (loading && e.data !== -1) loading.remove();
        const playing = e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.BUFFERING;
        if (playing !== state.playing) { state.playing = playing; handlers.onState && handlers.onState(playing); }
        if (e.data === YT.PlayerState.ENDED) handlers.onEnded && handlers.onEnded();
      },
      onError: e => handlers.onError && handlers.onError(ERRORS[e.data] || 'Klip oynatılamadı.'),
    },
  });
}

export function close() {
  let t = 0;
  if (yt) {
    try { t = yt.getCurrentTime() || 0; } catch {}
    try { yt.destroy(); } catch {}
  }
  yt = null;
  ready = false;
  state.active = false;
  state.playing = false;
  state.trackId = null;
  box.hidden = true;
  box.innerHTML = '';
  return t;
}

export function toggle() {
  if (!yt || !ready) return;
  try { state.playing ? yt.pauseVideo() : yt.playVideo(); } catch {}
}

export function time() {
  if (!yt || !ready) return { cur: 0, dur: 0 };
  try { return { cur: yt.getCurrentTime() || 0, dur: yt.getDuration() || 0 }; } catch { return { cur: 0, dur: 0 }; }
}

export function seek(sec) {
  if (yt && ready) { try { yt.seekTo(sec, true); } catch {} }
}

// Videoyu tam ekran çalardaki yerine oturt
export function place(slot) {
  if (!state.active || !slot) { box.style.visibility = 'hidden'; return; }
  const r = slot.getBoundingClientRect();
  Object.assign(box.style, { visibility: 'visible', top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px' });
}
