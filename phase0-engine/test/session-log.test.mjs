// session-log.test.mjs — YDWG-02 RAW stream → SessionLog → real weakness samples (with heel/trim).
// Run:  node test/session-log.test.mjs   (from phase0-engine/)

import { streamToSessionLog, sessionToPerf, weaknessWithTrim, SAMPLE_FIELDS } from '../src/session-log.mjs';
import { scenario } from '../src/n2k-sim.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = JSON.parse(readFileSync(join(root, 'data/boats.json'), 'utf8'));
const LJ = DATA.boats.find((b) => b.id === 'lj');
const GRID = DATA._meta.tws_grid;

let pass = 0, fail = 0;
const near = (a, b, tol) => a != null && Math.abs(a - b) <= tol;
function ok(id, desc, cond) { console.log(`${cond ? 'PASS' : 'FAIL'}  ${id}  ${desc}`); cond ? pass++ : fail++; }

// A scripted upwind sail in ~8 kt: STW 5.0, AWA 25°, AWS 12 → derived TWS≈7.8, TWA≈41 (beat).
// heel ~22°. Then three light-air fixes (AWS 3, STW 1.5 → TWS≈1.8) to exercise the sub-4kt guard.
const beat = (t) => ({ t, stw_kn: 5.0, heel_deg: 22, trim_deg: -2, aws_kn: 12, awa_deg: 25,
  cog_deg: 10, sog_kn: 4.8, heading_deg: 10, lat: 46.30, lon: 6.30 });
const light = (t) => ({ t, stw_kn: 1.5, heel_deg: 6, trim_deg: -1, aws_kn: 3, awa_deg: 25,
  cog_deg: 10, sog_kn: 1.4, heading_deg: 10, lat: 46.31, lon: 6.31 });
const states = [];
for (let i = 0; i <= 6; i++) states.push(beat(i));   // t=0..6 s  (beat)
for (let i = 7; i <= 9; i++) states.push(light(i));  // t=7..9 s  (light, sub-4kt)
const raw = scenario(states);
const DAY = Date.UTC(2026, 5, 6);                     // 2026-06-06 midnight UTC

const sess = streamToSessionLog(raw, { dateEpochMs: DAY, sampleMs: 1000 });

// --- SessionLog shape (Build Spec §2.5) ---
ok('S1', 'produces ~10 one-per-second samples', sess.samples.length >= 9 && sess.samples.length <= 11);
ok('S2', 'sample carries all §2.5 fields', SAMPLE_FIELDS.every((f) => f in sess.samples[0]) && 't' in sess.samples[0]);
ok('S3', 'timestamps are absolute epoch (anchored to the race date)', sess.samples[0].t >= DAY && sess.samples[0].t < DAY + 86400000);
ok('S4', 'data_quality green for measured STW / heel / wind', sess.data_quality.stw === 'green' && sess.data_quality.heel === 'green' && sess.data_quality.aws === 'green');

// --- measured true wind on a beat fix ---
const beatSample = sess.samples.find((s) => s.stw === 5 && s.tws > 6);
ok('W1', 'true wind derived from AWA/AWS/STW: TWS≈7.8', near(beatSample && beatSample.tws, 7.8, 0.3));
ok('W2', 'TWA≈41° (close-hauled)', near(beatSample && Math.abs(beatSample.twa), 41, 3));

// --- sessionToPerf uses STW (not SOG) as boatspeed ---
const perf = sessionToPerf(sess);
const pb = perf.find((p) => p.tws > 6);
ok('P1', 'boatspeed = measured STW (5.0), not SOG (4.8)', near(pb && pb.boatspeed, 5.0, 0.01));
ok('P2', 'heel & trim carried onto the perf sample', pb && near(pb.heel, 22, 0.5) && near(pb.trim, -2, 0.5));

// --- weaknessWithTrim: the cause-finder — a cell reports mean heel/trim alongside % of polar ---
const wm = weaknessWithTrim(LJ, perf, GRID, { minN: 3 });
const cell = wm.cells.find((c) => c.pos === 'beat' && c.band === '6–8');
ok('T1', 'beat/6–8 cell present with a % of polar', cell && cell.avgPct > 0);
ok('T2', 'cell reports mean heel (≈22°) — the trim/heel overlay', cell && near(cell.avgHeel, 22, 1));
ok('T3', 'cell reports mean trim (≈ -2°)', cell && near(cell.avgTrim, -2, 1));

// --- sub-4kt guard: the light fixes are scored by nobody (below the VPP floor) ---
ok('G1', 'light (sub-4kt) fixes excluded from the weakness map', wm.samplesUsed === cell.n && wm.samplesUsed <= 7);
ok('G2', 'but they DID survive into perf samples (raw kept)', perf.length > wm.samplesUsed);

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
