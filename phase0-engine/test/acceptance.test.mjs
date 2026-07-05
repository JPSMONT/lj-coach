// acceptance.test.mjs — runnable acceptance vectors for the corrected-time engine.
// Run:  node test/acceptance.test.mjs   (from phase0-engine/)
//
// Expected values are hand-computed from RAW inputs (GPH/YS/TCF), independently of the win-map's
// stored margins, then cross-checked to agree with the published win-map. Tolerance ±0.2 pp.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { legMargin, courseMargin, confidence, compareAt, interp } from '../src/engine.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, '../data/boats.json'), 'utf8'));
const B = Object.fromEntries(data.boats.map((b) => [b.id, b]));
const LJ = B.lj;

let pass = 0, fail = 0;
const near = (a, b, tol = 0.2) => Math.abs(a - b) <= tol;
function check(id, desc, got, expect) {
  const ok = typeof expect === 'number'
    ? (got && got.status === 'ok' && near(got.pct, expect))
    : (got && got.status === expect) || got === expect;
  const shown = (got && got.status === 'ok') ? `${got.pct >= 0 ? '+' : ''}${got.pct.toFixed(2)}% [${got.tier}]`
              : (got && got.status) ? got.status : String(got);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${desc}  →  got ${shown}  (expect ${typeof expect === 'number' ? (expect >= 0 ? '+' : '') + expect + '%' : expect})`);
  ok ? pass++ : fail++;
}

// ---- Rating-direction vectors (equal speed isolates the rating; guards the §5 inversion) ----
// V2: Esse 850 is rated FASTER than LJ (GPH 609.3 < 660.2) → at equal speed LJ WINS (+).  660.2/609.3-1
check('V2', 'LJ vs Esse 850, equal speed, ORC', legMargin(LJ, B.esse850, { vLJ: 1, vRival: 1, systemId: 'ORC' }), +8.4);
// Direction check the other way: Surprise is rated SLOWER than LJ (686.1 > 660.2) → LJ LOSES (-).
check('Vd', 'LJ vs Surprise, equal speed, ORC', legMargin(LJ, B.surprise, { vLJ: 1, vRival: 1, systemId: 'ORC' }), -3.8);
// V7: Yardstick direction (94/82 - 1).
check('V7', 'LJ vs Melges 32, equal speed, Yardstick', legMargin(LJ, B.melges32, { vLJ: 1, vRival: 1, systemId: 'YARDSTICK' }), +14.6);
// V8: SRS direction (1.209/1.029 - 1).
check('V8', 'LJ vs Melges 32, equal speed, SRS', legMargin(LJ, B.melges32, { vLJ: 1, vRival: 1, systemId: 'SRS' }), +17.5);

// ---- Guard vectors ----
// V10: below the VPP floor → no synthetic number.
check('V10', 'sub-4 kt guard (TWS 3)', legMargin(LJ, B.esse850, { vLJ: 1, vRival: 1, systemId: 'ORC', tws: 3 }), 'outside_vpp');
// V11: ORC requested but the rival has no ORC rating (Lüthi 990) → cannot fabricate.
check('V11', 'no ORC polar (Lüthi 990, ORC)', legMargin(LJ, B.luthi990, { vLJ: 1, vRival: 1, systemId: 'ORC' }), 'no_orc_polar');
// Missing speed for a leg → no fabricated margin.
check('Vs', 'missing speed', legMargin(LJ, B.esse850, { vLJ: 4, vRival: 0, systemId: 'ORC' }), 'no_speed');
// NaN TWS (garbled sensor) must be refused, not read as "above the floor" (independent-audit fix).
check('Vn', 'NaN TWS guard', legMargin(LJ, B.esse850, { vLJ: 1, vRival: 1, systemId: 'ORC', tws: NaN }), 'outside_vpp');

// ---- Course aggregation (summed leg TIMES, not averaged margins) ----
// Two boats, EQUAL GPH (rating factor = 1), so this isolates the aggregation.
// Legs: (10 nm, LJ 5 / rival 4) and (10 nm, LJ 2 / rival 2.1).
// elapsedLJ = 10/5 + 10/2 = 7.0 ; elapsedRival = 10/4 + 10/2.1 = 7.2619 ; margin = 7.2619/7 - 1 = +3.74%
// (WRONG margin-averaging would give (+25% + -4.76%)/2 = +10.1% — this vector distinguishes them.)
const cloneA = { id: 'a', name: 'A', rating_basis: 'GPH', cert_vintage: '2021', comparability_flag: 'core', ratings: { gph: 660.2 } };
const cloneB = { id: 'b', name: 'B', rating_basis: 'GPH', cert_vintage: '2021', comparability_flag: 'core', ratings: { gph: 660.2 } };
check('Vc', 'course = summed leg times (not avg margins)', courseMargin(cloneA, cloneB, {
  legs: [ { distanceNm: 10, speedLJ: 5, speedRival: 4 }, { distanceNm: 10, speedLJ: 2, speedRival: 2.1 } ],
  systemId: 'ORC', courseType: 'windward_leeward',
}), +3.74);

// ---- Beat-VMG speed vectors (PRIMARY cert speeds; expected = win-map beat margins) ----
// These verify the engine on real polar speeds, non-circularly: rival beat VMG comes straight from
// each ORC certificate, LJ beat VMG from its 2020 certificate. If they reproduce the (Fable-audited)
// win-map, the win-map, the certs, and the engine all agree.
const TWS = data._meta.tws_grid;                 // [6,8,10,12,14,16,20]
const iOf = (w) => TWS.indexOf(w);
function beatVec(id, rivalId, w, expect) {
  const i = iOf(w);
  const vLJ = LJ.polar.beat_vmg[i];
  const vR = B[rivalId].polar?.beat_vmg?.[i];
  const r = legMargin(LJ, B[rivalId], { vLJ, vRival: vR, systemId: 'ORC', tws: w, courseType: 'windward_leeward' });
  check(id, `LJ vs ${B[rivalId].name}, ${w}kt beat`, r, expect);
}
beatVec('V1',  'j70',      6,  +13.4);   // headline: (3.51/3.04)*(660.2/672.0)-1
beatVec('V3',  'surprise', 12, -7.3);    // loss case
beatVec('V1b', 'esse850',  6,  +2.0);    // the boat to beat, light air
beatVec('V1c', 'melges24', 6,  +11.1);   // planing boat, light air
beatVec('V1d', 'ufo22',    14, +5.1);    // the "out-points at every wind" boat

// ---- Run-VMG vector (primary cert run speeds; expected = win-map run margin) ----
function runVec(id, rivalId, w, expect) {
  const i = iOf(w);
  const r = legMargin(LJ, B[rivalId], { vLJ: LJ.polar.run_vmg[i], vRival: B[rivalId].polar.run_vmg[i], systemId: 'ORC', tws: w, courseType: 'windward_leeward' });
  check(id, `LJ vs ${B[rivalId].name}, ${w}kt run`, r, expect);
}
runVec('V4', 'melges24', 20, -23.9);     // planing-run collapse (win-map −23.9)

// ---- Whole-course vectors (summed leg times) — reproduce the STRATEGY course tables ----
function wlCourse(id, rivalId, w, expect) {
  const i = iOf(w);
  const legs = [
    { distanceNm: 1, speedLJ: LJ.polar.beat_vmg[i], speedRival: B[rivalId].polar.beat_vmg[i] },
    { distanceNm: 1, speedLJ: LJ.polar.run_vmg[i],  speedRival: B[rivalId].polar.run_vmg[i] },
  ];
  check(id, `W/L course @${w}kt vs ${B[rivalId].name}`, courseMargin(LJ, B[rivalId], { legs, systemId: 'ORC', courseType: 'windward_leeward', tws: w }), expect);
}
wlCourse('V5', 'j70', 10, +1.2);         // strategy W/L table +1.2

function reachCourse(id, rivalId, w, angles, expect) {
  const i = iOf(w);
  const legs = angles.map((a) => ({ distanceNm: 1, speedLJ: LJ.polar.reach[a][i], speedRival: B[rivalId].polar.reach[a][i] }));
  check(id, `reaching course @${w}kt vs ${B[rivalId].name}`, courseMargin(LJ, B[rivalId], { legs, systemId: 'ORC', courseType: 'reaching', tws: w }), expect);
}
reachCourse('V6', 'j70', 14, ['90', '110', '120'], -9.2);   // strategy reaching table −9.2

// ---- Single reaching-angle vector (pins the per-angle path shown in the heatmap) ----
// LJ vs Melges 24 at 90° in 14 kt: (7.30/8.79)×(660.2/619.0)−1 = −11.4% (LJ loses the reach in breeze).
(function(){ const i=iOf(14);
  const r = legMargin(LJ, B.melges24, { vLJ: LJ.polar.reach['90'][i], vRival: B.melges24.polar.reach['90'][i], systemId:'ORC', tws:14, courseType:'reaching' });
  check('Vr', 'LJ vs Melges 24, 90° reach @14kt', r, -11.4);
})();

// ---- Interpolation vector (9 kt is between the 8 and 10 kt nodes) ----
// LJ beat 9kt = (4.14+4.34)/2 = 4.24; J/70 beat 9kt = (3.70+4.20)/2 = 3.95;
// margin = (4.24/3.95)×(660.2/672.0) − 1 = +5.5%. Also assert interp lands on a node exactly.
check('Vi', 'LJ vs J/70, 9kt beat (interpolated)', compareAt(LJ, B.j70, { angle:'beat', tws:9, systemId:'ORC', grid: TWS }), +5.5);
{ const at10 = interp(LJ.polar.beat_vmg, TWS, 10), mid = interp(LJ.polar.beat_vmg, TWS, 9);
  const ok = Math.abs(at10 - 4.34) < 1e-9 && Math.abs(mid - 4.24) < 1e-9;
  console.log(`${ok?'PASS':'FAIL'}  Vi2  interp lands on node (10kt=4.34) & midpoint (9kt=4.24)  →  got ${at10.toFixed(3)}, ${mid.toFixed(3)}`);
  ok ? pass++ : fail++; }

// ---- Confidence tiers ----
function checkTier(id, desc, got, expect) {
  const ok = got === expect;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${desc}  →  got ${got}  (expect ${expect})`);
  ok ? pass++ : fail++;
}
checkTier('Ct1', 'Esse ORC W/L @10kt → high', confidence(LJ, B.esse850, 'ORC', { tws: 10, courseType: 'windward_leeward' }), 'high');
checkTier('Ct2', 'Esse ORC W/L @6kt (light) → low', confidence(LJ, B.esse850, 'ORC', { tws: 6, courseType: 'windward_leeward' }), 'low');
checkTier('Ct3', 'Melges32 SRS (cross-system) → medium', confidence(LJ, B.melges32, 'SRS', { tws: 10, courseType: 'windward_leeward' }), 'medium');
checkTier('Ct4', 'Psaros33 APH-vs-GPH basis mismatch → low', confidence(LJ, B.psaros33, 'ORC', { tws: 10, courseType: 'windward_leeward' }), 'low');

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
