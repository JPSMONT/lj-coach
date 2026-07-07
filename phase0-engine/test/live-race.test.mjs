// live-race.test.mjs — vectors for the live racing helpers (polar target %, live margin).
// Run:  node test/live-race.test.mjs   (from phase0-engine/)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compareAt, polarSpeed } from '../src/engine.mjs';
import { polarTarget, pctOfTarget, liveMargin, liveFleet, measuredSpeed } from '../src/live-race.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, '../data/boats.json'), 'utf8'));
const B = Object.fromEntries(data.boats.map((b) => [b.id, b]));
const LJ = B.lj, GRID = data._meta.tws_grid;

let pass = 0, fail = 0;
const near = (a, b, tol) => a != null && Math.abs(a - b) <= tol;
function ok(id, desc, cond) { console.log(`${cond ? 'PASS' : 'FAIL'}  ${id}  ${desc}`); cond ? pass++ : fail++; }

// polarTarget == the boat's own polar speed at that point of sail / TWS
ok('PT1', 'polar target = LJ beat VMG @10kt (4.34)', near(polarTarget(LJ, 'beat', 10, GRID), 4.34, 0.001));

// pctOfTarget
ok('PT2', 'on target → 100%', near(pctOfTarget(4.34, 4.34), 100, 1e-9));
ok('PT3', 'half speed → 50%', near(pctOfTarget(2.17, 4.34), 50, 1e-9));
ok('PT4', 'null actual → null', pctOfTarget(null, 4.34) === null);

// KEY property: when LJ sails EXACTLY its polar, live margin == Compare (polar-vs-polar).
{
  const tws = 10, angle = 'beat';
  const vLJ = polarSpeed(LJ, angle, tws, GRID);
  const live = liveMargin(LJ, B.j70, { actualStw: vLJ, angle, tws, systemId: 'ORC', grid: GRID });
  const comp = compareAt(LJ, B.j70, { angle, tws, systemId: 'ORC', grid: GRID });
  ok('LM1', 'live margin @ polar speed == Compare margin', live.status === 'ok' && near(live.pct, comp.pct, 1e-9));
}
// Sailing BELOW target loses margin; ABOVE gains it.
{
  const tws = 10, angle = 'beat';
  const vLJ = polarSpeed(LJ, angle, tws, GRID);
  const base = compareAt(LJ, B.j70, { angle, tws, systemId: 'ORC', grid: GRID }).pct;
  const slow = liveMargin(LJ, B.j70, { actualStw: vLJ * 0.9, angle, tws, systemId: 'ORC', grid: GRID }).pct;
  const fast = liveMargin(LJ, B.j70, { actualStw: vLJ * 1.1, angle, tws, systemId: 'ORC', grid: GRID }).pct;
  ok('LM2', 'below target → margin worse than polar', slow < base);
  ok('LM3', 'above target → margin better than polar', fast > base);
}

// measuredSpeed: beat/run convert to VMG (× |cos TWA|); reaching stays boatspeed.
ok('MS1', 'beat: 5.84 kn @ 42° TWA → VMG ≈ 4.34', near(measuredSpeed(5.84, 42, 'beat'), 5.84 * Math.cos(42 * Math.PI / 180), 1e-6) && near(measuredSpeed(5.84, 42, 'beat'), 4.34, 0.02));
ok('MS2', 'reach: STW unchanged', measuredSpeed(7.0, 90, '90') === 7.0);
ok('MS3', 'run: 6.0 kn @ 170° TWA → VMG ≈ 5.91', near(measuredSpeed(6.0, 170, 'run'), 5.91, 0.02));

// liveFleet returns a sorted best→worst list with sane statuses.
{
  const rivals = ['esse850', 'j70', 'melges24', 'surprise'].map((id) => B[id]);
  const fleet = liveFleet(LJ, rivals, { actualStw: 4.34, angle: 'beat', tws: 10, systemId: 'ORC', grid: GRID });
  const oks = fleet.filter((r) => r.status === 'ok');
  const sorted = oks.every((r, i) => i === 0 || oks[i - 1].pct >= r.pct);
  ok('LF1', 'liveFleet covers all rivals', fleet.length === 4);
  ok('LF2', 'liveFleet sorted best→worst', sorted);
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
