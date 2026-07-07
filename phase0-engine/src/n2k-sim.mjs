// n2k-sim.mjs — synthetic YDWG-02 RAW frame generator (no hardware required).
//
// Encodes physical sailing values back into NMEA 2000 single-frame PGNs and YDWG-02 RAW lines
// (Appendix E format), so the whole ingestion pipeline can be developed and tested before the
// gateway is installed. Encoders are the exact inverse of src/n2k-decode.mjs and are round-trip
// unit-tested against it. Byte layouts/scalings: see n2k-decode.mjs source notes.

const RAD = Math.PI / 180;
const KN2MS = 1852 / 3600;           // 1 kn = 0.514444 m/s
const C2K = (c) => c + 273.15;

// ---- CAN id assembly (all our PGNs are PDU2 / broadcast, PF >= 240) ----------
export function encodeCanId({ priority = 6, pgn, src }) {
  const dp = (pgn >> 16) & 0x1;
  const pf = (pgn >> 8) & 0xff;
  const ps = pgn & 0xff;
  return (((priority & 0x7) << 26) | (dp << 24) | (pf << 16) | (ps << 8) | (src & 0xff)) >>> 0;
}

// ---- little-endian writers ---------------------------------------------------
const wU16 = (a, o, v) => { v = Math.round(v) & 0xffff; a[o] = v & 0xff; a[o + 1] = (v >> 8) & 0xff; };
const wI16 = (a, o, v) => wU16(a, o, v < 0 ? v + 0x10000 : v);
const wU24 = (a, o, v) => { v = Math.round(v) >>> 0; a[o] = v & 0xff; a[o + 1] = (v >> 8) & 0xff; a[o + 2] = (v >> 16) & 0xff; };
const wU32 = (a, o, v) => { v = Math.round(v) >>> 0; a[o] = v & 0xff; a[o + 1] = (v >> 8) & 0xff; a[o + 2] = (v >> 16) & 0xff; a[o + 3] = (v >> 24) & 0xff; };
const wI32 = (a, o, v) => wU32(a, o, v < 0 ? v + 0x100000000 : v);
const fill = (n) => new Array(n).fill(0xff);

// ---- per-PGN encoders (physical -> data bytes) -------------------------------
// Each mirrors a decoder in n2k-decode.mjs. Missing values are left as 0xFF (not-available).
export const ENC = {
  wind130306(aws_kn, awa_deg, ref = 2, sid = 0xff) {
    const d = fill(8); d[0] = sid;
    wU16(d, 1, (aws_kn * KN2MS) / 0.01);
    wU16(d, 3, (awa_deg * RAD) / 0.0001);
    d[5] = ref & 0x07;
    return d;
  },
  speed128259(stw_kn, sid = 0xff) {
    const d = fill(8); d[0] = sid; wU16(d, 1, (stw_kn * KN2MS) / 0.01); return d;
  },
  depth128267(depth_m, offset_m = 0, sid = 0xff) {
    const d = fill(8); d[0] = sid; wU32(d, 1, depth_m / 0.01); wI16(d, 5, offset_m / 0.001); return d;
  },
  attitude127257(heel_deg, trim_deg = 0, sid = 0xff) {
    const d = fill(7); d[0] = sid; wI16(d, 1, 0x7fff); wI16(d, 3, (trim_deg * RAD) / 0.0001); wI16(d, 5, (heel_deg * RAD) / 0.0001); return d;
  },
  temp130312(waterTemp_c, source = 0, instance = 0, sid = 0xff) {
    const d = fill(8); d[0] = sid; d[1] = instance; d[2] = source; wU16(d, 3, C2K(waterTemp_c) / 0.01); return d;
  },
  position129025(lat_deg, lon_deg) {
    const d = fill(8); wI32(d, 0, lat_deg / 1e-7); wI32(d, 4, lon_deg / 1e-7); return d;
  },
  cogSog129026(cog_deg, sog_kn, ref = 0, sid = 0xff) {
    const d = fill(8); d[0] = sid; d[1] = ref & 0x03; wU16(d, 2, (cog_deg * RAD) / 0.0001); wU16(d, 4, (sog_kn * KN2MS) / 0.01); return d;
  },
  heading127250(heading_deg, ref = 0, sid = 0xff) {
    const d = fill(8); d[0] = sid; wU16(d, 1, (heading_deg * RAD) / 0.0001); d[7] = ref & 0x03; return d;
  },
};

