// trim-shape.test.mjs — verify the geometry recovers KNOWN shapes from synthetic stripes.
// Method: build a stripe analytically (known chord, known camber depth & position, known bearing),
// sample points along it as "seeds", and assert the module recovers the inputs within tolerance.
// Run:  node test/trim-shape.test.mjs   (from phase0-engine/)
import { polyfit, stripeMetrics, analyzeShot } from '../src/trim-shape.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  FAIL ${name} — got ${JSON.stringify(got)}`); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// --- Build a synthetic stripe -------------------------------------------------
// chord from P0 (luff) to P1 (leech) of length L at image-plane bearing `bearingDeg`.
// Belly = a skewed bump giving max camber `depthFrac` (fraction of chord) at position `posFrac`.
// Bump model: y(t) = A * sin(pi * t)^k, k chosen so the peak sits at posFrac (k = ln(0.5)/ln(sin(pi*posFrac))... )
// Simpler & exact: use a piecewise-free smooth skew via y(t) = A * (t^p * (1-t)^q) normalised to peak A.
function stripeSeeds(P0, bearingDeg, L, depthFrac, posFrac, n = 9) {
  const th = bearingDeg * Math.PI / 180, u = [Math.cos(th), Math.sin(th)], nrm = [-u[1], u[0]];
  // skew exponents so that argmax of t^p (1-t)^q is posFrac: p/(p+q) = posFrac. Pick p+q = 2.
  const p = 2 * posFrac, q = 2 * (1 - posFrac);
  const peak = Math.pow(posFrac, p) * Math.pow(1 - posFrac, q) || 1;
  const A = depthFrac / peak;                       // scale so max |y/L| = depthFrac
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const yFrac = A * Math.pow(t, p) * Math.pow(1 - t, q);
    const px = P0[0] + u[0] * (t * L) + nrm[0] * (yFrac * L);
    const py = P0[1] + u[1] * (t * L) + nrm[1] * (yFrac * L);
    pts.push([px, py]);
  }
  return pts;
}

// --- polyfit sanity ---
const c = polyfit([0, 1, 2, 3], [0, 1, 4, 9], 2);          // y = x^2
ok('polyfit recovers x^2', near(c[0], 0, 1e-6) && near(c[1], 0, 1e-6) && near(c[2], 1, 1e-6), c);

// --- stripeMetrics: symmetric belly, 12% deep, draft at 50% ---
let s = stripeMetrics(stripeSeeds([100, 500], 0, 400, 0.12, 0.50));
ok('depth 12% recovered', near(s.depthPct, 12, 0.5), s.depthPct);
ok('draft 50% recovered', near(s.draftPosPct, 50, 2), s.draftPosPct);

// --- draft position aft (60%) is recovered as aft, not 50% ---
s = stripeMetrics(stripeSeeds([100, 500], 0, 400, 0.10, 0.60));
ok('draft 60% (aft) recovered', near(s.draftPosPct, 60, 3), s.draftPosPct);
s = stripeMetrics(stripeSeeds([100, 500], 0, 400, 0.10, 0.40));
ok('draft 40% (fwd) recovered', near(s.draftPosPct, 40, 3), s.draftPosPct);

// --- invariance: depth/draft independent of the chord's image bearing (rotate the whole stripe) ---
const flat = stripeMetrics(stripeSeeds([300, 300], 0, 400, 0.11, 0.45));
const tilt = stripeMetrics(stripeSeeds([300, 300], 35, 400, 0.11, 0.45));
ok('depth invariant to bearing', near(flat.depthPct, tilt.depthPct, 0.3), [flat.depthPct, tilt.depthPct]);
ok('draft invariant to bearing', near(flat.draftPosPct, tilt.draftPosPct, 2), [flat.draftPosPct, tilt.draftPosPct]);

// --- luff datum disambiguates reversed seed order (draft measured from the luff end) ---
const seeds = stripeSeeds([100, 500], 0, 400, 0.10, 0.35);
const fwd = stripeMetrics(seeds, [100, 500]);              // luff at the P0 end
const rev = stripeMetrics([...seeds].reverse(), [100, 500]); // same luff, seeds reversed
ok('luff datum fixes orientation', near(fwd.draftPosPct, rev.draftPosPct, 2), [fwd.draftPosPct, rev.draftPosPct]);

// --- 3-seed guard: still returns (coarse), <3 throws ---
ok('3 seeds allowed', typeof stripeMetrics([[100, 500], [300, 470], [500, 500]]).depthPct === 'number', null);
let threw = false; try { stripeMetrics([[0, 0], [1, 1]]); } catch { threw = true; }
ok('<3 seeds throws', threw, null);

// --- analyzeShot: twist increases up the sail -------------------------------
// bottom stripe flat (bearing 0), higher stripes progressively rotated open (bearing +6°, +12°).
const shot = {
  luff: [100, 900],
  stripes: [
    { hFrac: 0.25, seeds: stripeSeeds([100, 900], 0, 400, 0.12, 0.47) },
    { hFrac: 0.55, seeds: stripeSeeds([100, 650], 6, 360, 0.10, 0.48) },
    { hFrac: 0.85, seeds: stripeSeeds([100, 420], 12, 320, 0.08, 0.50) },
  ],
};
const shape = analyzeShot(shot);
ok('mode relative (v1)', shape.mode === 'relative', shape.mode);
ok('3 stripes', shape.stripes.length === 3, shape.stripes.length);
ok('bottom twist ≈ 0', near(shape.stripes[0].twistDeg, 0, 0.5), shape.stripes[0].twistDeg);
ok('top twist ≈ 12° (relative to bottom)', near(shape.twistProfileDeg, 12, 1.5), shape.twistProfileDeg);
ok('twist is monotonic up the sail', shape.stripes[0].twistDeg <= shape.stripes[1].twistDeg
   && shape.stripes[1].twistDeg <= shape.stripes[2].twistDeg, shape.stripes.map((x) => x.twistDeg));
ok('depth decreases up the sail (12→8)', shape.stripes[0].depthPct > shape.stripes[2].depthPct, shape.stripes.map((x) => x.depthPct));
ok('mastBend null in v1', shape.mastBendMm === null, shape.mastBendMm);

// --- audit #3 fix: 2-stripe shot reports mid-depth as the AVERAGE, not silently the bottom stripe ---
const two = analyzeShot({ stripes: [
  { hFrac: 0.30, seeds: stripeSeeds([100, 600], 0, 400, 0.14, 0.47) },
  { hFrac: 0.80, seeds: stripeSeeds([100, 350], 0, 360, 0.08, 0.50) },
] });
ok('2-stripe depthMid = average, not bottom', near(two.depthMidPct, (two.stripes[0].depthPct + two.stripes[1].depthPct) / 2, 0.2), [two.depthMidPct, two.stripes.map((x) => x.depthPct)]);
ok('<2 stripes throws', (() => { try { analyzeShot({ stripes: [shot.stripes[0]] }); return false; } catch { return true; } })(), null);

console.log(`\ntrim-shape: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
