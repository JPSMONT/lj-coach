// trim-shape.mjs — turn tapped points on a sail's draft stripes into shape numbers:
// depth (camber) %, draft position %, twist per stripe, entry/exit angle. Pure geometry, no deps,
// no ML. Mirrors the manual tap-to-seed method used by North Sails Scan / SailWatcher, but is ours.
//
// v1 is RELATIVE mode: a single photo is uncorrected for perspective, so absolute depth is biased by
// camera angle. Two things survive that bias well and drive the honest diagnosis: (1) draft POSITION,
// a projective ratio ALONG a near-planar stripe, and (2) relative twist BETWEEN stripes. Absolute
// depth is reported but flagged; v2 (mast-mark homography) upgrades it. See the Trim-Check specs.
//
// Coordinates: image pixels, origin top-left. A "stripe" is the ordered seed taps along one shape line
// (luff end → leech end); interior seeds define the belly. Everything is computed in chord-aligned,
// chord-normalised units, so depth/draft are dimensionless fractions (× 100 = %) and angles are degrees.

// --- tiny linear algebra (no deps): solve A x = b by Gaussian elimination with partial pivoting ---
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;            // singular
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// Least-squares polynomial fit y = Σ c_k x^k of degree `deg` through (xs, ys). Low degree (≤3) keeps
// the stripe single-humped and robust to imprecise taps ("don't worry about being exact").
export function polyfit(xs, ys, deg) {
  const m = deg + 1, A = Array.from({ length: m }, () => new Array(m).fill(0)), b = new Array(m).fill(0);
  for (let i = 0; i < xs.length; i++) {
    const p = []; let v = 1;
    for (let k = 0; k < 2 * deg + 1; k++) { p.push(v); v *= xs[i]; }
    for (let r = 0; r < m; r++) { b[r] += ys[i] * p[r]; for (let c = 0; c < m; c++) A[r][c] += p[r + c]; }
  }
  return solve(A, b) || [0];
}
const polyVal = (c, x) => c.reduce((s, ck, k) => s + ck * x ** k, 0);
const polyDer = (c, x) => c.reduce((s, ck, k) => k ? s + k * ck * x ** (k - 1) : s, 0);

// vector helpers
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const norm180 = (d) => ((d + 180) % 360 + 360) % 360 - 180;   // wrap to [-180,180]

// Metrics for ONE stripe from its ordered seeds. `luff` (optional global tack-side point) only
// disambiguates which end is the luff; if absent, seeds[0] is taken as the luff end.
export function stripeMetrics(seeds, luff = null) {
  if (!Array.isArray(seeds) || seeds.length < 3) throw new Error('stripe needs ≥3 seeds');
  let pts = seeds;
  // orient luff→leech: the end nearer the global luff is the luff end
  if (luff) { if (len(sub(seeds[seeds.length - 1], luff)) < len(sub(seeds[0], luff))) pts = [...seeds].reverse(); }
  const P0 = pts[0], P1 = pts[pts.length - 1];
  const v = sub(P1, P0), L = len(v);
  if (L < 1e-9) throw new Error('degenerate stripe (zero chord)');
  const u = [v[0] / L, v[1] / L], nrm = [-u[1], u[0]];        // chord unit + left normal
  const xs = [], ys = [];
  for (const s of pts) { const d = sub(s, P0); xs.push(dot(d, u) / L); ys.push(dot(d, nrm) / L); }
  const deg = Math.min(3, pts.length - 1);
  const c = polyfit(xs, ys, deg);
  // sample the fitted curve to find max deviation (camber) and where it sits (draft position)
  let maxAbs = 0, xAt = 0.5;
  for (let i = 0; i <= 200; i++) { const x = i / 200, y = Math.abs(polyVal(c, x)); if (y > maxAbs) { maxAbs = y; xAt = x; } }
  const sign = polyVal(c, xAt) >= 0 ? 1 : -1;                 // belly side (for consistent angle signs)
  const ang = (slope) => Math.atan(slope) * 180 / Math.PI;   // slope (chord-normalised) → degrees
  return {
    depthPct: +(100 * maxAbs).toFixed(2),
    draftPosPct: +(100 * xAt).toFixed(1),
    entryDeg: +ang(sign * polyDer(c, 0)).toFixed(1),         // + = curve bulges to leeward at the luff
    exitDeg: +ang(-sign * polyDer(c, 1)).toFixed(1),         // + = leech hooked to windward at exit
    chordBearingDeg: Math.atan2(v[1], v[0]) * 180 / Math.PI,  // image-plane bearing, for twist
    chordLenPx: +L.toFixed(1),
  };
}

// Analyse a whole shot. `shot.stripes` are ordered BOTTOM → TOP (low on the sail first); each is
// { seeds:[[x,y],…] }. Optional `shot.luff` disambiguates stripe orientation. v1 → mode "relative".
export function analyzeShot(shot) {
  const stripesIn = (shot && shot.stripes) || [];
  if (stripesIn.length < 2) throw new Error('need ≥2 stripes to measure twist');
  const luff = shot.luff || null;
  const m = stripesIn.map((st) => stripeMetrics(st.seeds, luff));
  const base = m[0].chordBearingDeg;                          // twist datum = bottom stripe (relative mode)
  const heights = stripesIn.map((st, i) => (st.hFrac != null ? st.hFrac : i / (stripesIn.length - 1)));
  const stripes = m.map((mm, i) => ({
    hFrac: +heights[i].toFixed(2),
    depthPct: mm.depthPct, draftPosPct: mm.draftPosPct,
    twistDeg: +norm180(mm.chordBearingDeg - base).toFixed(1),
    entryDeg: mm.entryDeg, exitDeg: mm.exitDeg,
  }));
  const warnings = [];
  if (!luff) warnings.push('no luff datum tapped — stripe orientation assumed from seed order');
  if (stripesIn.some((st) => st.seeds.length < 4)) warnings.push('some stripes have only 3 seeds — draft position is unreliable (a 3-point fit is forced symmetric, so it reports ~50% regardless of the true belly)');
  // mid-camber = the middle stripe (average the two middle for an even count, so a 2-stripe shot
  // doesn't silently report the BOTTOM stripe as "mid").
  const n = stripes.length, mid = (n % 2)
    ? stripes[(n - 1) / 2].depthPct
    : +((stripes[n / 2 - 1].depthPct + stripes[n / 2].depthPct) / 2).toFixed(2);
  return {
    mode: 'relative',                                        // v2 (mast marks) → 'absolute'
    stripes,
    twistProfileDeg: stripes[stripes.length - 1].twistDeg,   // top vs bottom
    entryDeg: +(stripes.reduce((s, x) => s + x.entryDeg, 0) / stripes.length).toFixed(1),
    exitDeg: +(stripes.reduce((s, x) => s + x.exitDeg, 0) / stripes.length).toFixed(1),
    depthMidPct: mid,
    mastBendMm: null,                                        // v2
    quality: { stripes: stripesIn.length, refsUsed: false, warnings },
  };
}