// ---- RAW line assembly -------------------------------------------------------
const PRIO = { 130306: 2, 128259: 2, 128267: 3, 127257: 2, 130312: 5, 129025: 2, 129026: 2, 127250: 2 };
const hh = (n) => String(n).padStart(2, '0');
export function fmtTime(sec) {
  const ms = Math.round((sec % 1) * 1000);
  const s = Math.floor(sec) % 60, m = Math.floor(sec / 60) % 60, h = Math.floor(sec / 3600) % 24;
  return `${hh(h)}:${hh(m)}:${hh(s)}.${String(ms).padStart(3, '0')}`;
}
export function frameLine(pgn, src, data, { time = '00:00:00.000', priority = PRIO[pgn] ?? 6 } = {}) {
  const id = encodeCanId({ priority, pgn, src });
  const idHex = id.toString(16).toUpperCase().padStart(8, '0');
  const bytes = data.map((b) => (b & 0xff).toString(16).toUpperCase().padStart(2, '0')).join(' ');
  return `${time} R ${idHex} ${bytes}`;
}

// Source addresses on Little Johnka's bus (arbitrary but consistent; Garmin GPS matches the
// manual example's src 21). DST810 = 35, Garmin = 21.
export const SRC = { DST810: 35, GARMIN: 21 };

// Emit all RAW lines implied by one boat-state snapshot.
export function emitState(st, { time = '00:00:00.000' } = {}) {
  const L = [], d = SRC.DST810, g = SRC.GARMIN;
  if (st.stw_kn != null)   L.push(frameLine(128259, d, ENC.speed128259(st.stw_kn, 1), { time }));
  if (st.heel_deg != null) L.push(frameLine(127257, d, ENC.attitude127257(st.heel_deg, st.trim_deg ?? 0, 1), { time }));
  if (st.depth_m != null)  L.push(frameLine(128267, d, ENC.depth128267(st.depth_m, 0, 1), { time }));
  if (st.watertemp_c != null) L.push(frameLine(130312, d, ENC.temp130312(st.watertemp_c, 0, 0, 1), { time }));
  if (st.aws_kn != null && st.awa_deg != null) L.push(frameLine(130306, g, ENC.wind130306(st.aws_kn, st.awa_deg, 2, 1), { time }));
  if (st.lat != null && st.lon != null) L.push(frameLine(129025, g, ENC.position129025(st.lat, st.lon), { time }));
  if (st.cog_deg != null && st.sog_kn != null) L.push(frameLine(129026, g, ENC.cogSog129026(st.cog_deg, st.sog_kn, 0, 1), { time }));
  if (st.heading_deg != null) L.push(frameLine(127250, g, ENC.heading127250(st.heading_deg, 0, 1), { time }));
  return L;
}

// Turn a time series of snapshots [{t, ...state}] into a RAW-line stream.
export function scenario(states) {
  const out = [];
  for (const s of states) out.push(...emitState(s, { time: fmtTime(s.t ?? 0) }));
  return out;
}

// A short plausible "sail": close-hauled in ~12 kt building, then bearing away. For demos/tests.
export function sampleSail() {
  const states = [];
  for (let i = 0; i < 6; i++) {
    const t = i * 1.0;
    const upwind = i < 3;
    states.push({
      t,
      stw_kn: upwind ? 6.2 + i * 0.1 : 7.4 + (i - 3) * 0.2,
      heel_deg: upwind ? 18 + i : 12 - (i - 3),
      awa_deg: upwind ? 28 : 135,
      aws_kn: upwind ? 16 + i : 12,
      depth_m: 40 - i,
      watertemp_c: 19.5,
      cog_deg: upwind ? 40 : 190,
      sog_kn: upwind ? 6.0 + i * 0.1 : 7.2,
      heading_deg: upwind ? 45 : 185,
      lat: 47.10 + i * 0.001,
      lon: 8.48 + i * 0.001,
    });
  }
  return states;
}
