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

// Build a luminance array from RGBA pixel data (as returned by canvas getImageData().data).
export function toGray(rgba, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  return g;
}
