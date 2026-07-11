// calibrate.test.mjs — the homography recovers a KNOWN perspective, and calibrating a perspective-warped
// synthetic sail recovers the TRUE camber (which the uncalibrated/relative reading gets wrong).
// Run:  node test/calibrate.test.mjs
import { homography, applyH, calibrate } from '../src/calibrate.mjs';
import { analyzeShot } from '../src/trim-shape.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  FAIL ${name} — got ${JSON.stringify(got)}`); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// --- homography recovers a known projective transform ---
const H0 = [1.0, 0.15, 20, 0.08, 1.1, 10, 0.0004, 0.0002, 1];
const sq = [[0, 0], [100, 0], [100, 80], [0, 80], [50, 40]];
const H = homography(sq, sq.map((p) => applyH(H0, p)));
ok('homography returned', !!H, H);
const tp = [37, 52], a = applyH(H, tp), b = applyH(H0, tp);
ok('homography reproduces the transform', near(a[0], b[0], 0.6) && near(a[1], b[1], 0.6), [a, b]);

// --- full pipeline: flat sail with KNOWN camber → perspective-warp → calibrate → recover ---
const geom = { luff_mm: 10000, stations: [
  { name: 'L', chord_mm: 3000, height_frac: 0.25 },
  { name: 'M', chord_mm: 2400, height_frac: 0.50 },
  { name: 'U', chord_mm: 1500, height_frac: 0.75 },
] };
const known = [{ d: 0.12, pos: 0.45 }, { d: 0.11, pos: 0.47 }, { d: 0.09, pos: 0.48 }];
function belly(chord, h, depthFrac, posFrac, n = 17) {
  const p = 2 * posFrac, q = 2 * (1 - posFrac), peak = Math.pow(posFrac, p) * Math.pow(1 - posFrac, q) || 1, A = depthFrac * chord / peak;
  const pts = []; for (let i = 0; i < n; i++) { const t = i / (n - 1); pts.push([t * chord, h + A * Math.pow(t, p) * Math.pow(1 - t, q)]); }
  return pts;
}
const Himg = [0.1, 0.0, 50, 0.0, 0.1, 40, 0.00002, 0.00001, 1];        // template mm → image px (scale + mild projective)
const tmpl = geom.stations.map((s, i) => belly(s.chord_mm, s.height_frac * geom.luff_mm, known[i].d, known[i].pos));
const img = tmpl.map((st) => st.map((p) => applyH(Himg, p)));
const stripesImg = img.map((st) => ({ luffEnd: st[0], leechEnd: st[st.length - 1] }));

const cal = calibrate(stripesImg, geom);
ok('calibrate returned a warp', !!cal, cal);
const shotStripes = img.map((st, i) => ({ hFrac: geom.stations[i].height_frac, seeds: st }));
const shape = analyzeShot({ stripes: shotStripes }, { warp: cal.warp });
ok('mode = absolute', shape.mode === 'absolute', shape.mode);
shape.stripes.forEach((s, i) => {
  ok(`stripe ${i} camber ≈ ${known[i].d * 100}%`, near(s.depthPct, known[i].d * 100, 1.6), s.depthPct);
  ok(`stripe ${i} draft ≈ ${known[i].pos * 100}%`, near(s.draftPosPct, known[i].pos * 100, 4), s.draftPosPct);
});

// --- calibration matters: the uncalibrated (relative) camber is off from the true value ---
const rel = analyzeShot({ luff: [-1e9, 0], stripes: shotStripes });
ok('relative camber is biased vs the true 12% (so calibration is needed)',
  Math.abs(rel.stripes[0].depthPct - 12) > Math.abs(shape.stripes[0].depthPct - 12), [rel.stripes[0].depthPct, shape.stripes[0].depthPct]);

console.log(`\ncalibrate: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
