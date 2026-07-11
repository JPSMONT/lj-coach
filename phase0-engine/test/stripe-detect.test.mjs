// stripe-detect.test.mjs — verify one-tap stripe tracing recovers a KNOWN curved line, and that the
// traced points feed trim-shape to the right depth/draft. Run: node test/stripe-detect.test.mjs
import { traceStripe, traceBetween, toGray } from '../src/stripe-detect.mjs';
import { stripeMetrics } from '../src/trim-shape.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  FAIL ${name} — got ${JSON.stringify(got)}`); } };

// --- synthetic image: a dark bellied stripe on a light sail ---
const w = 200, h = 150;
const bg = 200, ink = 40;
const yCurve = (x) => 40 + 30 * Math.sin(Math.PI * x / (w - 1));   // 30px belly, peak at mid (draft 50%)
function makeGray(curve, thick = 1) {
  const g = new Float32Array(w * h).fill(bg);
  for (let x = 0; x < w; x++) {
    const yy = Math.round(curve(x));
    for (let dy = -thick; dy <= thick; dy++) { const y = yy + dy; if (y >= 0 && y < h) g[y * w + x] = ink; }
  }
  return g;
}
const g = makeGray(yCurve);

// --- trace from a single tap near the middle of the stripe ---
const pts = traceStripe(g, w, h, [100, yCurve(100)]);
ok('returns several points from one tap', pts.length >= 5, pts.length);
let maxErr = 0; for (const [x, y] of pts) maxErr = Math.max(maxErr, Math.abs(y - yCurve(x)));
ok('traced points lie on the stripe (<2px)', maxErr <= 2, maxErr);

// --- a tap a few px OFF the line still snaps onto it ---
const off = traceStripe(g, w, h, [100, yCurve(100) - 4]);
let offErr = 0; for (const [x, y] of off) offErr = Math.max(offErr, Math.abs(y - yCurve(x)));
ok('snaps on from a nearby tap (<2px)', offErr <= 2, offErr);

// --- traced points recover the true camber/draft through trim-shape ---
const m = stripeMetrics(pts);
ok('depth ~15% (30px / 199px chord)', Math.abs(m.depthPct - 15) < 2.5, m.depthPct);
ok('draft ~50% (peak at mid)', Math.abs(m.draftPosPct - 50) < 8, m.draftPosPct);

// --- skewed belly (peak at 35%) → traced draft reads forward, not 50% ---
// curve = 0 at both ends, single peak at posFrac (t^p (1-t)^q normalised), drawn as a downward belly.
const pos = 0.35, p = 2 * pos, q = 2 * (1 - pos);
const peakV = Math.pow(pos, p) * Math.pow(1 - pos, q);
const skew = (x) => { const t = x / (w - 1); return 40 + 30 * (Math.pow(t, p) * Math.pow(1 - t, q)) / peakV; };
const gS = makeGray(skew);
const ps = traceStripe(gS, w, h, [70, skew(70)]);
const ms = stripeMetrics(ps);
ok('skewed draft reads forward of centre (<46%)', ms.draftPosPct < 46, ms.draftPosPct);

// --- light stripe on a dark sail (LJ: white stripe on black main) also traces ---
const gLight = new Float32Array(w * h).fill(30);
for (let x = 0; x < w; x++) { const yy = Math.round(yCurve(x)); for (let dy = -1; dy <= 1; dy++) { const y = yy + dy; if (y >= 0 && y < h) gLight[y * w + x] = 235; } }
const pl = traceStripe(gLight, w, h, [100, yCurve(100)]);
let lErr = 0; for (const [x, y] of pl) lErr = Math.max(lErr, Math.abs(y - yCurve(x)));
ok('traces a LIGHT stripe on a dark sail too', pl.length >= 5 && lErr <= 2, [pl.length, lErr]);

// --- toGray: RGBA → luminance ---
const gr = toGray(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]), 2, 1);
ok('toGray white≈255, black≈0', Math.abs(gr[0] - 255) < 1 && gr[1] < 1, [gr[0], gr[1]]);

// --- traceBetween: anchored 2-tap trace stays on the intended stripe despite a nearby DECOY line ---
// target stripe (dark belly) + a decoy dark line ~24px above it (like an adjacent seam/batten).
const gDecoy = new Float32Array(w * h).fill(bg);
const yTarget = (x) => 46 + 26 * Math.sin(Math.PI * x / (w - 1));
for (let x = 0; x < w; x++) {
  const yt = Math.round(yTarget(x)); for (let d = -1; d <= 1; d++) { const y = yt + d; if (y >= 0 && y < h) gDecoy[y * w + x] = ink; }
  const yd = Math.round(yTarget(x)) - 24; for (let d = -1; d <= 1; d++) { const y = yd + d; if (y >= 0 && y < h) gDecoy[y * w + x] = ink + 10; }  // decoy
}
const tb = traceBetween(gDecoy, w, h, [2, yTarget(2)], [w - 3, yTarget(w - 3)]);
let tbErr = 0; for (const [x, y] of tb) tbErr = Math.max(tbErr, Math.abs(y - yTarget(x)));
ok('anchored trace stays on target (not the decoy 24px away)', tbErr <= 3, tbErr);
ok('endpoints are exact', Math.abs(tb[0][0] - 2) <= 1 && Math.abs(tb[tb.length - 1][0] - (w - 3)) <= 1, [tb[0], tb[tb.length - 1]]);
const mb = stripeMetrics(tb);
ok('anchored trace recovers depth ~13%', Math.abs(mb.depthPct - 13) < 3, mb.depthPct);

console.log(`\nstripe-detect: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
