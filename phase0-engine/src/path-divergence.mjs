// path-divergence.mjs — the "where did my ROUTE cost me?" engine for long out-and-back races.
//
// On a long course the boats that beat you often did so by choosing a different side of the lake, not
// by pure speed. This compares Little Johnka's track against the boats that finished ahead on corrected
// time and measures, leg by leg, which shore LJ was on relative to them — turning a pile of GPS lines
// into one actionable lesson ("on the return you were N m north of the boats that beat you → commit to
// the south/French shore earlier"). Only meaningful on long courses; see feedback_short_vs_long_analysis.
//
// Input tracks are [t_sec, lon, lat] (the Rivals-tab shape). Léman runs ~WSW–ENE, so at a matched
// longitude a higher latitude = the NORTH (Vaud/Swiss) shore, lower = SOUTH (Savoie/French). The race
// is out-and-back around an eastern mark, so each track is split at its easternmost fix (the rounding)
// into an outbound and a return leg before comparing — the same longitude occurs on both.

const M_PER_DEG_LAT = 111320;

export function parseDur(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/(?:(\d+)\s*d\s*)?(\d+):(\d+):(\d+)/);
  if (!m) return null;
  return (+(m[1] || 0)) * 86400 + (+m[2]) * 3600 + (+m[3]) * 60 + (+m[4]);
}

// Split a track [t,lon,lat] at its easternmost (max-lon) fix → { outbound, return_ } as [lon,lat] pairs.
export function splitAtMark(pts) {
  let iMax = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i][1] > pts[iMax][1]) iMax = i;
  const ll = (p) => [p[1], p[2]];
  return { outbound: pts.slice(0, iMax + 1).map(ll), return_: pts.slice(iMax).map(ll) };
}

// lat as a function of lon over a leg (points sorted & deduped by lon; linear interpolation).
function latOfLon(leg) {
  const by = new Map();
  for (const [lon, lat] of leg) { if (!by.has(lon)) by.set(lon, []); by.get(lon).push(lat); }
  const xs = [...by.keys()].sort((a, b) => a - b);
  const ys = xs.map((x) => { const a = by.get(x); return a.reduce((s, v) => s + v, 0) / a.length; });
  return { xs, ys, min: xs[0], max: xs[xs.length - 1],
    at(x) {
      if (x <= xs[0]) return ys[0]; if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
      let i = 1; while (xs[i] < x) i++;
      const f = (x - xs[i - 1]) / (xs[i] - xs[i - 1]); return ys[i - 1] + f * (ys[i] - ys[i - 1]);
    } };
}

// Mean signed shore offset (LJ − rival) over the overlapping longitudes of one leg, in metres.
// +ve = LJ was NORTH (Vaud) of the rival; −ve = LJ was SOUTH (Savoie).
function legOffset(ljLeg, rivalLeg, samples = 40) {
  if (ljLeg.length < 2 || rivalLeg.length < 2) return null;
  const A = latOfLon(ljLeg), B = latOfLon(rivalLeg);
  const lo = Math.max(A.min, B.min), hi = Math.min(A.max, B.max);
  if (!(hi > lo)) return null;
  let sum = 0, n = 0;
  for (let k = 0; k <= samples; k++) { const x = lo + (hi - lo) * k / samples; sum += (A.at(x) - B.at(x)); n++; }
  return { offset_m: (sum / n) * M_PER_DEG_LAT, nSamples: n, lonSpan: [lo, hi] };
}

const side = (m) => (m >= 0 ? 'N (Vaud / Swiss)' : 'S (Savoie / French)');

// Full analysis. lj = { label, pts }; rivals = [{ label, corr, pts, role }]. ljCorr = LJ corrected string.
// Returns { beaters, legs:[{leg, meanOffset_m, side, perRival:[{label,offset_m}] }], headline }.
export function analyzeDivergence(lj, rivals, ljCorr) {
  const ljSec = parseDur(ljCorr);
  const beaters = rivals.filter((r) => r.pts && r.pts.length > 5 && parseDur(r.corr) != null && ljSec != null && parseDur(r.corr) < ljSec);
  const ljSplit = splitAtMark(lj.pts);
  const legs = [];
  for (const [key, name] of [['outbound', 'Outbound (up-lake to the mark)'], ['return_', 'Return (mark back to the finish)']]) {
    const per = [];
    for (const r of beaters) {
      const rs = splitAtMark(r.pts)[key];
      const o = legOffset(ljSplit[key], rs);
      if (o) per.push({ label: r.label, offset_m: o.offset_m });
    }
    if (per.length) {
      const mean = per.reduce((s, p) => s + p.offset_m, 0) / per.length;
      legs.push({ leg: name, key, meanOffset_m: mean, side: side(mean), perRival: per.sort((a, b) => a.offset_m - b.offset_m) });
    }
  }
  const worst = legs.slice().sort((a, b) => Math.abs(b.meanOffset_m) - Math.abs(a.meanOffset_m))[0];
  const headline = worst
    ? `${worst.leg}: LJ averaged ${Math.round(Math.abs(worst.meanOffset_m))} m ${worst.meanOffset_m >= 0 ? 'NORTH (Vaud)' : 'SOUTH (Savoie)'} of the ${beaters.length} boats that beat you — they committed to the ${worst.meanOffset_m >= 0 ? 'south / French' : 'north / Swiss'} shore. Follow them next time.`
    : 'Not enough overlapping track to judge the route split.';
  return { beaters: beaters.map((b) => b.label), legs, headline };
}
