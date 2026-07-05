// engine.mjs — the LJ Coach corrected-time engine (Phase 0 spine).
//
// VERIFIED FORMULA (sign-checked against the win-map; see Phase0-Build-Spec):
//   margin = (V_LJ / V_rival) * (rate_rival / rate_LJ) - 1        [+ = LJ wins]
// Equivalently, corrected_time = elapsed * rate, lower corrected wins, and
//   margin = corrected_rival / corrected_LJ - 1.
// With ORC rate = 1/GPH this is (V_LJ/V_rival) * (GPH_LJ/GPH_rival) - 1.
//
// The earlier draft wrote (rate_LJ/rate_rival) — INVERTED — which flips the sign against every
// faster-rated boat. The acceptance tests pin the direction to numeric cases so it can't recur.
//
// Canonical: LJ polar basis = 2020 ORC certificate (GPH 660.2). One basis everywhere until renewal.

import { SYSTEMS, rateOf } from './ratings.mjs';

export const VPP_MIN_TWS = 4;   // below this, ORC VPP physics break down — no synthetic numbers.
export const LIGHT_AIR_TWS = 6; // at/below this, widen confidence (single-number GPH over-reads light air).

// ---- Guards -----------------------------------------------------------------

// Returns a guard result object if the comparison must NOT produce a number, else null.
export function guard(lj, rival, systemId, tws) {
  if (tws != null) {
    // A non-finite TWS (NaN/Infinity from a garbled sensor/parse) must never read as "above the
    // floor" and yield a confident number — refuse it. (NaN < 4 is false, so this needs its own check.)
    if (!Number.isFinite(tws)) {
      return { status: 'outside_vpp', reason: `TWS is not a finite number (${tws}); refusing to produce a margin.` };
    }
    if (tws < VPP_MIN_TWS) {
      return { status: 'outside_vpp', reason: `TWS ${tws} kt is below the VPP floor (${VPP_MIN_TWS} kt); no synthetic polar.` };
    }
  }
  if (rateOf(lj, systemId) == null) {
    return { status: 'no_rating', reason: `Little Johnka has no ${systemId} rating.` };
  }
  if (rateOf(rival, systemId) == null) {
    // e.g. ORC requested but the rival has no ORC polar/GPH (SB20, Lüthi 990, Toucan, Open 7.50).
    return { status: 'no_orc_polar', reason: `${rival.name} has no ${systemId} rating — cannot fabricate a margin.` };
  }
  return null;
}

// ---- Confidence tier --------------------------------------------------------
// High:  both boats current ORC (GPH) basis, similar cert vintage, windward-leeward, > light air.
// Low:   APH-vs-GPH basis mismatch, missing/old polar, reaching proxy, or TWS <= 6 kt.
// Medium: everything else (incl. any cross-system ORC<->SRS/Yardstick conversion).
export function confidence(lj, rival, systemId, { tws = null, courseType = null } = {}) {
  const basisMismatch =
    (lj.rating_basis && rival.rating_basis && lj.rating_basis !== rival.rating_basis);
  const lowFlags =
    basisMismatch ||
    rival.comparability_flag === 'aph_offset' ||
    rival.comparability_flag === 'individual' ||
    courseType === 'reaching' ||
    (tws != null && tws <= LIGHT_AIR_TWS);
  if (lowFlags) return 'low';
  if (systemId !== 'ORC') return 'medium';           // cross-system conversion
  const sameVintage = lj.cert_vintage && rival.cert_vintage &&
    Math.abs(Number(lj.cert_vintage) - Number(rival.cert_vintage)) <= 1;
  if (rival.rating_basis === 'GPH' && sameVintage && courseType === 'windward_leeward') return 'high';
  return 'medium';
}

