// target-library.mjs — build Little Johnka's OWN trim targets from saved fast shapes. Instead of the
// textbook bands, once you have enough shapes you flagged FAST in a wind band, the target for that band
// becomes the median of your fast shapes. Pure; the UI persists the entries (localStorage) and passes
// the result to diagnose() as `personal` (resolveTarget picks it over the literature default).
//
// Entry shape (one saved reading): { ts, sailId, band, tws, depthPct, draftPct, twistDeg, mode, verdict }
// verdict ∈ 'fast' | 'slow' | ''.  band matches trim-diagnose windBand (<6 light, ≤14 medium, else heavy).

const BANDS = ['light', 'medium', 'heavy'];
export function bandOf(tws) { return !(tws >= 0) ? null : tws < 6 ? 'light' : tws <= 14 ? 'medium' : 'heavy'; }
function median(xs) { const s = [...xs].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; }

// Personal targets from the fast entries, once a band has ≥ minN of them. Returns { band: {depth:[lo,hi],
// draft:[lo,hi], twist, twistTol, source:'personal', n} } — the shape resolveTarget/diagnose expect.
export function personalTargets(entries, minN = 3) {
  const out = {};
  for (const b of BANDS) {
    const fast = (entries || []).filter((e) => e.verdict === 'fast' && e.band === b && e.draftPct != null);
    if (fast.length < minN) continue;
    const md = Math.round(median(fast.map((e) => e.draftPct)));
    const dp = Math.round(median(fast.map((e) => e.depthPct)));
    const tw = Math.round(median(fast.map((e) => Math.abs(e.twistDeg))));
    out[b] = { draft: [md - 2, md + 2], depth: [dp - 1, dp + 1], twist: tw, twistTol: 3, source: 'personal', n: fast.length };
  }
  return out;
}

// Per-band counts for the small library readout.
export function librarySummary(entries) {
  const s = {};
  for (const b of BANDS) {
    const inB = (entries || []).filter((e) => e.band === b);
    s[b] = { fast: inB.filter((e) => e.verdict === 'fast').length, total: inB.length };
  }
  return s;
}
