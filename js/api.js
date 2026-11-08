// Audius: sanatçıların ücretsiz paylaştığı açık müzik kataloğu
const BASE = 'https://api.audius.co/v1';
const APP = 'muziklerim';
const cache = new Map();

async function get(path, params = {}, ttl = 5 * 60e3) {
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, v);
  u.searchParams.set('app_name', APP);
  const key = u.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.d;
  const res = await fetch(key);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  cache.set(key, { t: Date.now(), d: json.data });
  return json.data;
}

const art = (a, size = '480x480') => (a && (a[size] || a['480x480'] || a['150x150'] || a['1000x1000'])) || '';

function playable(t) {
  return t && !t.is_delete && t.is_available !== false && t.is_streamable !== false &&
    !t.stream_conditions && !(t.access && t.access.stream === false);
}

export function normTrack(t) {
  return {
    id: 'a:' + t.id,
    aid: t.id,
    title: t.title,
    artist: (t.user && t.user.name) || '',
    artistId: t.user && t.user.id,
    duration: t.duration || 0,
    artwork: art(t.artwork),
    artSmall: art(t.artwork, '150x150'),
    artMirrors: (t.artwork && t.artwork.mirrors) || [],
    genre: t.genre || '',
    plays: t.play_count || 0,
    source: 'audius',
  };
}
const tracks = list => (list || []).filter(playable).map(normTrack);

function normPlaylist(p) {
  return {
    id: p.id,
    name: p.playlist_name,
    owner: p.user && p.user.name,
    count: p.track_count || 0,
    artwork: art(p.artwork),
    artMirrors: (p.artwork && p.artwork.mirrors) || [],
    isAlbum: !!p.is_album,
  };
}

function normUser(u) {
  return {
    id: u.id,
    name: u.name,
    handle: u.handle,
    followers: u.follower_count || 0,
    trackCount: u.track_count || 0,
    avatar: art(u.profile_picture),
    artMirrors: (u.profile_picture && u.profile_picture.mirrors) || [],
    cover: u.cover_photo ? (u.cover_photo['2000x'] || u.cover_photo['640x'] || '') : '',
    bio: u.bio || '',
  };
}

export const api = {
  trending: (genre = '', time = 'week') => get('/tracks/trending', { genre, time, limit: 40 }).then(tracks),
  underground: () => get('/tracks/trending/underground', { limit: 30 }).then(tracks),
  trendingPlaylists: () => get('/playlists/trending', { limit: 20, time: 'week' }).then(l => (l || []).map(normPlaylist)),
  searchTracks: q => get('/tracks/search', { query: q, limit: 40 }).then(tracks),
  searchUsers: q => get('/users/search', { query: q, limit: 20 }).then(l => (l || []).map(normUser)),
  searchPlaylists: q => get('/playlists/search', { query: q, limit: 20 }).then(l => (l || []).map(normPlaylist)),
  user: id => get('/users/' + encodeURIComponent(id)).then(normUser),
  userTracks: id => get('/users/' + encodeURIComponent(id) + '/tracks', { limit: 50, sort: 'plays' }).then(tracks),
  playlist: id => get('/playlists/' + encodeURIComponent(id)).then(d => normPlaylist(Array.isArray(d) ? d[0] : d)),
  playlistTracks: id => get('/playlists/' + encodeURIComponent(id) + '/tracks').then(tracks),
  streamUrl: aid => `${BASE}/tracks/${encodeURIComponent(aid)}/stream?app_name=${APP}`,
};

// Türkçe adlarıyla türler (Audius tür adları)
export const GENRES = [
  ['Pop', 'Pop', '#e8457a'],
  ['Hip-Hop/Rap', 'Rap', '#f08a24'],
  ['Electronic', 'Elektronik', '#3a7bff'],
  ['Rock', 'Rock', '#d9473b'],
  ['Acoustic', 'Akustik', '#c99b54'],
  ['Lo-Fi', 'Lo-fi', '#7f6bd6'],
  ['R&B/Soul', 'R&B', '#b0447f'],
  ['Jazz', 'Caz', '#2d9c8f'],
  ['Classical', 'Klasik', '#8a7b62'],
  ['World', 'Dünya', '#3f9d4b'],
  ['Folk', 'Folk', '#a26b3d'],
  ['Ambient', 'Rahatlatıcı', '#4b8fb3'],
  ['House', 'House', '#9b3fd1'],
  ['Alternative', 'Alternatif', '#5b6b8f'],
  ['Latin', 'Latin', '#e0573a'],
  ['Soundtrack', 'Film Müziği', '#6f6f7f'],
];
