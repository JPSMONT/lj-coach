// planner.mjs — fuse a venue's wind climatology with a forecast wind into a race plan + a 20-second
// pre-start call. The heavy corrected-time numbers come from the engine (courseMargin at the wind);
// this module is the light glue: which wind pattern is it, which shore does it reward, who's catchable,
// and the one-line call for the dock. Pure, no deps. See feedback_decision_at_moments_friction (moments 2 & 3).

// smallest circular distance between two compass bearings (degrees)
const circDiff = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);

// Match a forecast wind DIRECTION (degrees FROM) to the closest climatology pattern that carries a bearing.
export function matchPattern(patterns, dirFromDeg) {
  const cand = (patterns || []).filter((p) => Number.isFinite(p.bearing));
  if (!cand.length || !Number.isFinite(dirFromDeg)) return null;
  let best = cand[0], bd = circDiff(cand[0].bearing, dirFromDeg);
  for (const p of cand) { const d = circDiff(p.bearing, dirFromDeg); if (d < bd) { bd = d; best = p; } }
  return { pattern: best, offDeg: Math.round(bd) };
}

// Classify a corrected-time margin (%) into a catchability tier for the plan.
export function catchTier(pct) { return pct >= 0.5 ? 'catchable' : pct > -2 ? 'marginal' : 'out'; }

// Plan confidence: light air and a poor pattern match both widen it (never false precision).
export function planConfidence(offDeg, tws) {
  if (tws != null && tws <= 6) return 'low';
  if (offDeg > 60) return 'low';
  if (offDeg > 30 || (tws != null && tws <= 8)) return 'medium';
  return 'high';
}

// The 20-second pre-start line: favoured first-beat side + the one rival to watch (tightest on corrected time).
// catchList: [{ name, pct, tier }] already computed by the caller from the engine.
export function preStartCall(match, catchList) {
  if (!match) return 'Enter a wind direction to get the call.';
  const side = match.pattern.favoured_side || 'the pressure side';
  const inPlay = (catchList || []).filter((c) => c.tier !== 'out').slice().sort((a, b) => a.pct - b.pct);
  const watch = inPlay[0];
  return `First beat: ${side}.` + (watch ? ` Watch ${watch.name} (${watch.pct >= 0 ? '+' : ''}${watch.pct.toFixed(1)}%).` : '');
}
