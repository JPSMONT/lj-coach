import { polyfit, stripeMetrics, analyzeShot } from '/sessions/gifted-amazing-gates/mnt/Little Johnka — Sailing './src/trim-shape.mjs' Yacht Research/phase0-engine/src/trim-shape.mjs';

// INDEPENDENT generator: piecewise-cosine bump (C1, single-humped, exact peak/height),
// deliberately NOT the beta t^p(1-t)^q the test uses.
function cosBumpSeeds(P0, bearingDeg, L, depthFrac, posFrac, n = 9, jitter = 0, seed = 1) {
  const th = bearingDeg * Math.PI / 180;
  const u = [Math.cos(th), Math.sin(th)], nrm = [-u[1], u[0]];
  // simple LCG for reproducible jitter
  let st = seed >>> 0; const rnd = () => (st = (st * 1664525 + 1013904223) >>> 0) / 2**32 - 0.5;
  const p = posFrac;
  const y = (x) => x <= p
    ? depthFrac * (1 - Math.cos(Math.PI * x / p)) / 2
    : depthFrac * (1 + Math.cos(Math.PI * (x - p) / (1 - p))) / 2;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    let yf = y(x);
    let px = P0[0] + u[0] * (x * L) + nrm[0] * (yf * L);
    let py = P0[1] + u[1] * (x * L) + nrm[1] * (yf * L);
    if (jitter) { px += rnd() * jitter; py += rnd() * jitter; }
    pts.push([px, py]);
  }
  return pts;
}

const r2 = (v) => Math.round(v * 100) / 100;
console.log('=== 1. Recovery (independent cosine-bump model) ===');
for (const [dep, pos] of [[0.12,0.50],[0.10,0.35],[0.10,0.65],[0.15,0.40],[0.08,0.60]]) {
  const s = stripeMetrics(cosBumpSeeds([100,500], 0, 400, dep, pos, 15));
  console.log(`true depth=${(dep*100).toFixed(1)}% pos=${(pos*100).toFixed(0)}%  ->  got depth=${s.depthPct}% draft=${s.draftPosPct}%  entry=${s.entryDeg} exit=${s.exitDeg}`);
}

console.log('\n=== 2. Bearing invariance (rotate whole stripe) ===');
for (const brg of [0, 35, 60, 80, 120, -40, 170]) {
  const s = stripeMetrics(cosBumpSeeds([300,300], brg, 400, 0.11, 0.45, 15));
  console.log(`bearing=${String(brg).padStart(4)}  depth=${s.depthPct}  draft=${s.draftPosPct}  chordBearing=${r2(s.chordBearingDeg)}`);
}

console.log('\n=== 3. Seed count: 3 vs 5 vs 9 vs 25 (true 12% @ 40%) ===');
for (const n of [3,5,9,25]) {
  const s = stripeMetrics(cosBumpSeeds([100,500], 0, 400, 0.12, 0.40, n));
  console.log(`n=${String(n).padStart(2)}  depth=${s.depthPct}  draft=${s.draftPosPct}`);
}

console.log('\n=== 4. Very flat stripe (true 1% @ 50%) ===');
console.log(stripeMetrics(cosBumpSeeds([100,500],0,400,0.01,0.50,15)));
console.log('  perfectly flat (0 depth):');
try { console.log(stripeMetrics([[100,500],[250,500],[400,500],[500,500]])); } catch(e){ console.log('  threw:', e.message); }
