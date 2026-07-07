// n2k.test.mjs — acceptance vectors for the YDWG-02 RAW decoder + simulator.
// Run:  node test/n2k.test.mjs   (from phase0-engine/)

import {
  parseRawLine, decodeCanId, decodeRawLine, decodeMessage, FastPacketAssembler,
} from '../src/n2k-decode.mjs';
import { ENC, frameLine, emitState, scenario, sampleSail, SRC } from '../src/n2k-sim.mjs';

let pass = 0, fail = 0;
const near = (a, b, tol) => a != null && Math.abs(a - b) <= tol;
function ok(id, desc, cond) { console.log(`${cond ? 'PASS' : 'FAIL'}  ${id}  ${desc}`); cond ? pass++ : fail++; }

// ---- CAN-id decode against the YDWG-02 manual's own example lines -------------
// "17:33:21.141 R 09F80115 ..." -> PGN 129025 (Position Rapid), src 21, prio 2.
{
  const c = decodeCanId(0x09f80115);
  ok('ID1', 'manual ex 09F80115 → PGN 129025 / src 21 / prio 2', c.pgn === 129025 && c.src === 21 && c.priority === 2);
}
// "19F51323" -> PGN 128275 (Distance Log), src 35, prio 6.
{
  const c = decodeCanId(0x19f51323);
  ok('ID2', 'manual ex 19F51323 → PGN 128275 / src 35 / prio 6', c.pgn === 128275 && c.src === 35 && c.priority === 6);
}

// ---- RAW line parsing --------------------------------------------------------
{
  const p = parseRawLine('17:33:21.141 R 09F80115 A0 7D E6 18 00 00 00 00');
  ok('RAW1', 'parse manual example line', p && p.dir === 'R' && p.canId === 0x09f80115 && p.data.length === 8 && p.data[0] === 0xa0);
  ok('RAW2', 'reject malformed line', parseRawLine('not a frame') === null);
  ok('RAW3', 'ignore outbound (T) via decodeRawLine', decodeRawLine('17:33:21.141 T 09F80115 A0 7D E6 18 00 00 00 00') === null);
}
// Latitude from the manual's real bytes A0 7D E6 18 = 0x18E67DA0 = 417758624 * 1e-7 = 41.7758624°
{
  const m = decodeRawLine('17:33:21.141 R 09F80115 A0 7D E6 18 00 00 00 00');
  ok('POS', 'manual position bytes → lat 41.77586°', m && m.pgn === 129025 && near(m.lat_deg, 41.7758624, 1e-4));
}

// ---- round-trip: encode a physical value → RAW → decode → recover -------------
function roundtrip(id, desc, pgn, src, data, field, expect, tol) {
  const line = frameLine(pgn, src, data, { time: '01:02:03.004' });
  const m = decodeRawLine(line);
  ok(id, desc, m && m.pgn === pgn && near(m[field], expect, tol));
}
roundtrip('RT-wind-s', 'wind 16.0 kn round-trips', 130306, SRC.GARMIN, ENC.wind130306(16.0, 28.0), 'windSpeed_kn', 16.0, 0.02);
roundtrip('RT-wind-a', 'wind angle 28.0° round-trips', 130306, SRC.GARMIN, ENC.wind130306(16.0, 28.0), 'windAngle_deg', 28.0, 0.02);
roundtrip('RT-stw',   'STW 6.20 kn round-trips',       128259, SRC.DST810, ENC.speed128259(6.20), 'stw_kn', 6.20, 0.02);
roundtrip('RT-heel',  'heel 18.0° round-trips',        127257, SRC.DST810, ENC.attitude127257(18.0, -2.0), 'heel_deg', 18.0, 0.02);
roundtrip('RT-trim',  'trim -2.0° round-trips',        127257, SRC.DST810, ENC.attitude127257(18.0, -2.0), 'trim_deg', -2.0, 0.02);
roundtrip('RT-depth', 'depth 12.50 m round-trips',     128267, SRC.DST810, ENC.depth128267(12.50), 'depth_m', 12.50, 0.01);
roundtrip('RT-temp',  'water temp 19.5°C round-trips', 130312, SRC.DST810, ENC.temp130312(19.5), 'waterTemp_c', 19.5, 0.02);
roundtrip('RT-cog',   'COG 90.0° round-trips',         129026, SRC.GARMIN, ENC.cogSog129026(90.0, 6.0), 'cog_deg', 90.0, 0.02);
roundtrip('RT-sog',   'SOG 6.00 kn round-trips',       129026, SRC.GARMIN, ENC.cogSog129026(90.0, 6.0), 'sog_kn', 6.00, 0.02);
roundtrip('RT-hdg',   'heading 185.0° round-trips',    127250, SRC.GARMIN, ENC.heading127250(185.0), 'heading_deg', 185.0, 0.02);

// ---- "data not available" is decoded as null, not a bogus number -------------
{
  const na = [0xff, 0xff, 0xff, 0xff, 0xff, 0x02, 0xff, 0xff];    // wind: speed & angle = 0xFFFF
  const m = decodeMessage(0x09fd0215, na);                          // PGN 130306, some src
  ok('NA', 'wind 0xFFFF → null (not a fake value)', m.pgn === 130306 && m.windSpeed_kn === null && m.windAngle_deg === null);
}

// ---- end-to-end: simulate a sail → decode the stream → sane values -----------
{
  const lines = scenario(sampleSail());
  const msgs = lines.map(decodeRawLine).filter(Boolean);
  const kinds = new Set(msgs.map((m) => m.name));
  const anyHeel = msgs.find((m) => m.name === 'attitude' && m.heel_deg > 5 && m.heel_deg < 30);
  const anyWind = msgs.find((m) => m.name === 'windData' && m.windSpeed_kn > 8 && m.windSpeed_kn < 25);
  ok('SIM1', 'simulated sail decodes to all expected message kinds',
    kinds.has('windData') && kinds.has('speedWaterReferenced') && kinds.has('attitude') && kinds.has('positionRapid') && kinds.has('cogSogRapid'));
  ok('SIM2', 'simulated heel & wind land in sane ranges', !!anyHeel && !!anyWind);
}

// ---- fast-packet reassembly (general utility) --------------------------------
{
  // Build a 10-byte payload split across 2 frames: frame0 = seq0|idx0, len=10, 6 bytes; frame1 = 7 bytes.
  const payload = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  const f0 = [0x00, payload.length, ...payload.slice(0, 6)];      // (seq<<5)|0
  const f1 = [0x01, ...payload.slice(6)];                          // (seq<<5)|1
  const fp = new FastPacketAssembler();
  const r0 = fp.add(35, 128275, f0);
  const r1 = fp.add(35, 128275, f1);
  ok('FP1', 'fast-packet: incomplete after first frame', r0 === null);
  ok('FP2', 'fast-packet: reassembles full payload on last frame', JSON.stringify(r1) === JSON.stringify(payload));
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
