// path-divergence.test.mjs — verify the route-divergence engine on synthetic tracks with a known split.
// Run:  node test/path-divergence.test.mjs   (from phase0-engine/)
import { parseDur, splitAtMark, analyzeDivergence } from '../src/path-divergence.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  FAIL ${name} — got ${JSON.stringify(got)}`); } };

// --- duration parsing ---
ok('parseDur d+hms', parseDur('1d 02:04:36') === 93876, parseDur('1d 02:04:36'));
ok('parseDur hms', parseDur('23:08:23') === 83303, parseDur('23:08:23'));

// Build an out-and-back track: west(6.1)→east(6.8)→west(6.1) at a chosen latitude offset on the return.
// pts = [t, lon, lat]. Outbound both boats on same line (lat 46.30); return: LJ north, rival south.
const mk = (retLat) => {
  const p = []; let t = 0;
  for (let lon = 6.10; lon <= 6.80001; lon += 0.05) p.push([t += 60, +lon.toFixed(2), 46.30]);        // outbound
  for (let lon = 6.80; lon >= 6.09999; lon -= 0.05) p.push([t += 60, +lon.toFixed(2), retLat]);        // return
  return p;
};
const lj = { label: 'LJ', pts: mk(46.34) };            // LJ returns NORTH (46.34)
const rivalSouth = { label: 'TALAN', corr: '23:08:23', pts: mk(46.26) }; // beat LJ, returned SOUTH (46.26)
const rivalSlow = { label: 'Slowpoke', corr: '2d 00:00:00', pts: mk(46.40) }; // did NOT beat LJ → excluded

// split sanity: easternmost fix separates the two legs
const sp = splitAtMark(lj.pts);
ok('split outbound ends at mark (max lon)', Math.abs(sp.outbound[sp.outbound.length - 1][0] - 6.80) < 1e-9, sp.outbound.at(-1));
ok('split return starts at mark', Math.abs(sp.return_[0][0] - 6.80) < 1e-9, sp.return_[0]);

const res = analyzeDivergence(lj, [rivalSouth, rivalSlow], '1d 02:04:36');
ok('only faster boats counted', res.beaters.length === 1 && res.beaters[0] === 'TALAN', res.beaters);
const ret = res.legs.find((l) => l.key === 'return_');
const out = res.legs.find((l) => l.key === 'outbound');
ok('outbound offset ~0', out && Math.abs(out.meanOffset_m) < 500, out && out.meanOffset_m);
ok('return: LJ north of rival (+ offset)', ret && ret.meanOffset_m > 3000, ret && ret.meanOffset_m);
// 46.34 − 46.26 = 0.08 deg ≈ 8906 m
ok('return offset magnitude ~8900 m', ret && Math.abs(ret.meanOffset_m - 8906) < 300, ret && ret.meanOffset_m);
ok('return side labelled North', ret && /Vaud/.test(ret.side), ret && ret.side);
ok('headline names the return + south advice', /Return/.test(res.headline) && /south \/ French/.test(res.headline), res.headline);

console.log(`\npath-divergence: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
