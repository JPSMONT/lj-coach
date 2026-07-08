// kwindoo-ingest.test.mjs — verify the Kwindoo GPX extractor on a real-structure fixture.
// Run:  node test/kwindoo-ingest.test.mjs   (from phase0-engine/)
// Fixture mirrors the exact shape of Joao's Zugersee/Rigi Kwindoo exports (phpGPX, metadata desc,
// "Tracked route for <skipper>", trkpt lat/lon + ele + time) — a short-course track used ONLY to
// prove the parser before Centomiglia/Garda, per feedback_short_vs_long_analysis.

import { parseKwindooGPX, ingestKwindooFleet, ljTrack } from '../src/kwindoo-ingest.mjs';

// build a Kwindoo-format GPX for one boat from a list of [lat,lon,ISO-time]
const gpx = (race, skipper, pts) => `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="phpGPX/1.3.0">
  <metadata>
    <desc>Kwindoo tracking - ${race} in ${race}</desc>
    <time>2026-05-02T08:06:25+00:00</time>
  </metadata>
  <trk>
    <name>Tracked route for ${skipper}</name>
    <src>Kwindoo - Tracking sailing differently</src>
    <type>RUN</type>
    <trkseg>
${pts.map(([la, lo, t]) => `      <trkpt lat="${la}" lon="${lo}"><ele>0</ele><time>${t}</time></trkpt>`).join('\n')}
    </trkseg>
  </trk>
</gpx>`;

// Boat A = Little Johnka; ~800 m over 5 min. Boat B = a rival, shorter track.
const lj = gpx('Rigi Anker Cup', 'Joao Monteiro', [
  [47.07018, 8.51146, '2024-08-31T13:30:00+00:00'],
  [47.07000, 8.51300, '2024-08-31T13:31:00+00:00'],
  [47.06950, 8.51600, '2024-08-31T13:33:00+00:00'],
  [47.06900, 8.51950, '2024-08-31T13:35:00+00:00'],
]);
const rival = gpx('Rigi Anker Cup', 'Evelyn Schilter', [
  [47.07018, 8.51146, '2024-08-31T13:30:00+00:00'],
  [47.07005, 8.51250, '2024-08-31T13:31:00+00:00'],
  [47.06980, 8.51400, '2024-08-31T13:33:00+00:00'],
]);

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) { pass++; } else { fail++; console.log(`  FAIL ${name} — got ${JSON.stringify(got)}`); } };

// --- single-boat parse: race + skipper cleanup, points + timestamps ---
const one = parseKwindooGPX(lj);
ok('race name cleaned', one.race === 'Rigi Anker Cup', one.race);
ok('one track', one.tracks.length === 1, one.tracks.length);
ok('skipper cleaned', one.tracks[0].skipper === 'Joao Monteiro', one.tracks[0].skipper);
ok('points parsed', one.tracks[0].points.length === 4, one.tracks[0].points.length);
ok('timestamps parsed', Number.isFinite(one.tracks[0].points[0].t), one.tracks[0].points[0].t);
ok('lat/lon parsed', one.tracks[0].points[0].lat === 47.07018 && one.tracks[0].points[0].lon === 8.51146, one.tracks[0].points[0]);

// --- fleet assembly + leaderboard by distance ---
const fleet = ingestKwindooFleet([
  { gpx: lj, sail: 'SUI 6116' },
  { gpx: rival, sail: 'Z 10' },
]);
ok('fleet race', fleet.race === 'Rigi Anker Cup', fleet.race);
ok('two boats', fleet.boats.length === 2, fleet.boats.length);
ok('boat carries sail no.', fleet.boats[0].sail === 'SUI 6116', fleet.boats[0].sail);
ok('per-boat stats computed', fleet.boats[0].stats.distance_nm > 0 && fleet.boats[0].stats.avgSpeed_kn > 0, fleet.boats[0].stats);
ok('leaderboard sorted by distance (LJ longest)', fleet.leaderboard[0].name === 'Tracked route for Joao Monteiro', fleet.leaderboard.map((x) => x.name));

// --- LJ picker feeds the Debrief pipeline ---
const t = ljTrack(fleet);
ok('ljTrack finds SUI 6116', t && t.points.length === 4, t && t.points.length);

// --- robustness: label override + boat with no fixes ---
const labelled = ingestKwindooFleet([{ gpx: rival, label: 'Rival X' }]);
ok('label overrides skipper', labelled.boats[0].skipper === 'Rival X', labelled.boats[0].skipper);

console.log(`\nkwindoo-ingest: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