// Render a margin as a range + tier instead of a bare number.
// Band half-width grows for lower confidence and (per the win-map) for light air where a single
// number over-reads. These are presentation bands, not new physics.
export function asBand(marginPct, tier) {
  const half = tier === 'high' ? 1.0 : tier === 'medium' ? 2.0 : 4.0;
  const lo = marginPct - half, hi = marginPct + half;
  const f = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`;
  return { point: marginPct, lo, hi, tier, text: `LJ ${f(lo)} to ${f(hi)}, ${tier}` };
}

// ---- Single-leg margin ------------------------------------------------------
// vLJ, vRival: boat speeds (kt) at the leg's TWA/TWS (Beat/Run VMG at each boat's own optimal
// angle, or reaching speed at the reporting angle). Returns a result object.
export function legMargin(lj, rival, { vLJ, vRival, systemId, tws = null, courseType = null }) {
  const g = guard(lj, rival, systemId, tws);
  if (g) return g;
  if (!(vLJ > 0) || !(vRival > 0)) {
    return { status: 'no_speed', reason: 'Missing boat speed for this leg.' };
  }
  const rLJ = rateOf(lj, systemId);
  const rRival = rateOf(rival, systemId);
  const margin = (vLJ / vRival) * (rRival / rLJ) - 1;   // + = LJ wins
  const pct = margin * 100;
  const tier = confidence(lj, rival, systemId, { tws, courseType });
  return { status: 'ok', margin, pct, tier, band: asBand(pct, tier) };
}

// ---- Whole-course margin (aggregate on TIME, not on margins) ----------------
// legs: [{ distanceNm, speedLJ, speedRival }]  (speeds at that leg's TWA/TWS)
// Sum each boat's leg TIMES -> total elapsed -> apply the rating to the TOTALS -> compare.
// Averaging per-leg margins is wrong: slow legs dominate elapsed time.
export function courseMargin(lj, rival, { legs, systemId, courseType = 'windward_leeward', tws = null }) {
  const g = guard(lj, rival, systemId, tws);
  if (g) return g;
  if (!Array.isArray(legs) || legs.length === 0) return { status: 'no_legs' };
  let elapsedLJ = 0, elapsedRival = 0;
  for (const leg of legs) {
    if (!(leg.speedLJ > 0) || !(leg.speedRival > 0) || !(leg.distanceNm > 0)) {
      return { status: 'no_speed', reason: 'A leg is missing distance or speed.' };
    }
    elapsedLJ += leg.distanceNm / leg.speedLJ;
    elapsedRival += leg.distanceNm / leg.speedRival;
  }
  const rLJ = rateOf(lj, systemId);
  const rRival = rateOf(rival, systemId);
  // corrected = elapsed * rate ; lower wins ; margin = corrected_rival/corrected_LJ - 1
  const correctedLJ = elapsedLJ * rLJ;
  const correctedRival = elapsedRival * rRival;
  const margin = correctedRival / correctedLJ - 1;      // + = LJ wins
  const pct = margin * 100;
  const tier = confidence(lj, rival, systemId, { tws, courseType });
  return { status: 'ok', margin, pct, tier, band: asBand(pct, tier), elapsedLJ, elapsedRival };
}

// ---- Interpolation --------------------------------------------------------
// The ORC VPP solves the boat at 7 discrete wind nodes (6/8/10/12/14/16/20 kt).
// Any wind in between (7, 9, 11, 15, 18, 19 …) is linear-interpolated between the
// bracketing nodes — the standard routing/scoring approach (~0.1 kt accurate). No
// extrapolation below the first node (the cert has no data under 6 kt).
export function interp(arr, grid, x) {
  if (!Array.isArray(arr) || !Array.isArray(grid) || arr.length !== grid.length) return null;
  if (!Number.isFinite(x)) return null;
  if (x < grid[0]) return null;
  if (x >= grid[grid.length - 1]) return arr[arr.length - 1];
  for (let k = 1; k < grid.length; k++) {
    if (x <= grid[k]) {
      const t = (x - grid[k - 1]) / (grid[k] - grid[k - 1]);
      return arr[k - 1] + t * (arr[k] - arr[k - 1]);
    }
  }
  return arr[arr.length - 1];
}

// Boat speed at a point of sail and (possibly interpolated) TWS.
// angle: 'beat' | 'run' | '52'|'60'|'75'|'90'|'110'|'120'|'135'|'150'
export function polarSpeed(boat, angle, tws, grid) {
  const p = boat?.polar; if (!p) return null;
  const row = angle === 'beat' ? p.beat_vmg : angle === 'run' ? p.run_vmg : p.reach?.[angle];
  return row ? interp(row, grid, tws) : null;
}

// Corrected-time margin at an (angle, tws) with interpolation — the convenience the UI calls.
export function compareAt(lj, rival, { angle, tws, systemId, grid }) {
  const courseType = (angle === 'beat' || angle === 'run') ? 'windward_leeward' : 'reaching';
  const vLJ = polarSpeed(lj, angle, tws, grid);
  const vRival = polarSpeed(rival, angle, tws, grid);
  return legMargin(lj, rival, { vLJ, vRival, systemId, tws, courseType });
}

export { SYSTEMS, rateOf };
