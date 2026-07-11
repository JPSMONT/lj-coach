// trim-diagnose.mjs — turn a measured sail shape (from trim-shape.mjs) + the wind into ONE trim
// action. Rules encode standard sailmaking cause→effect; no ML. Pure, no deps.
//
// Honesty about v1 RELATIVE mode: a single uncorrected photo biases ABSOLUTE depth by camera angle,
// but draft POSITION (a ratio along the stripe) and RELATIVE twist survive it. So in relative mode we
// down-weight depth and let draft-position + twist + the slot drive the headline; a caveat says so.
// In v2 'absolute' mode (mast marks) depth gets full weight. This keeps the call defensible, not
// confidently wrong. See feedback_decision_at_moments_friction + the Trim-Check specs.

// Wind bands (kt). Matches the design-doc target table.
export function windBand(tws) {
  if (!(tws >= 0)) return 'unknown';
  return tws < 6 ? 'light' : tws <= 14 ? 'medium' : 'heavy';
}

// Literature default targets — mainsail, upwind. MID-stripe camber, draft measured from luff, twist =
// top-vs-bottom chord (degrees, magnitude). Ranges are [lo, hi]; `twist` is a nominal magnitude ± tol.
// ASSUMPTION (flag it): generic keel-boat numbers, to be OVERWRITTEN per cell by LJ's own fast-shape
// medians as the photo library fills. Not gospel — a starting point so diagnosis works on day one.
const LIT = {
  light:  { depth: [12, 15], draft: [45, 50], twist: 12, twistTol: 4 },
  medium: { depth: [10, 12], draft: [45, 48], twist: 8,  twistTol: 4 },
  heavy:  { depth: [7, 9],   draft: [48, 52], twist: 5,  twistTol: 3 },
};

export function literatureTarget(band) {
  return LIT[band] || LIT.medium;
}

// Resolve the target: a personal (library-derived) target wins; else the literature default.
// personal: optional { [band]: {depth:[lo,hi], draft:[lo,hi], twist, twistTol} }.
export function resolveTarget(band, personal = null) {
  if (personal && personal[band]) return { ...personal[band], source: 'personal' };
  return { ...literatureTarget(band), source: 'literature' };
}

// distance of x below/above a [lo,hi] band (0 inside the band); signed: <0 below lo, >0 above hi.
function bandDev(x, [lo, hi]) { return x < lo ? x - lo : x > hi ? x - hi : 0; }

// Diagnose a single sail's shape vs a target at the given wind.
// shape: from analyzeShot (has depthMidPct, stripes[].draftPosPct, twistProfileDeg, mode).
// Returns { headline, others, targetSource, caveats } — headline = highest-impact action.
export function diagnose(shape, conditions = {}, personal = null) {
  const band = windBand(conditions.tws);
  const target = resolveTarget(band === 'unknown' ? 'medium' : band, personal);
  const relative = shape.mode !== 'absolute';
  const wDepth = relative ? 0.3 : 1.0;                 // depth trusted less when uncorrected
  const wDraft = 1.0, wTwist = 0.5;

  // representative draft position = mean of the stripes (draft should be consistent up the sail)
  const draft = shape.stripes.reduce((s, x) => s + x.draftPosPct, 0) / shape.stripes.length;
  const depth = shape.depthMidPct;
  const twist = Math.abs(shape.twistProfileDeg);

  const cand = [];
  // Each candidate carries its `channel` so relative mode can keep depth OUT of the headline (it can
  // inform, never be the single shown action — depth is the camera-biased quantity). All channels
  // score "how far PAST acceptable" so they rank on the same metric.
  const push = (dev, sens, channel, action, control, why) => {
    if (dev === 0) return;
    cand.push({ score: Math.abs(dev) * sens, dev: +dev.toFixed(1), channel, action, control, why });
  };

  // draft position (robust in relative mode) → luff tension
  const dDraft = bandDev(draft, target.draft);
  if (dDraft > 0) push(dDraft, wDraft, 'draft', 'Draft too far aft → add luff tension', 'cunningham / halyard',
    'more luff tension pulls the draft forward');
  if (dDraft < 0) push(dDraft, wDraft, 'draft', 'Draft too far forward → ease luff tension', 'cunningham / halyard',
    'easing luff tension lets the draft return aft');

  // depth (down-weighted, and headline-ineligible in relative mode) → backstay/outhaul
  const dDepth = bandDev(depth, target.depth);
  if (dDepth > 0) push(dDepth, wDepth, 'depth', 'Sail too deep for the wind → flatten', 'backstay / outhaul',
    'flatter reduces power and drag as the breeze builds');
  if (dDepth < 0) push(dDepth, wDepth, 'depth', 'Sail too flat → add power', 'backstay / outhaul',
    'ease to deepen and add power when underpowered');

  // twist (relative) → sheet / vang. Score by distance BEYOND tolerance, like the band channels.
  const dTwist = twist - target.twist;
  if (dTwist > target.twistTol) push(dTwist - target.twistTol, wTwist, 'twist', 'Top twisted open → close the leech', 'mainsheet / vang',
    'sheet harder (or more vang) to close the upper leech and point');
  if (dTwist < -target.twistTol) push(dTwist + target.twistTol, wTwist, 'twist', 'Leech too closed / hooked → add twist', 'mainsheet / vang',
    'ease sheet/vang to open the leech and reduce stall');

  cand.sort((a, b) => b.score - a.score);
  // In relative mode, depth is never the headline — pick the top NON-depth candidate for the action.
  const pool = relative ? cand.filter((c) => c.channel !== 'depth') : cand;
  const headline = pool[0] || { action: 'In the groove — shape matches target for this wind', control: '—', score: 0 };
  const others = cand.filter((c) => c !== headline);

  const caveats = [];
  if (relative) caveats.push('relative reading — depth is approximate until mast-mark calibration; draft position & twist are trustworthy');
  if (relative && cand.some((c) => c.channel === 'depth'))
    caveats.push('depth looks off-target but is not shown as the action in relative mode (camera-angle biased) — verify after mast-mark calibration');
  if (band === 'unknown') caveats.push('no wind attached — compared against medium-air target');
  if (conditions.joinToleranceSec != null && conditions.joinToleranceSec > 10)
    caveats.push(`wind interpolated ±${conditions.joinToleranceSec}s from the log`);

  return { band, headline, others, targetSource: target.source, caveats };
}

// Jib–main slot ("not aligned"): compare the two sails' leech twist at matched height. Positive twist =
// leech more open. We want the leeches roughly parallel (matched). Returns the lead move.
export function slotDiagnose(jibShape, mainShape) {
  const jt = jibShape.twistProfileDeg, mt = mainShape.twistProfileDeg;
  const mismatch = +(jt - mt).toFixed(1);                    // >0: jib more open than main
  const TOL = 3;
  let action, control;
  if (mismatch > TOL) { action = 'Jib leech more open than the main → close the jib'; control = 'jib lead forward / sheet on'; }
  else if (mismatch < -TOL) { action = 'Jib leech tighter than the main (slot choked, main backwinds) → open the jib'; control = 'jib lead aft / ease'; }
  else { action = 'Slot matched — leeches parallel'; control = '—'; }
  return { mismatchDeg: mismatch, matched: Math.abs(mismatch) <= TOL, action, control };
}
