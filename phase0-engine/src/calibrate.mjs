// calibrate.mjs — planform calibration. Use the sail's KNOWN girth chords (from the design plan) to
// solve the photo's perspective (a homography from the tapped stripe ends to the flat design planform),
// so camber and draft position come out ABSOLUTE instead of camera-biased "relative". No hardware, no
// tape — the sail's own draft stripes are known-length rulers.
//
// Method: each stripe contributes its luff-end and leech-end. In the flat sail template those map to
// (0, height) and (chord, height) in mm. ≥2 stripes → ≥4 correspondences → a homography (DLT, solved
// as an 8-unknown least-squares with h33=1). Warp the traced curve through it into the fronto-parallel
// mm frame, where depth/chord is a true ratio → absolute camber %. Pure, no deps.

// Gauss elimination with partial pivoting (local copy; small systems).
function solveH(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// Homography H (3x3, h33=1) mapping src image points → dst template points. Needs ≥4 correspondences.
export function homography(src, dst) {
  if (src.length < 4 || src.length !== dst.length) return null;
  const N = Array.from({ length: 8 }, () => new Array(8).fill(0)), rhs = new Array(8).fill(0);
  const acc = (row, val) => { for (let i = 0; i < 8; i++) { rhs[i] += row[i] * val; for (let j = 0; j < 8; j++) N[i][j] += row[i] * row[j]; } };
  for (let i = 0; i < src.length; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    acc([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    acc([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = solveH(N, rhs);
  return h ? [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1] : null;
}

export function applyH(H, p) {
  const x = p[0], y = p[1], w = H[6] * x + H[7] * y + H[8] || 1e-9;
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

// Flat-sail template endpoints (mm) for the lowest `nStripes` girth stations, bottom→top.
export function buildTemplate(geom, nStripes) {
  const P = geom.luff_mm, st = geom.stations.slice(0, Math.min(nStripes, geom.stations.length));
  return st.map((s) => ({ luff: [0, s.height_frac * P], leech: [s.chord_mm, s.height_frac * P], chord: s.chord_mm }));
}

// Compute the calibration from the stripes' image endpoints (bottom→top; each {luffEnd, leechEnd}).
// Returns { H, warp } or null if degenerate.
export function calibrate(stripesImg, geom) {
  const tpl = buildTemplate(geom, stripesImg.length);
  if (tpl.length < 2) return null;
  const src = [], dst = [];
  for (let i = 0; i < tpl.length; i++) {
    src.push(stripesImg[i].luffEnd); dst.push(tpl[i].luff);
    src.push(stripesImg[i].leechEnd); dst.push(tpl[i].leech);
  }
  const H = homography(src, dst);
  return H ? { H, warp: (p) => applyH(H, p) } : null;
}
