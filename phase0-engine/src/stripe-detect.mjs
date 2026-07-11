// stripe-detect.mjs — from ONE tap on a draft stripe, follow the line and return the points that
// trim-shape needs. Pure image processing on a grayscale array (no ML, no deps): find the stripe's
// polarity at the tap (darker or lighter than its surroundings), then ridge-follow it column by
// column left and right, snapping to the local extremum, stopping when contrast fades (edge of sail).
//
// Honest scope: this is validated on synthetic stripes; a real laminate sail carries battens, panel
// seams and shadows that can pull the trace off. The UI keeps a manual fallback, and low-contrast
// traces return few points so the caller can reject them. gray = luminance 0..255, length w*h.

export function traceStripe(gray, w, h, seed, opts = {}) {
  const step = Math.max(2, opts.step || Math.round(w / 140));   // horizontal march
  const win = Math.max(5, opts.win || Math.round(h / 45));      // vertical search half-window
  const minContrast = opts.minContrast || 7;                    // stripe vs local background (0..255)
  const idx = (x, y) => y * w + x;
  const clampY = (y) => (y < 0 ? 0 : y > h - 1 ? h - 1 : y);
  const colMean = (x, yc) => {
    let s = 0, n = 0;
    for (let y = clampY(yc - win); y <= clampY(yc + win); y++) { s += gray[idx(x, y)]; n++; }
    return s / n;
  };

  let sx = Math.round(seed[0]), sy = clampY(Math.round(seed[1]));
  sx = sx < 0 ? 0 : sx > w - 1 ? w - 1 : sx;
  // Polarity from the STRONGEST feature in the tap's column window, not the tapped pixel itself —
  // so a tap that lands a few px off the line still locks onto the stripe (dark seam or light stripe).
  const mean0 = colMean(sx, sy);
  let dev = 0;
  for (let y = clampY(sy - win); y <= clampY(sy + win); y++) {
    const d = gray[idx(sx, y)] - mean0;
    if (Math.abs(d) > Math.abs(dev)) dev = d;
  }
  const dark = dev < 0;                                         // strongest feature darker than background?
  const better = (a, b) => (dark ? a < b : a > b);             // seek minima if dark, else maxima

  // best y in the search window at column x, near a guess yc
  const refine = (x, yc) => {
    let by = clampY(yc), bv = gray[idx(x, by)];
    for (let y = clampY(yc - win); y <= clampY(yc + win); y++) {
      const v = gray[idx(x, y)];
      if (better(v, bv)) { bv = v; by = y; }
    }
    return by;
  };
  const contrast = (x, y) => Math.abs(gray[idx(x, y)] - colMean(x, y));

  const follow = (dir) => {
    const out = [];
    let y = refine(sx, sy), miss = 0;
    for (let x = sx + dir * step; x >= 0 && x < w; x += dir * step) {
      const by = refine(x, y);
      if (contrast(x, by) < minContrast) { if (++miss >= 3) break; } else miss = 0;
      y = by; out.push([x, by]);
    }
    return out;
  };

  const pts = [...follow(-1).reverse(), [sx, refine(sx, sy)], ...follow(1)];
  if (pts.length < 3) return pts;                               // too weak — let the caller fall back

  // downsample to ~9 evenly spaced points (enough for a degree-3 stripe fit, cheap to store)
  const N = 9;
  if (pts.length <= N) return pts;
  const out = [], gap = (pts.length - 1) / (N - 1);
  for (let i = 0; i < N; i++) out.push(pts[Math.round(i * gap)]);
  return out;
}

