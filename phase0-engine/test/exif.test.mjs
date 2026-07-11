// exif.test.mjs — parse EXIF time+GPS from synthetic JPEG/TIFF buffers. Run: node test/exif.test.mjs
import { parseExif } from '../src/exif.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  FAIL ${name} — got ${JSON.stringify(got)}`); } };

// ---- minimal big-endian TIFF/EXIF builder (enough for the tags parseExif reads) ----
// ifdDefs: ordered array of entry-lists. entry = {tag,type,count, inline?, ifdRef?, ascii?, rationals?}
function buildTIFF(ifdDefs) {
  const ifdSize = (def) => 2 + def.length * 12 + 4;
  const ifdOff = []; let cur = 8;
  for (const def of ifdDefs) { ifdOff.push(cur); cur += ifdSize(def); }
  // assign out-of-line pool offsets
  const pool = []; let poolCur = cur;
  const encAscii = (s, count) => { const b = []; for (let i = 0; i < count; i++) b.push(i < s.length ? s.charCodeAt(i) : 0); if (b.length % 2) b.push(0); return b; };
  const encRats = (rs) => { const b = []; for (const [n, d] of rs) { b.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, (d >>> 24) & 255, (d >>> 16) & 255, (d >>> 8) & 255, d & 255); } return b; };
  for (const def of ifdDefs) for (const e of def) {
    if (e.ifdRef != null) { e._val = ifdOff[e.ifdRef]; continue; }
    if (e.rationals) { e._off = poolCur; const b = encRats(e.rationals); pool.push([poolCur, b]); poolCur += b.length; e.count = e.rationals.length; continue; }
    if (e.ascii != null) {
      const cnt = e.count != null ? e.count : e.ascii.length + 1;
      if (cnt <= 4) { const b = encAscii(e.ascii, cnt); e._inlineBytes = b.slice(0, 4); while (e._inlineBytes.length < 4) e._inlineBytes.push(0); e.count = cnt; }
      else { e._off = poolCur; const b = encAscii(e.ascii, cnt); pool.push([poolCur, b]); poolCur += b.length; e.count = cnt; }
      continue;
    }
    e._val = e.inline; // SHORT/LONG single
  }
  const total = poolCur;
  const u8 = new Uint8Array(total); const dv = new DataView(u8.buffer);
  dv.setUint16(0, 0x4d4d, false); dv.setUint16(2, 0x002a, false); dv.setUint32(4, 8, false);   // "MM", 42, IFD0@8
  ifdDefs.forEach((def, di) => {
    let o = ifdOff[di]; dv.setUint16(o, def.length, false); o += 2;
    for (const e of def) {
      dv.setUint16(o, e.tag, false); dv.setUint16(o + 2, e.type, false); dv.setUint32(o + 4, e.count, false);
      if (e._inlineBytes) { for (let i = 0; i < 4; i++) dv.setUint8(o + 8 + i, e._inlineBytes[i]); }
      else if (e._off != null) dv.setUint32(o + 8, e._off, false);
      else dv.setUint32(o + 8, e._val >>> 0, false);
      o += 12;
    }
    dv.setUint32(o, 0, false);
  });
  for (const [off, b] of pool) for (let i = 0; i < b.length; i++) dv.setUint8(off + i, b[i]);
  return u8;
}
const wrapJpeg = (tiff) => { const len = 2 + 6 + tiff.length; const head = [0xff, 0xd8, 0xff, 0xe1, (len >> 8) & 255, len & 255, 0x45, 0x78, 0x69, 0x66, 0, 0]; return Uint8Array.from([...head, ...tiff, 0xff, 0xd9]); };

const T = { ASCII: 2, LONG: 4, RATIONAL: 5 };

// --- case 1: GPS date+time (true UTC) + position, JPEG-wrapped ---
let tiff = buildTIFF([
  [ { tag: 0x8769, type: T.LONG, count: 1, ifdRef: 1 }, { tag: 0x8825, type: T.LONG, count: 1, ifdRef: 2 } ],
  [ { tag: 0x9003, type: T.ASCII, ascii: '2026:06:06 12:34:56' } ],                       // DTO (should be ignored — GPS wins)
  [ { tag: 0x0001, type: T.ASCII, ascii: 'N', count: 2 }, { tag: 0x0002, type: T.RATIONAL, rationals: [[46, 1], [27, 1], [0, 1]] },
    { tag: 0x0003, type: T.ASCII, ascii: 'E', count: 2 }, { tag: 0x0004, type: T.RATIONAL, rationals: [[6, 1], [30, 1], [0, 1]] },
    { tag: 0x0007, type: T.RATIONAL, rationals: [[10, 1], [34, 1], [56, 1]] },            // 10:34:56 UTC
    { tag: 0x001d, type: T.ASCII, ascii: '2026:06:06' } ],
]);
let r = parseExif(wrapJpeg(tiff));
ok('GPS: timebase gps', r && r.timebase === 'gps', r);
ok('GPS: UTC epoch correct', r && r.tMs === Date.UTC(2026, 5, 6, 10, 34, 56), r && r.tMs);
ok('GPS: lat ~46.45', r && Math.abs(r.lat - 46.45) < 1e-3, r && r.lat);
ok('GPS: lon ~6.5', r && Math.abs(r.lon - 6.5) < 1e-3, r && r.lon);

// --- case 2: DateTimeOriginal + OffsetTimeOriginal (true UTC via offset), bare TIFF ---
tiff = buildTIFF([
  [ { tag: 0x8769, type: T.LONG, count: 1, ifdRef: 1 } ],
  [ { tag: 0x9003, type: T.ASCII, ascii: '2026:06:06 14:34:56' }, { tag: 0x9011, type: T.ASCII, ascii: '+02:00' } ],
]);
r = parseExif(tiff);
ok('offset: timebase offset', r && r.timebase === 'offset', r);
ok('offset: 14:34+02:00 → 12:34 UTC', r && r.tMs === Date.UTC(2026, 5, 6, 12, 34, 56), r && r.tMs);
ok('offset: no GPS → lat null', r && r.lat == null, r);

// --- case 3: bare DateTimeOriginal, no offset → 'local' (treated as UTC, flagged) ---
tiff = buildTIFF([
  [ { tag: 0x8769, type: T.LONG, count: 1, ifdRef: 1 } ],
  [ { tag: 0x9003, type: T.ASCII, ascii: '2026:06:06 14:34:56' } ],
]);
r = parseExif(tiff);
ok('local: timebase local', r && r.timebase === 'local', r);
ok('local: naive UTC epoch', r && r.tMs === Date.UTC(2026, 5, 6, 14, 34, 56), r && r.tMs);

// --- case 4: no EXIF at all → null ---
ok('no exif → null', parseExif(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])) === null, null);
ok('garbage → null', parseExif(Uint8Array.from([1, 2, 3, 4])) === null, null);

// --- case 5: little-endian ("II") still parses (flip builder? just sanity that MM path is used) ---
ok('returns object shape', r && 'tMs' in r && 'timebase' in r && 'lat' in r, r);

console.log(`\nexif: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
