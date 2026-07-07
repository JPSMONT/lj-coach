// backtest.test.mjs — regatta backtest against REAL Bol d'Or 2026 TCF3 results + track ingest.
// Run:  node test/backtest.test.mjs   (from phase0-engine/)

import { parseHMS, backtest } from '../src/backtest.mjs';
import { parseGPX, parseKML, parseTrack, haversine, trackStats } from '../src/track-io.mjs';
import { detectStart, centerlineFn, raceStats } from '../src/track-analyze.mjs';

let pass = 0, fail = 0;
const near = (a, b, tol) => a != null && Math.abs(a - b) <= tol;
function ok(id, desc, cond) { console.log(`${cond ? 'PASS' : 'FAIL'}  ${id}  ${desc}`); cond ? pass++ : fail++; }

// ---- time parsing ----
ok('T1', 'HH:MM:SS → seconds', parseHMS('21:04:28') === 75868);
ok('T2', 'D:HH:MM:SS → seconds', parseHMS('1:01:20:30') === 91230);

// ---- REAL vector: Bol d'Or du Léman 2026, TCF3, from the official results PDF ----
// (rating = the boat's actual applied SRS TCF; elapsed = ARRIVÉE SNG Time; officialCorrected = Calc.)
const TCF3 = [
  { name: 'TALAN',        type: 'First 40.7',       tcf: 1.098, elapsedSec: parseHMS('21:04:28'), officialCorrectedSec: parseHMS('23:08:23'), officialRank: 1 },
  { name: 'Giachen Duos', type: 'Blu 26',           tcf: 1.059, elapsedSec: parseHMS('23:27:00'), officialCorrectedSec: parseHMS('1:00:50:01'), officialRank: 2, refTcf: 1.059 },
  { name: 'Tanoshii',     type: 'Esse 850 inboard', tcf: 1.097, elapsedSec: parseHMS('22:52:27'), officialCorrectedSec: parseHMS('1:01:05:35'), officialRank: 4 },
  { name: 'Hazel',        type: 'Blu 26',           tcf: 1.059, elapsedSec: parseHMS('23:54:41'), officialCorrectedSec: parseHMS('1:01:19:20'), officialRank: 5, refTcf: 1.059 },
  { name: 'Melges 24',    type: 'Melges 24',        tcf: 1.042, elapsedSec: parseHMS('1:00:31:46'), officialCorrectedSec: parseHMS('1:01:33:35'), officialRank: 9, refTcf: 1.045 },
  { name: 'Little Johnka',type: 'CYD 27',           tcf: 1.029, elapsedSec: parseHMS('1:01:20:30'), officialCorrectedSec: parseHMS('1:02:04:36'), officialRank: 15, refTcf: 1.029 },
];
const bt = backtest(TCF3, { systemId: 'SRS', ljName: 'Little Johnka' });

// (1) engine reproduces official corrected time (elapsed × TCF) to within rounding
{
  const worst = Math.max(...TCF3.map((e) => Math.abs(e.elapsedSec * e.tcf - e.officialCorrectedSec)));
  ok('BT1', 'recomputed corrected = official (≤2 s)', worst <= 2);
}
// (2) our recomputed ranking matches the official order
ok('BT2', 'reproduces official finishing order', bt.reproducesOfficialOrder === true);

// (3) decomposition matches the hand numbers (mass start → elapsed = boatspeed)
{
  const g = bt.decomp.find((d) => d.name === 'Giachen Duos');
  ok('BT3', 'LJ vs winning Blu 26: +8.1% on water, +5.0% corrected',
    near(g.elapsedGapPct, 8.1, 0.2) && near(g.correctedGapPct, 5.0, 0.2));
  const m = bt.decomp.find((d) => d.name === 'Melges 24');
  ok('BT4', 'LJ vs Melges 24: ~+3.3% water, ~+2.0% corrected',
    near(m.elapsedGapPct, 3.3, 0.2) && near(m.correctedGapPct, 2.0, 0.2));
}
// (4) the rating-data flag catches the Melges 24 race-TCF (1.042) vs our stored 1.045
{
  const flagged = bt.flags.map((f) => f.name);
  ok('BT5', 'flags Melges 24 race-TCF ≠ our data', flagged.includes('Melges 24') && !flagged.includes('Giachen Duos'));
}
// (5) LJ was beaten on BOATSPEED, not rating (every boat ahead was faster on the water)
{
  const ahead = bt.decomp.filter((d) => d.correctedGapPct > 0);  // boats that beat LJ
  ok('BT6', 'every boat that beat LJ was faster on the water', ahead.every((d) => d.elapsedGapPct > 0));
}