// traceBetween — the ROBUST method for a busy real sail: the user taps the two ENDS of a stripe
// (luff end A, leech end B) and we follow the seam BETWEEN them inside a bounded corridor around the
// straight chord. Anchoring both ends + a corridor stops the trace jumping onto battens, other seams,
// or shroud shadows (the failure mode of the single-tap free follower on laminate sails).
// The trace is a Viterbi (dynamic-programming) shortest-smoothest path along the seam BETWEEN the two
// taps, inside a corridor. Anchoring both ends + a smoothness penalty makes it lock onto the one line
// that connects the taps and ignore the many competing curves on a laminate sail (load fibres, seams,
// shadows) — the greedy follower jittered between them. A per-pixel SAIL gate (reject blue sky and the
// dark spar, using the anchors' own colour) keeps it on the cloth. opts.rgba = the RGBA pixel buffer
// (canvas getImageData().data) enables the colour gate; without it only a relative-darkness floor applies.
export function traceBetween(gray, w, h, A, B, opts = {}) {
  const ax = A[0], ay = A[1], bx = B[0], by = B[1];
  const dxx = bx - ax, dyy = by - ay, Lc = Math.hypot(dxx, dyy);
  if (Lc < 5) return [[Math.round(ax), Math.round(ay)], [Math.round(bx), Math.round(by)]];
  const nx = -dyy / Lc, ny = dxx / Lc;
  const T = Math.max(12, Math.round(Lc / 6));
  const maxDev = Math.max(8, Math.min(140, Math.round((opts.maxDevFrac || 0.16) * Lc)));
  const lam = opts.lam || 0.6;                                 // smoothness weight
  const rgba = opts.rgba || null;
  const nO = 2 * maxDev + 1, k0 = maxDev;
  const gAt = (x, y) => (x < 0 || x >= w || y < 0 || y >= h ? null : gray[y * w + x]);
  const chroma = (x, y) => { const i = (y * w + x) * 4; const R = rgba[i], G = rgba[i + 1], B2 = rgba[i + 2], s = R + G + B2 + 1; return [R / s, G / s]; };
  // anchor model: mean luminance + mean chromaticity of small patches at the two taps (whatever the sail colour)
  let mr = 0, mg = 0, ml = 0, cN = 0;
  for (const [px, py] of [A, B]) for (let yy = py - 8; yy <= py + 8; yy++) for (let xx = px - 8; xx <= px + 8; xx++) {
    const L = gAt(xx, yy); if (L == null) continue; ml += L; cN++; if (rgba) { const [r, g] = chroma(xx, yy); mr += r; mg += g; }
  }
  if (cN) { ml /= cN; mr /= cN; mg /= cN; }
  const Lfloor = Math.max(20, ml - 60), chromaT = opts.chromaT || 0.05;
  const valid = (x, y) => {
    const L = gAt(x, y); if (L == null || L < Lfloor) return false;   // spar / deep shadow
    if (rgba && cN) { const [r, g] = chroma(x, y); if (Math.hypot(r - mr, g - mg) > chromaT) return false; }  // sky
    return true;
  };
  // emission grid (luminance where sail-valid, else blocked)
  const E = new Float32Array((T + 1) * nO), OK = new Uint8Array((T + 1) * nO);
  for (let i = 0; i <= T; i++) { const t = i / T;
    for (let k = 0; k < nO; k++) { const o = k - maxDev, x = Math.round(ax + dxx * t + nx * o), y = Math.round(ay + dyy * t + ny * o);
      const L = gAt(x, y);
      if (L != null && valid(x, y)) { OK[i * nO + k] = 1; E[i * nO + k] = L; } else E[i * nO + k] = 1e6;
    }
  }
  // polarity from the middle column
  const mid = (T >> 1) * nO; let mn = 1e9, mx = -1e9; const med = [];
  for (let k = 0; k < nO; k++) if (OK[mid + k]) { const v = E[mid + k]; if (v < mn) mn = v; if (v > mx) mx = v; med.push(v); }
  med.sort((a, b) => a - b); const M = med.length ? med[med.length >> 1] : 128;
  const dark = (M - mn) >= (mx - M);
  const emit = (i, k) => { const v = E[i * nO + k]; return v >= 1e6 ? 1e6 : (dark ? v : 255 - v); };
  // Viterbi forced to start & end at o=0 (the two taps)
  let cost = new Float32Array(nO).fill(1e12); cost[k0] = emit(0, k0);
  const back = new Int16Array((T + 1) * nO);
  for (let i = 1; i <= T; i++) { const nc = new Float32Array(nO).fill(1e12);
    for (let k = 0; k < nO; k++) { const lo = Math.max(0, k - 3), hi = Math.min(nO - 1, k + 3); let bj = lo, bc = 1e18;
      for (let j = lo; j <= hi; j++) { const c = cost[j] + lam * (j - k) * (j - k); if (c < bc) { bc = c; bj = j; } }
      nc[k] = bc + emit(i, k); back[i * nO + k] = bj;
    }
    cost = nc;
  }
  let k = k0; const pathK = new Array(T + 1); pathK[T] = k;
  for (let i = T; i >= 1; i--) { k = back[i * nO + k]; pathK[i - 1] = k; }
  const pts = []; for (let i = 0; i <= T; i++) { const o = pathK[i] - maxDev; pts.push([Math.round(ax + dxx * (i / T) + nx * o), Math.round(ay + dyy * (i / T) + ny * o)]); }
  pts[0] = [Math.round(ax), Math.round(ay)]; pts[T] = [Math.round(bx), Math.round(by)];
  if (pts.length <= 9) return pts;
  const ds = [], gap = (pts.length - 1) / 8; for (let i = 0; i < 9; i++) ds.push(pts[Math.round(i * gap)]); return ds;
}

// traceQuality — is a traced line actually sitting on a stripe? Returns the median vertical contrast
// (a real seam differs from the cloth a few px above/below it) and the fraction of points over open sky.
// The UI uses this to REJECT a trace that ran across the mast or sky (no stripe to follow there),
// instead of silently accepting garbage — the failure mode on a head-on/foreshortened sail shot.
export function traceQuality(gray, w, h, points) {
  if (!points || points.length < 2) return { contrast: 0, skyFrac: 1 };
  const idx = (x, y) => y * w + x;
  const at = (x, y) => { x = Math.round(x); y = Math.round(y); if (x < 0 || x >= w || y < 0 || y >= h) return null; return gray[idx(x, y)]; };
  const cs = []; let sky = 0, n = 0;
  for (const [x, y] of points) {
    const v = at(x, y); if (v == null) continue; n++;
    if (v > 195) sky++;
    const up = at(x, y - 6), dn = at(x, y + 6), bg = [up, dn].filter((z) => z != null);
    if (bg.length) cs.push(Math.abs(v - bg.reduce((a, b) => a + b, 0) / bg.length));
  }
  cs.sort((a, b) => a - b);
  return { contrast: cs.length ? cs[Math.floor(cs.length / 2)] : 0, skyFrac: n ? sky / n : 1 };
}

// Build a luminance array from RGBA pixel data (as returned by canvas getImageData().data).
export function toGray(rgba, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  return g;
}
