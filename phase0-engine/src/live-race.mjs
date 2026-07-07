// live-race.mjs — turn live boat state into racing numbers: are you hitting your polars,
// and given how you're ACTUALLY sailing right now, are you beating each rival on corrected time?
//
// Built on the audited engine (polarSpeed / legMargin / rateOf). "Live" margin differs from the
// Compare view: Compare assumes both boats sail their polars; live margin uses Little Johnka's
// MEASURED boatspeed against each rival's polar — so sailing below target shows up as lost margin.

import { legMargin, polarSpeed } from './engine.mjs';

const courseTypeOf = (angle) => (angle === 'beat' || angle === 'run') ? 'windward_leeward' : 'reaching';

// Put measured boatspeed into the SAME metric the polar uses at this point of sail, so a live
// comparison is apples-to-apples. Beat/Run polars are VMG (velocity made good up/downwind), so
// measured VMG = STW × |cos TWA|. Reaching polars are boatspeed, so STW is used directly.
export function measuredSpeed(stw_kn, twa_deg, angle) {
  if (stw_kn == null || twa_deg == null) return stw_kn;
  return (angle === 'beat' || angle === 'run')
    ? stw_kn * Math.abs(Math.cos(twa_deg * Math.PI / 180))
    : stw_kn;
}

// Target boatspeed from a boat's own polar at (point of sail, TWS).
export function polarTarget(boat, angle, tws, grid) {
  return polarSpeed(boat, angle, tws, grid);
}

// Percentage of polar target the boat is actually achieving (100% = on the number).
export function pctOfTarget(actualStw, target) {
  return (actualStw != null && target > 0) ? (actualStw / target) * 100 : null;
}

// Live corrected-time margin vs one rival using LJ's ACTUAL measured speed (+ = LJ ahead).
export function liveMargin(lj, rival, { actualStw, angle, tws, systemId, grid }) {
  const vRival = polarSpeed(rival, angle, tws, grid);
  return legMargin(lj, rival, { vLJ: actualStw, vRival, systemId, tws, courseType: courseTypeOf(angle) });
}

// Live margin vs a whole fleet, sorted best (most LJ-ahead) to worst.
export function liveFleet(lj, rivals, { actualStw, angle, tws, systemId, grid }) {
  return rivals
    .map((r) => ({ id: r.id, name: r.name, downwind_sail: r.downwind_sail, ...liveMargin(lj, r, { actualStw, angle, tws, systemId, grid }) }))
    .sort((a, b) => {
      if (a.status !== 'ok' && b.status !== 'ok') return 0;
      if (a.status !== 'ok') return 1;
      if (b.status !== 'ok') return -1;
      return b.pct - a.pct;
    });
}
