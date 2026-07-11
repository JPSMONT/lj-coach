// session-join.mjs — join a Trim Check photo to the boat's SessionLog by time, so the wind and speed
// at the moment of the shot fill themselves in. Pure nearest-neighbour over the frozen SessionLog
// sample schema ({t, stw, sog, tws, twa, aws, awa, heel, pitch}); no deps, so it inlines into the page.
//
// The photo clock comes from EXIF (exif.mjs), the log clock from the YDWG-02 stream (session-log.mjs);
// both are epoch ms. We take the nearest sample and REFUSE the join if it's further than maxGapMs away —
// a stale match would tag the shape with the wrong conditions, which is worse than asking the skipper.

// nearest sample to tMs (samples need a numeric .t; they come sorted but we don't rely on it).
export function nearestSample(samples, tMs, maxGapMs = 15000) {
  if (!Array.isArray(samples) || !samples.length || tMs == null) return null;
  let best = null, bestGap = Infinity;
  for (const s of samples) { if (s == null || s.t == null) continue; const g = Math.abs(s.t - tMs); if (g < bestGap) { bestGap = g; best = s; } }
  if (!best || bestGap > maxGapMs) return null;
  return { sample: best, gapMs: bestGap };
}

// Conditions at a photo's capture time, mapped to the Trim Check panel's fields. Boatspeed prefers STW
// (through-water — the correct polar input); falls back to SOG only if STW is missing. Returns null when
// there's no session or no sample within tolerance (→ the UI stays on manual entry).
export function conditionsAt(session, tMs, { maxGapMs = 15000 } = {}) {
  const samples = session && session.samples ? session.samples : session;
  const hit = nearestSample(samples, tMs, maxGapMs);
  if (!hit) return null;
  const s = hit.sample;
  const sog = s.stw != null ? s.stw : s.sog;
  return {
    tws: s.tws != null ? s.tws : null,
    twa: s.twa != null ? s.twa : null,
    aws: s.aws != null ? s.aws : null,
    awa: s.awa != null ? s.awa : null,
    sog: sog != null ? sog : null,
    heel: s.heel != null ? s.heel : null,
    t: s.t, gapMs: hit.gapMs,
  };
}
