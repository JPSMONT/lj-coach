// polar-performance.test.mjs — the weakness-map engine.
// Run:  node test/polar-performance.test.mjs   (from phase0-engine/)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { polarSpeed } from '../src/engine.mjs';
import { samplePolarPct, weaknessMap, bandOf } from '../src/polar-performance.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, '../data/boats.json'), 'utf8'));
const B = Object.fromEntries(data.boats.map((b) => [b.id, b]));
const LJ = B.lj, GRID = data._meta.tws_grid;

let pass = 0, fail = 0;
const near = (a, b, tol) => a != null && Math.abs(a - b) <= tol;
function ok(id, desc, cond) { console.log(`${cond ? 'PASS' : 'FAIL'}  ${id}  ${desc}`); cond ? pass++ : fail++; }

// bands
ok('B1', 'bandOf splits light air', bandOf(7) === '6–8' && bandOf(5) === '<6' && bandOf(18) === '16+');

// samplePolarPct: sailing EXACTLY the polar → 100%. Beat is VMG-matched.
{
  const tws = 12, twa = 42;
  const targetVMG = polarSpeed(LJ, 'beat', tws, GRID);      // beat VMG @12
  const boatspeed = targetVMG / Math.cos(42 * Math.PI / 180); // the boatspeed that yields that VMG
  const r = samplePolarPct(LJ, { tws, twa, boatspeed }, GRID);
  ok('S1', 'on-polar beat sample → ~100%', r && near(r.pct, 100, 0.5) && r.pos === 'beat');
}
// below the VPP floor → null (no synthetic light-air number)
ok('S2', 'sub-4 kt sample → null', samplePolarPct(LJ, { tws: 3, twa: 40, boatspeed: 2 }, GRID) === null);

// ---- weakness map: WEAK in the light (85% of polar at 6–8 kt), ON polar at 12 kt ----
function beatSample(tws, factor) {                          // factor = fraction of polar VMG achieved
  const target = polarSpeed(LJ, 'beat', tws, GRID);
  const vmg = target * factor;
  return { tws, twa: 42, boatspeed: vmg / Math.cos(42 * Math.PI / 180) };
}
const samples = [];
for (let i = 0; i < 30; i++) samples.push(beatSample(7, 0.85));   // light: 85% of polar
for (let i = 0; i < 30; i++) samples.push(beatSample(11, 1.00));  // medium: on the number (band 10–12)
const wm = weaknessMap(LJ, samples, GRID);
ok('W1', 'light-air beat cell ≈ 85%', wm.cells.find((c) => c.band === '6–8' && c.pos === 'beat')?.avgPct != null && near(wm.cells.find((c) => c.band === '6–8' && c.pos === 'beat').avgPct, 85, 0.6));
ok('W2', 'medium-air beat cell ≈ 100%', near(wm.cells.find((c) => c.band === '10–12' && c.pos === 'beat').avgPct, 100, 0.6));
ok('W3', 'weakest cell is the light-air beat', wm.weakest[0].band === '6–8' && wm.weakest[0].pos === 'beat');
ok('W4', 'per-band summary shows light < medium', wm.bands.find((b) => b.band === '6–8').avgPct < wm.bands.find((b) => b.band === '10–12').avgPct);
ok('W5', 'samplesUsed counts both conditions', wm.samplesUsed === 60);

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
