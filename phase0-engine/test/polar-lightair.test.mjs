// polar-lightair.test.mjs — the modelled sub-6kt polar extension.
// Run:  node test/polar-lightair.test.mjs   (from phase0-engine/)

import { lightAirSpeed, extendRow, extendPolar, LIGHTAIR_SUBGRID } from '../src/polar-lightair.mjs';
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

// --- quadratic-through-origin, value+slope matched at 6kt, hand-derived ---
// beat VMG: v0=3.51 @6, v1=4.14 @8 → s=0.315, b=-0.045, a=0.855 → V(4)=2.70, V(5)=3.15
{
  const r4 = lightAirSpeed(3.51, 4.14, 6, 8, 4), r5 = lightAirSpeed(3.51, 4.14, 6, 8, 5);
  ok('Q1', 'beat VMG modelled 2.70 kn @ 4kt', near(r4.v, 2.70, 0.005) && r4.method === 'quadratic');
  ok('Q2', 'beat VMG modelled 3.15 kn @ 5kt', near(r5.v, 3.15, 0.005));
  ok('Q3', 'joins certified value at the anchor (V(6)=3.51)', near(lightAirSpeed(3.51, 4.14, 6, 8, 6).v, 3.51, 0.005));
  ok('Q4', 'through the origin (V(0)=0)', near(lightAirSpeed(3.51, 4.14, 6, 8, 0).v, 0, 1e-9));
}
// run VMG: v0=3.55, v1=4.47 → V(4)=2.542, V(5)=3.068 ; reach150: v0=4.10,v1=5.16 → V(4)=2.938
{
  ok('Q5', 'run VMG modelled 2.542 kn @ 4kt', near(lightAirSpeed(3.55, 4.47, 6, 8, 4).v, 2.542, 0.005));
  ok('Q6', 'reach150 modelled 2.938 kn @ 4kt', near(lightAirSpeed(4.10, 5.16, 6, 8, 4).v, 2.938, 0.005));
}
// --- monotonic: modelled points rise toward the anchor ---
{
  const e = extendRow(LJ.polar.beat_vmg, GRID); // [V4, V5]
  ok('M1', 'sub-grid increasing and below the 6kt value', e[0] < e[1] && e[1] < LJ.polar.beat_vmg[0]);
}
// --- linear fallback when the quadratic misbehaves (synthetic decreasing slope) ---
{
  const r = lightAirSpeed(4, 3, 6, 8, 4); // s<0 makes the quadratic exceed the anchor → fallback
  ok('L1', 'falls back to linear-to-origin', r.method === 'linear' && near(r.v, 4 * 4 / 6, 0.005));
}
// --- extendPolar shape: two nodes prepended, grid extended, certified tail untouched ---
{
  const { polar, grid, floor } = extendPolar(LJ.polar, GRID);
  ok('E1', 'grid prepended with [4,5]', grid[0] === 4 && grid[1] === 5 && grid[2] === 6);
  ok('E2', 'beat_vmg length grew by 2 and tail preserved', polar.beat_vmg.length === LJ.polar.beat_vmg.length + 2
    && polar.beat_vmg[2] === LJ.polar.beat_vmg[0]);
  ok('E3', 'every reach angle extended', Object.values(polar.reach).every((r) => r.length === LJ.polar.reach['90'].length + 2));
  ok('E4', 'floor is 4 kt', floor === 4);
  ok('E5', 'certified data not mutated', LJ.polar.beat_vmg[0] === 3.51 && LJ.polar.beat_vmg.length === GRID.length);
}
// --- integration: a boat carrying the extended polar can be scored at 5kt (was impossible before) ---
{
  const { polar, grid } = extendPolar(LJ.polar, GRID);
  // linear interp at exactly 5kt beat should equal the modelled 5kt node
  const idx = grid.indexOf(5);
  ok('I1', '5kt is now an addressable grid node', idx === 1 && near(polar.beat_vmg[idx], 3.15, 0.02));
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
