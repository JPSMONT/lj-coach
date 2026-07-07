// n2k-decode.mjs — decode the YDWG-02 RAW/UDP stream into physical sailing values.
//
// PRIMARY SOURCES (verified 2026-07-05, do not guess byte layouts):
//   - YDWG-02 User Manual, firmware 1.71, Appendix E "Format of Messages in RAW Mode"
//     (yachtd.com/downloads/ydwg02.pdf). RAW line:
//         hh:mm:ss.ddd  D  msgid  b0..b7 <CR><LF>
//       D = 'R' (NMEA2000 -> app) or 'T' (app -> NMEA2000); msgid = 29-bit CAN id (hex);
//       1..8 data bytes (hex). Example: "17:33:21.141 R 09F80115 A0 7D E6 18 ..."
//       That id decodes to PGN 129025 (Position Rapid), src 21, prio 2, and its lat bytes
//       A0 7D E6 18 = 41.77586°N — used as test vectors.
//   - Airmar DST810 brochure PGN list: 127257 Attitude, 128259 Speed(STW), 128267 Water Depth,
//     128275 Distance Log, 130310/130311/130312/130316 water temperature. NOTE: the DST810 does
//     NOT emit leeway — leeway must be COMPUTED by the app (from heel/STW/heading), it is not a PGN.
//   - NMEA 2000 field layouts/scalings per the canboat PGN database (public de-facto reference);
//     each decoder is round-trip unit-tested against the simulator, and reconciled on-water vs the
//     Garmin displays before being trusted (per the Phase-1 plan).
//
// Data source on Little Johnka: DST810 -> attitude(heel/trim), STW, depth, water temp.
//                               Garmin  -> wind (130306), position (129025), COG/SOG (129026), heading (127250).

// ---- RAW line parsing --------------------------------------------------------
const RAW_RE = /^(\d{2}:\d{2}:\d{2}\.\d{3})\s+([RT])\s+([0-9A-Fa-f]{8})\s+(.+?)\s*$/;

export function parseRawLine(line) {
  if (typeof line !== 'string') return null;
  const m = line.match(RAW_RE);
  if (!m) return null;
  const [, time, dir, idHex, rest] = m;
  const parts = rest.trim().split(/\s+/);
  if (parts.length < 1 || parts.length > 8) return null;
  const data = parts.map((h) => parseInt(h, 16));
  if (data.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) return null;
  return { time, dir, canId: parseInt(idHex, 16) >>> 0, data };
}

// ---- CAN identifier -> PGN / source / priority (J1939 / NMEA 2000) -----------
export function decodeCanId(id) {
  id = id >>> 0;
  const priority = (id >> 26) & 0x7;
  const src = id & 0xff;
  const dp = (id >> 24) & 0x1;
  const pf = (id >> 16) & 0xff;
  const ps = (id >> 8) & 0xff;
  let pgn, dest = null;
  if (pf < 240) { pgn = (dp << 16) | (pf << 8); dest = ps; } // PDU1 (addressable)
  else { pgn = (dp << 16) | (pf << 8) | ps; }                // PDU2 (broadcast)
  return { priority, pgn, src, dest };
}

// ---- byte readers (little-endian) with NMEA2000 "data not available" sentinels
const u16 = (d, o) => (d[o] | (d[o + 1] << 8)) >>> 0;
const i16 = (d, o) => { const v = u16(d, o); return v & 0x8000 ? v - 0x10000 : v; };
const u24 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16)) >>> 0;
const u32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
const i32 = (d, o) => { const v = u32(d, o); return v > 0x7fffffff ? v - 0x100000000 : v; };
const naU16 = (v) => (v === 0xffff ? null : v);
const naU24 = (v) => (v === 0xffffff ? null : v);
const naU32 = (v) => (v === 0xffffffff ? null : v);
const naI16 = (v) => (v === 0x7fff ? null : v);

const RAD2DEG = 180 / Math.PI;
const MS2KN = 3600 / 1852;           // 1 m/s = 1.943844 kn
const K2C = (k) => k - 273.15;
const scale = (v, f) => (v == null ? null : v * f);

