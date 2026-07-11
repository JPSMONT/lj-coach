// exif.mjs — read just enough EXIF from a JPEG to place a Trim Check photo on the boat's clock:
// the capture time (preferably GPS/UTC, which is unambiguous) and, if present, the GPS position.
// That timestamp is what joins the photo to the YDWG-02 SessionLog so the wind/speed at the moment
// of the shot fill themselves in — no typing. Pure and dependency-free (parses the TIFF/EXIF block
// directly) so it inlines into the offline page and is testable on synthetic buffers.
//
// Returns { tMs, timebase, subSec, lat, lon } or null:
//   tMs      — epoch milliseconds of capture (UTC)
//   timebase — 'gps'   : from GPSDateStamp+GPSTimeStamp (true UTC, trust for the join)
//              'offset': DateTimeOriginal + OffsetTimeOriginal (true UTC)
//              'local' : DateTimeOriginal with NO offset — treated as UTC, may be off by the tz.
//   lat/lon  — decimal degrees if a GPS position is present, else null.
//
// Only the tags needed for the join are read; everything else is skipped.

const TAG = {
  EXIF_IFD: 0x8769, GPS_IFD: 0x8825,
  DATETIME_ORIGINAL: 0x9003, OFFSET_ORIGINAL: 0x9011, SUBSEC_ORIGINAL: 0x9291,
  GPS_LAT_REF: 0x0001, GPS_LAT: 0x0002, GPS_LON_REF: 0x0003, GPS_LON: 0x0004,
  GPS_TIME: 0x0007, GPS_DATE: 0x001d,
};

// Locate the TIFF header inside a JPEG (APP1 "Exif\0\0"). Accepts a Uint8Array. If the buffer already
// starts with a TIFF header ("II"/"MM") we take it directly (lets tests hand us a bare TIFF block).
function findTiff(u8) {
  if (u8.length >= 2 && ((u8[0] === 0x49 && u8[1] === 0x49) || (u8[0] === 0x4d && u8[1] === 0x4d))) return 0;
  if (u8.length < 2 || u8[0] !== 0xff || u8[1] !== 0xd8) return -1;   // not a JPEG
  let p = 2;
  while (p + 4 <= u8.length) {
    if (u8[p] !== 0xff) { p++; continue; }
    const marker = u8[p + 1];
    if (marker === 0xd9 || marker === 0xda) return -1;                // EOI / start-of-scan — no EXIF
    const len = (u8[p + 2] << 8) | u8[p + 3];
    if (marker === 0xe1 && u8[p + 4] === 0x45 && u8[p + 5] === 0x78 && u8[p + 6] === 0x69 && u8[p + 7] === 0x66) {
      return p + 10;                                                  // skip "Exif\0\0"
    }
    p += 2 + len;
  }
  return -1;
}

function reader(dv, tiff, little) {
  return {
    u16: (o) => dv.getUint16(tiff + o, little),
    u32: (o) => dv.getUint32(tiff + o, little),
    // ASCII string value of an entry (may be inline in the 4 value bytes or at an offset)
    ascii: (entryOff, count) => {
      const off = count <= 4 ? entryOff + 8 : tiff + dv.getUint32(tiff + entryOff + 8, little);
      let s = ''; for (let i = 0; i < count; i++) { const c = dv.getUint8(off + i); if (c === 0) break; s += String.fromCharCode(c); }
      return s;
    },
    // array of RATIONAL (num/den) values at the entry's offset
    rationals: (entryOff, count) => {
      const off = tiff + dv.getUint32(tiff + entryOff + 8, little); const out = [];
      for (let i = 0; i < count; i++) { const n = dv.getUint32(off + i * 8, little), d = dv.getUint32(off + i * 8 + 4, little); out.push(d ? n / d : 0); }
      return out;
    },
  };
}

// Walk one IFD, returning a map tag→{off,type,count}. off is the absolute-in-TIFF entry offset.
function readIFD(dv, tiff, little, ifdOff) {
  const n = dv.getUint16(tiff + ifdOff, little); const entries = {};
  for (let i = 0; i < n; i++) {
    const e = ifdOff + 2 + i * 12; const tag = dv.getUint16(tiff + e, little);
    entries[tag] = { off: e, type: dv.getUint16(tiff + e + 2, little), count: dv.getUint32(tiff + e + 4, little) };
  }
  return entries;
}

