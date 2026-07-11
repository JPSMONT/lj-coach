// perf-verdict.mjs — auto-judge whether the boat was FAST at the moment of a Trim Check photo, so the
// personal fast-shape library fills itself. "Fast" = boatspeed at/above the polar target for the wind &
// angle. Self-contained (own polar interp + true-wind + point-of-sail) so it needs no other modules —
// just the boat's polar (embedded in the sail data). Pure, no deps.
//
// When the live instrument feed is present the app can auto-save without a tap; with manually entered
// conditions it pre-selects the suggested verdict and the skipper confirms.

const REACH = [52, 60, 75, 90, 110, 120, 135, 150];
function interpPolar(arr, grid, x) {
  if (!arr || !arr.length) return null;
  if (x <= grid[0]) return arr[0];
  if (x >= grid[grid.length - 1]) return arr[arr.length - 1];
  for (let i = 1; i < grid.length; i++) if (x <= grid[i]) { const t = (x - grid[i - 1]) / (grid[i] - grid[i - 1]); return arr[i - 1] + t * (arr[i] - arr[i - 1]); }
  return arr[arr.length - 1];
}
function pointOfSail(twa) { const a = Math.abs(twa); if (a <= 55) return 'beat'; if (a >= 158) return 'run'; let best = REACH[0]; for (const x of REACH) if (Math.abs(x - a) < Math.abs(best - a)) best = x; return String(best); }
function trueWind(awa, aws, bs) {
  if (awa == null || aws == null || bs == null) return null;
  const side = awa < 0 ? -1 : 1, a = Math.abs(awa) * Math.PI / 180;
  const tws = Math.sqrt(aws * aws + bs * bs - 2 * aws * bs * Math.cos(a));
  const twa = Math.atan2(aws * Math.sin(a), aws * Math.cos(a) - bs) * 180 / Math.PI;
  return { tws, twa: side * twa };
}

// pct of polar from conditions + a boat polar {grid, polar:{beat_vmg,run_vmg,reach{}}}.
// cond: { tws?, twa?, boatspeedKn, aws?, awa? } — derives tws/twa from apparent + boatspeed if needed.
// Returns { pct, pos, targetKn, measuredKn, tws, twa } or null when there isn't enough to judge.
export function pctOfPolar(cond, polarData) {
  const grid = polarData.grid || polarData.polar_grid, polar = polarData.polar;
  if (!grid || !polar) return null;
  let tws = cond.tws, twa = cond.twa; const bs = cond.boatspeedKn;
  if ((tws == null || twa == null) && cond.aws != null && cond.awa != null && bs != null) {
    const tw = trueWind(cond.awa, cond.aws, bs); if (tw) { if (tws == null) tws = tw.tws; if (twa == null) twa = tw.twa; }
  }
  if (tws == null || twa == null || bs == null || !(tws >= 6)) return null;   // below polar floor / missing data
  const pos = pointOfSail(twa);
  const row = pos === 'beat' ? polar.beat_vmg : pos === 'run' ? polar.run_vmg : (polar.reach && polar.reach[pos]);
  const target = interpPolar(row, grid, tws);
  if (!(target > 0)) return null;
  const a = Math.abs(twa) * Math.PI / 180;
  const measured = pos === 'beat' ? bs * Math.cos(a) : pos === 'run' ? bs * Math.abs(Math.cos(a)) : bs;   // VMG on beat/run, STW reaching
  return { pct: measured / target, pos, targetKn: +target.toFixed(2), measuredKn: +measured.toFixed(2), tws: +tws.toFixed(1), twa: Math.round(twa) };
}

// Map a pct-of-polar to a fast/slow verdict (blank in the ambiguous middle).
export function verdictFromPct(pct, fast = 0.985, slow = 0.94) { return pct == null ? '' : pct >= fast ? 'fast' : pct <= slow ? 'slow' : ''; }