// ---- single-frame PGN decoders (return SI + sailing-friendly units) ----------
const DECODERS = {
  // Wind Data — Garmin. speed 0.01 m/s, angle 0.0001 rad, ref: 2=apparent,0=true(ground)
  130306(d) {
    const ws = naU16(u16(d, 1)), wa = naU16(u16(d, 3)), ref = d[5] & 0x07;
    return { name: 'windData',
      windSpeed_ms: scale(ws, 0.01), windSpeed_kn: scale(ws, 0.01 * MS2KN),
      windAngle_deg: scale(wa, 0.0001 * RAD2DEG), reference: ref };
  },
  // Speed, Water Referenced (STW) — DST810
  128259(d) {
    const sw = naU16(u16(d, 1));
    return { name: 'speedWaterReferenced', stw_ms: scale(sw, 0.01), stw_kn: scale(sw, 0.01 * MS2KN) };
  },
  // Water Depth (+ transducer offset) — DST810. depth 0.01 m, offset 0.001 m
  128267(d) {
    const depth = naU32(u32(d, 1)), off = naI16(i16(d, 5));
    return { name: 'waterDepth', depth_m: scale(depth, 0.01), offset_m: scale(off, 0.001) };
  },
  // Attitude — DST810. yaw/pitch/roll int16 0.0001 rad; roll = heel, pitch = trim
  127257(d) {
    const yaw = naI16(i16(d, 1)), pitch = naI16(i16(d, 3)), roll = naI16(i16(d, 5));
    return { name: 'attitude',
      yaw_deg: scale(yaw, 0.0001 * RAD2DEG),
      trim_deg: scale(pitch, 0.0001 * RAD2DEG),
      heel_deg: scale(roll, 0.0001 * RAD2DEG) };
  },
  // Temperature (water) — DST810. actual temp uint16 0.01 K
  130312(d) {
    const t = naU16(u16(d, 3));
    return { name: 'temperature', source: d[2], waterTemp_c: t == null ? null : K2C(t * 0.01) };
  },
  // Temperature, Extended Range (water) — DST810. temp uint24 0.001 K
  130316(d) {
    const t = naU24(u24(d, 3));
    return { name: 'temperatureExtended', source: d[2], waterTemp_c: t == null ? null : K2C(t * 0.001) };
  },
  // Position, Rapid Update — Garmin GPS. lat/lon int32 1e-7 deg
  129025(d) {
    const lat = i32(d, 0), lon = i32(d, 4);
    return { name: 'positionRapid',
      lat_deg: lat === 0x7fffffff ? null : lat * 1e-7,
      lon_deg: lon === 0x7fffffff ? null : lon * 1e-7 };
  },
  // COG & SOG, Rapid Update — Garmin GPS. COG 0.0001 rad, SOG 0.01 m/s
  129026(d) {
    const cog = naU16(u16(d, 2)), sog = naU16(u16(d, 4));
    return { name: 'cogSogRapid', cogRef: d[1] & 0x03,
      cog_deg: scale(cog, 0.0001 * RAD2DEG), sog_kn: scale(sog, 0.01 * MS2KN) };
  },
  // Vessel Heading — Garmin (if a heading source is present). heading uint16 0.0001 rad
  127250(d) {
    const h = naU16(u16(d, 1));
    return { name: 'vesselHeading', headingRef: d[7] & 0x03, heading_deg: scale(h, 0.0001 * RAD2DEG) };
  },
};

// PGNs known to be fast-packet on this bus (payload > 8 bytes → multi-frame). We reassemble
// them but don't yet decode fields (not needed for tactics); listed so the parser recognises them.
export const FAST_PACKET_PGNS = new Set([128275 /* Distance Log */, 129029 /* GNSS Position */]);

export function decodeMessage(canId, data) {
  const { pgn, src, priority, dest } = decodeCanId(canId);
  const dec = DECODERS[pgn];
  const fields = dec ? dec(data) : { name: FAST_PACKET_PGNS.has(pgn) ? 'fastPacket' : 'unsupported' };
  return { pgn, src, dest, priority, ...fields };
}

// Decode one RAW line to a message (inbound 'R' only). Returns null for malformed / outbound lines.
export function decodeRawLine(line) {
  const p = parseRawLine(line);
  if (!p || p.dir !== 'R') return null;
  return { time: p.time, ...decodeMessage(p.canId, p.data) };
}

// ---- Fast-packet reassembly (general utility) --------------------------------
// NMEA 2000 fast-packet: first frame byte0 = (seq<<5)|0, byte1 = total byte count, then 6 data
// bytes; subsequent frames byte0 = (seq<<5)|frameIndex, then 7 data bytes. Keyed by (src,pgn,seq).
export class FastPacketAssembler {
  constructor() { this.partial = new Map(); }
  // Feed a decoded CAN frame; returns the completed payload (number[]) when the last frame arrives.
  add(src, pgn, data) {
    const seq = (data[0] >> 5) & 0x7;
    const frame = data[0] & 0x1f;
    const key = `${src}:${pgn}:${seq}`;
    if (frame === 0) {
      const total = data[1];
      this.partial.set(key, { total, bytes: data.slice(2), received: data.length - 2 });
    } else {
      const st = this.partial.get(key);
      if (!st) return null;                 // missed the first frame
      st.bytes.push(...data.slice(1));
      st.received += data.length - 1;
    }
    const st = this.partial.get(key);
    if (st && st.bytes.length >= st.total) {
      this.partial.delete(key);
      return st.bytes.slice(0, st.total);
    }
    return null;
  }
}
