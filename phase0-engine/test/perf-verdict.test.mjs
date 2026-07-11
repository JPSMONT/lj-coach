// perf-verdict.test.mjs — auto fast/slow from boatspeed vs polar. Run: node test/perf-verdict.test.mjs
import { pctOfPolar, verdictFromPct } from '../src/perf-verdict.mjs';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  FAIL ${name} — got ${JSON.stringify(got)}`); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const geom = JSON.parse(readFileSync(new URL('../data/sail-lj-main.json', import.meta.url)));
// LJ polar at 12 kt: beat_vmg 4.41, run_vmg 5.93, reach90 7.09.

// --- beat: at polar (VMG = target) → ~100%, verdict fast ---
// beat target VMG 4.41 @12kt; sail at TWA 42° so STW = VMG/cos42 = 4.41/0.743 = 5.93 kn → measured VMG = 4.41 → 100%
let r = pctOfPolar({ tws: 12, twa: 42, boatspeedKn: 4.41 / Math.cos(42 * Math.PI / 180) }, geom);
ok('beat at polar → ~100%', r && near(r.pct, 1.0, 0.02), r);
ok('beat at polar → fast', verdictFromPct(r.pct) === 'fast', r && r.pct);

// --- beat slow: 8% under target → slow ---
r = pctOfPolar({ tws: 12, twa: 42, boatspeedKn: 0.92 * 4.41 / Math.cos(42 * Math.PI / 180) }, geom);
ok('beat 8% down → slow', verdictFromPct(r.pct) === 'slow', r && r.pct);

// --- reach 90°: STW vs reach target 7.09 @12kt ---
r = pctOfPolar({ tws: 12, twa: 90, boatspeedKn: 7.09 }, geom);
ok('reach at polar → ~100%', r && near(r.pct, 1.0, 0.02) && r.pos === '90', r);

// --- derives true wind from apparent + boatspeed when tws/twa missing ---
// pick AWS/AWA that yield ~12 kt TWS at ~42° TWA with BS 5.9: just check it returns a plausible pct
r = pctOfPolar({ aws: 16, awa: 28, boatspeedKn: 5.9 }, geom);
ok('derives TWS/TWA from apparent', r && r.tws > 6 && r.pct > 0, r);

// --- guards: below 6 kt, or missing boatspeed → null (no auto verdict) ---
ok('sub-6kt → null', pctOfPolar({ tws: 4, twa: 40, boatspeedKn: 3 }, geom) === null, null);
ok('no boatspeed → null', pctOfPolar({ tws: 12, twa: 40 }, geom) === null, null);
ok('verdict of null → blank', verdictFromPct(null) === '', null);
ok('ambiguous middle → blank', verdictFromPct(0.96) === '', null);

console.log(`\nperf-verdict: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
