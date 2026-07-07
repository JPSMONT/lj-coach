// polar-lightair.mjs — a MODELLED extension of Little Johnka's polar BELOW the ORC grid floor.
//
// Why this exists: LJ's ORC certificate publishes speeds only from 6 kt TWS upward. On Lake
// Geneva she races most of the time in less than that (the Bol d'Or 2026 debrief: 81% of the
// race was sub-6 kt), so the polar has nothing to compare against exactly where we most want a
// number. This module fills the 4–6 kt gap with a transparent, physically-anchored estimate —
// it is NOT certificate data and never overwrites it; it is generated on demand and carries a
// low-confidence flag so every downstream number can be labelled "modelled".
//
// The model (per angle, independent): fit a quadratic through the origin, V(t) = a·t + b·t²,
// pinned to two conditions at the lowest certified node (t0 = 6 kt):
//   (1) value    V(t0)  = v0            — joins the certified polar with no jump
//   (2) slope    V'(t0) = s = (v1−v0)/(t1−t0)   — joins it with no kink (t1 = 8 kt node)
// and forced through V(0)=0 (no wind → no speed). Solving:
//   b = (s·t0 − v0) / t0² ,  a = s − 2·b·t0.
// This carries the certified curve's own local behaviour into the light-air domain while
// obeying the two hard physical constraints (through the origin, continuous in value & slope).
//
// Guard: if the quadratic is non-monotonic or non-positive on (0, t0] for a given angle (can
// happen where the 6→8 kt slope is very steep), we fall back to LINEAR-to-origin from the
// anchor, V(t) = v0·t/t0 — the standard "hold your speed/wind ratio" light-air rule of thumb.
//
// Honest limits: the 6→8 kt secant slightly overstates the true tangent slope at 6 kt (the
// certified curve is concave), so this runs mildly OPTIMISTIC in the deep light; and no model
// replaces measured data. The boat's own YDVR-04 log (STW + true wind) is what will calibrate
// or retire this. We deliberately do NOT model below 4 kt — there the boat is often barely
// steerable and any curve is a guess; those samples stay off-polar.

export const LIGHTAIR_SUBGRID = [4, 5];   // the sub-6kt TWS nodes we model
export const LIGHTAIR_FLOOR = 4;          // below this: still unscoreable (off-polar)
export const LIGHTAIR_CONFIDENCE = 'modelled_lightair';

// Model one angle's light-air speed at TWS `t` (t < t0), from the two lowest certified nodes.
// Returns { v, method } where method is 'quadratic' or 'linear' (fallback).
export function lightAirSpeed(v0, v1, t0, t1, t) {
  const s = (v1 - v0) / (t1 - t0);
  const b = (s * t0 - v0) / (t0 * t0);
  const a = s - 2 * b * t0;
  const quad = a * t + b * t * t;
  // quadratic must be positive, below the anchor, and increasing toward it
  const slopeAtT = a + 2 * b * t;
  const ok = quad > 0 && quad < v0 && slopeAtT > 0;
  if (ok) return { v: quad, method: 'quadratic' };
  return { v: v0 * t / t0, method: 'linear' };
}

// Extend one certified speed row (aligned to `grid`) down to the sub-grid.
// Returns the modelled speeds at LIGHTAIR_SUBGRID, in that order.
export function extendRow(row, grid, subGrid = LIGHTAIR_SUBGRID) {
  const t0 = grid[0], t1 = grid[1], v0 = row[0], v1 = row[1];
  return subGrid.map((t) => +lightAirSpeed(v0, v1, t0, t1, t).v.toFixed(3));
}

// Build a full extended polar: a new polar object whose speed arrays (beat_vmg, run_vmg,
// reach.<angle>) are prefixed with the modelled sub-grid points, plus the extended tws grid.
// Angles (beat_angle/gybe_angle) are carried from the 6 kt node (they change little in light
// air, and this is flagged modelled anyway). The certified input is not mutated.
export function extendPolar(polar, grid, subGrid = LIGHTAIR_SUBGRID) {
  const ext = (row) => [...extendRow(row, grid, subGrid), ...row];
  const carry = (row) => [...subGrid.map(() => row[0]), ...row];
  const out = {
    beat_angle: carry(polar.beat_angle),
    beat_vmg: ext(polar.beat_vmg),
    run_vmg: ext(polar.run_vmg),
    reach: Object.fromEntries(Object.entries(polar.reach).map(([ang, row]) => [ang, ext(row)])),
    gybe_angle: polar.gybe_angle ? carry(polar.gybe_angle) : undefined,
  };
  return { polar: out, grid: [...subGrid, ...grid], subGrid, floor: LIGHTAIR_FLOOR, confidence: LIGHTAIR_CONFIDENCE };
}
