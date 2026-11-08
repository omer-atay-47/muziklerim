// MP3 dosyalarının içindeki şarkı adı, sanatçı ve kapak resmini okur (ID3v2).

function syncsafe(b, o) { return (b[o] & 0x7f) << 21 | (b[o + 1] & 0x7f) << 14 | (b[o + 2] & 0x7f) << 7 | (b[o + 3] & 0x7f); }
function be32(b, o) { return (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0; }
function be24(b, o) { return b[o] << 16 | b[o + 1] << 8 | b[o + 2]; }

// Türkçe eski etiketler çoğunlukla Windows-1254 ile yazılır
const DEC = {
  0: new TextDecoder('windows-1254'),
  1: new TextDecoder('utf-16'),
  2: new TextDecoder('utf-16be'),
  3: new TextDecoder('utf-8'),
};

function text(data) {
  if (!data.length) return '';
  const enc = data[0];
  const dec = DEC[enc] || DEC[0];
  return dec.decode(data.subarray(1)).replace(/\0+/g, ' ').replace(/\s+/g, ' ').trim();
}

function picture(data, v22) {
  const enc = data[0];
  let p = 1;
  let mime;
  if (v22) { mime = 'image/' + String.fromCharCode(data[1], data[2], data[3]).toLowerCase().replace('jpg', 'jpeg'); p = 4; }
  else {
    const end = data.indexOf(0, p);
    mime = new TextDecoder('latin1').decode(data.subarray(p, end)) || 'image/jpeg';
    p = end + 1;
  }
  p++; // resim türü
  // açıklamayı atla
  if (enc === 1 || enc === 2) { while (p + 1 < data.length && !(data[p] === 0 && data[p + 1] === 0)) p += 2; p += 2; }
  else { while (p < data.length && data[p] !== 0) p++; p++; }
  if (!mime.includes('/')) mime = 'image/' + mime;
  if (mime === 'image/jpg') mime = 'image/jpeg';
  const img = data.slice(p);
  return img.length > 100 ? new Blob([img], { type: mime }) : null;
}

export async function readTags(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return {};   // "ID3" yok
    const ver = head[3];
    const flags = head[5];
    const size = syncsafe(head, 6);
    const buf = new Uint8Array(await file.slice(10, 10 + Math.min(size, 6e6)).arrayBuffer());
    const out = {};
    let p = 0;
    if (ver === 2) {
      while (p + 6 <= buf.length) {
        const id = String.fromCharCode(buf[p], buf[p + 1], buf[p + 2]);
        if (!/^[A-Z0-9]{3}$/.test(id)) break;
        const fs = be24(buf, p + 3);
        const data = buf.subarray(p + 6, p + 6 + fs);
        p += 6 + fs;
        if (!fs) break;
        if (id === 'TT2') out.title = text(data);
        else if (id === 'TP1') out.artist = text(data);
        else if (id === 'TAL') out.album = text(data);
        else if (id === 'PIC' && !out.picture) out.picture = picture(data, true);
      }
      return out;
    }
    if (flags & 0x40) p = ver === 4 ? syncsafe(buf, 0) : be32(buf, 0) + 4;
    while (p + 10 <= buf.length) {
      const id = String.fromCharCode(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const fs = ver === 4 ? syncsafe(buf, p + 4) : be32(buf, p + 4);
      const fflags = buf[p + 9];
      let data = buf.subarray(p + 10, p + 10 + fs);
      p += 10 + fs;
      if (!fs) break;
      if (ver === 4 && (fflags & 0x01)) data = data.subarray(4);
      if (id === 'TIT2') out.title = text(data);
      else if (id === 'TPE1') out.artist = text(data);
      else if (id === 'TALB') out.album = text(data);
      else if (id === 'APIC' && !out.picture) out.picture = picture(data, false);
    }
    return out;
  } catch (err) {
    console.warn('etiket okunamadı', file.name, err);
    return {};
  }
}
