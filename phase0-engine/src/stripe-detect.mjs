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
export function traceBetween(gray, w, h, A, B, opts = {}) {
  const idx = (x, y) => y * w + x;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const ax = A[0], ay = A[1], bx = B[0], by = B[1];
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
  if (L < 5) return [[Math.round(ax), Math.round(ay)], [Math.round(bx), Math.round(by)]];
  const nx = -dy / L, ny = dx / L;                              // unit perpendicular to the chord
  const steps = Math.max(8, Math.round(L / Math.max(3, opts.step || Math.round(w / 140))));
  const maxDev = clamp(opts.maxDev || Math.round(0.18 * L), 10, 80);   // corridor half-width (camber lives here)
  const winLocal = opts.win || Math.max(5, Math.round(maxDev * 0.5));  // per-step perpendicular search
  const sampleAt = (t, o) => { const x = Math.round(ax + dx * t + nx * o), y = Math.round(ay + dy * t + ny * o); if (x < 0 || x >= w || y < 0 || y >= h) return null; return gray[idx(x, y)]; };
  // polarity: strongest feature (dark seam or light stripe) across the corridor near the middle
  let dev = 0; const m0 = (() => { let s = 0, n = 0; for (let o = -maxDev; o <= maxDev; o += 2) { const v = sampleAt(0.5, o); if (v != null) { s += v; n++; } } return n ? s / n : 128; })();
  for (let o = -maxDev; o <= maxDev; o++) { const v = sampleAt(0.5, o); if (v != null && Math.abs(v - m0) > Math.abs(dev)) dev = v - m0; }
  const dark = dev < 0, better = (a, b) => (dark ? a < b : a > b);
  const out = []; let prevO = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let bo = prevO, bv = sampleAt(t, prevO); if (bv == null) bv = 128;
    for (let o = prevO - winLocal; o <= prevO + winLocal; o++) { const v = sampleAt(t, o); if (v != null && better(v, bv)) { bv = v; bo = o; } }
    prevO = clamp(bo, -maxDev, maxDev);
    out.push([Math.round(ax + dx * t + nx * prevO), Math.round(ay + dy * t + ny * prevO)]);
  }
  out[0] = [Math.round(ax), Math.round(ay)]; out[out.length - 1] = [Math.round(bx), Math.round(by)];  // ends exact
  if (out.length <= 9) return out;
  const ds = [], gap = (out.length - 1) / 8; for (let i = 0; i < 9; i++) ds.push(out[Math.round(i * gap)]); return ds;
}

// Build a luminance array from RGBA pixel data (as returned by canvas getImageData().data).
export function toGray(rgba, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  return g;
}