// ---- track ingest: synthetic GPX (two boats), known geometry ----
// Boat A: two fixes 60 s apart, ~0.1 nm (185.2 m) due north → ≈ 6.0 kn.
const gpx = `<?xml version="1.0"?><gpx><trk><name>Boat A</name><trkseg>
  <trkpt lat="46.200000" lon="6.150000"><time>2026-06-06T10:00:00Z</time></trkpt>
  <trkpt lat="46.201664" lon="6.150000"><time>2026-06-06T10:01:00Z</time></trkpt>
</trkseg></trk><trk><name>Boat B</name><trkseg>
  <trkpt lat="46.100000" lon="6.100000"><time>2026-06-06T10:00:00Z</time></trkpt>
  <trkpt lat="46.100000" lon="6.100000"><time>2026-06-06T10:01:00Z</time></trkpt>
</trkseg></trk></gpx>`;
{
  const tracks = parseGPX(gpx);
  ok('GX1', 'GPX → 2 boats parsed', tracks.length === 2 && tracks[0].name === 'Boat A' && tracks[0].points.length === 2);
  const s = trackStats(tracks[0]);
  ok('GX2', 'leg distance ≈ 0.1 nm', near(s.distance_nm, 0.1, 0.005));
  ok('GX3', 'speed ≈ 6.0 kn', near(s.avgSpeed_kn, 6.0, 0.2));
  ok('GX4', 'stationary boat ≈ 0 kn', near(trackStats(tracks[1]).avgSpeed_kn, 0, 0.01));
}
// ---- track ingest: synthetic KML gx:Track ----
const kml = `<kml><Document><Placemark><name>Rival</name><gx:Track>
  <when>2026-06-06T10:00:00Z</when><gx:coord>6.15 46.20 0</gx:coord>
  <when>2026-06-06T10:01:00Z</when><gx:coord>6.15 46.201664 0</gx:coord>
</gx:Track></Placemark></Document></kml>`;
{
  const t = parseKML(kml);
  ok('KM1', 'KML gx:Track → parsed with time+coord', t.length === 1 && t[0].points.length === 2 && near(t[0].points[1].lat, 46.201664, 1e-5));
  ok('KM2', 'parseTrack auto-detects KML', parseTrack(kml).length === 1);
  ok('KM3', 'KML speed ≈ 6.0 kn', near(trackStats(t[0]).avgSpeed_kn, 6.0, 0.2));
}
// haversine sanity: 1' of latitude ≈ 1 nm
ok('HV1', "1' latitude ≈ 1852 m", near(haversine({ lat: 46, lon: 6 }, { lat: 46 + 1 / 60, lon: 6 }), 1852, 5));

// ---- track-analyze: start detection, centerline, race-window trim + shore split ----
{
  // Synthetic boat: 30 min milling at the line (tiny moves), then a 60-min ~6 kn leg east.
  const t0 = Date.parse('2026-06-06T09:00:00Z');
  const pts = [];
  for (let i = 0; i <= 30; i++) pts.push({ t: t0 + i * 60000, lat: 46.20 + (i % 2) * 1e-4, lon: 6.15 }); // milling
  for (let i = 1; i <= 60; i++) pts.push({ t: t0 + (30 + i) * 60000, lat: 46.20, lon: 6.15 + i * 0.0024 }); // sail east ~6 kn
  const tk = { name: 'Synth', points: pts };
  const start = detectStart([tk]);
  ok('TA1', 'detectStart lands at the sailing onset (~09:30)', near(start, t0 + 30 * 60000, 120000));
  const st = raceStats(tk, { startMs: start, endMs: t0 + 90 * 60000, elapsedSec: 3600 });
  ok('TA2', 'trimmed leg ≈ 6 kn over the race window', st && near(st.sog_kn, 6.0, 0.4));
}
{
  // Shore split: two boats define the centerline; the test boat sails the NORTH side outbound.
  const mk = (dlat) => ({ name: 'x', points: [0,1,2,3,4].map((i) => ({ t: i * 60000, lat: 46.30 + dlat, lon: 6.20 + i * 0.02 })) });
  const center = centerlineFn([mk(0.02), mk(-0.02)]);          // centerline ≈ 46.30 across these lons
  const north = mk(0.05);                                        // clearly north of centerline
  const st = raceStats(north, { startMs: -1, endMs: 9e14, center });
  ok('TA3', 'shore split flags a north-shore boat (outbound > 50% N)', st && st.outboundPctNorth > 50);
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