function dms(arr, ref) {
  if (!arr || arr.length < 3) return null;
  let v = arr[0] + arr[1] / 60 + arr[2] / 3600;
  if (ref === 'S' || ref === 'W') v = -v;
  return +v.toFixed(6);
}

export function parseExif(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const tiff = findTiff(u8); if (tiff < 0) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const bo = dv.getUint16(tiff, false);
  const little = bo === 0x4949; if (!little && bo !== 0x4d4d) return null;
  if (dv.getUint16(tiff + 2, little) !== 0x002a) return null;
  const r = reader(dv, tiff, little);
  const ifd0 = readIFD(dv, tiff, little, dv.getUint32(tiff + 4, little));
  const exif = ifd0[TAG.EXIF_IFD] ? readIFD(dv, tiff, little, dv.getUint32(tiff + ifd0[TAG.EXIF_IFD].off + 8, little)) : {};
  const gps = ifd0[TAG.GPS_IFD] ? readIFD(dv, tiff, little, dv.getUint32(tiff + ifd0[TAG.GPS_IFD].off + 8, little)) : {};

  // position (best-effort)
  let lat = null, lon = null;
  if (gps[TAG.GPS_LAT] && gps[TAG.GPS_LON]) {
    lat = dms(r.rationals(gps[TAG.GPS_LAT].off, 3), r.ascii(gps[TAG.GPS_LAT_REF].off, gps[TAG.GPS_LAT_REF].count));
    lon = dms(r.rationals(gps[TAG.GPS_LON].off, 3), r.ascii(gps[TAG.GPS_LON_REF].off, gps[TAG.GPS_LON_REF].count));
  }

  // time — prefer GPS (true UTC), then DTO+offset, then bare DTO (assume UTC).
  if (gps[TAG.GPS_DATE] && gps[TAG.GPS_TIME]) {
    const d = r.ascii(gps[TAG.GPS_DATE].off, gps[TAG.GPS_DATE].count);            // "YYYY:MM:DD"
    const t = r.rationals(gps[TAG.GPS_TIME].off, 3);                              // [h,m,s] UTC
    const m = /(\d{4}):(\d{2}):(\d{2})/.exec(d);
    if (m) {
      const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], Math.floor(t[0]), Math.floor(t[1]), Math.floor(t[2]), Math.round((t[2] % 1) * 1000));
      if (!Number.isNaN(ms)) return { tMs: ms, timebase: 'gps', lat, lon };
    }
  }
  if (exif[TAG.DATETIME_ORIGINAL]) {
    const s = r.ascii(exif[TAG.DATETIME_ORIGINAL].off, exif[TAG.DATETIME_ORIGINAL].count);   // "YYYY:MM:DD HH:MM:SS"
    const m = /(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
    if (m) {
      const subSec = exif[TAG.SUBSEC_ORIGINAL] ? +('0.' + (r.ascii(exif[TAG.SUBSEC_ORIGINAL].off, exif[TAG.SUBSEC_ORIGINAL].count) || '0')) : 0;
      let offMin = null;
      if (exif[TAG.OFFSET_ORIGINAL]) {
        const o = /([+-])(\d{2}):(\d{2})/.exec(r.ascii(exif[TAG.OFFSET_ORIGINAL].off, exif[TAG.OFFSET_ORIGINAL].count));
        if (o) offMin = (o[1] === '-' ? -1 : 1) * (+o[2] * 60 + +o[3]);
      }
      let ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], Math.round(subSec * 1000));
      if (offMin != null) { ms -= offMin * 60000; return { tMs: ms, timebase: 'offset', lat, lon }; }
      return { tMs: ms, timebase: 'local', lat, lon };                            // no tz → treat as UTC, flag it
    }
  }
  return (lat != null) ? { tMs: null, timebase: null, lat, lon } : null;
}
