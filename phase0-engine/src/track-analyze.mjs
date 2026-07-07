// track-analyze.mjs — turn raw GPS tracks into race metrics: a fleet start estimate, a
// race-window-trimmed speed, and a which-shore tactical split. Pure; builds on track-io.
//
// Why trimming matters: a SuiviRegate track spans device-on to device-off (pre-start milling +
// post-finish drift), so raw average speed is diluted. We trim each boat to [fleetStart, fleetStart
// + officialElapsed] — the start is common (mass start), the elapsed is the authoritative result —
// so the speed is honest boat-for-boat. Shore split answers the classic Léman up-lake question:
// did the boat play the north (Vaud) or south (Savoie) shore?

import { haversine } from './track-io.mjs';

const M2NM = 1 / 1852, MS2KN = 3600 / 1852;

// Estimate the mass-start time as the median, across boats, of the first moment a boat makes
// sustained progress (> minNm over the next windowMs). Robust to pre-start milling.
export function detectStart(tracks, { minNm = 0.9, windowMs = 600000 } = {}) {
  const est = tracks.map((tk) => {
    const p = tk.points;
    for (let i = 0; i < p.length; i++) {
      let d = 0, j = i + 1;
      while (j < p.length && p[j].t - p[i].t <= windowMs) { d += haversine(p[j - 1], p[j]); j++; }
      if (d * M2NM > minNm) return p[i].t;
    }
    return p[0] && p[0].t;
  }).filter((x) => x != null).sort((a, b) => a - b);
  return est.length ? est[est.length >> 1] : null;
}

// Data-driven lake centerline: median latitude per longitude bin across the whole fleet.
export function centerlineFn(tracks, { binScale = 50 } = {}) {
  const bins = {};
  for (const tk of tracks) for (const p of tk.points) {
    const k = Math.round(p.lon * binScale);
    (bins[k] = bins[k] || []).push(p.lat);
  }
  return (lon) => {
    const a = bins[Math.round(lon * binScale)];
    if (!a) return null;
    const s = [...a].sort((x, y) => x - y);
    return s[s.length >> 1];
  };
}

// Trimmed race stats for one track. elapsedSec (official) preferred for the duration; the outbound
// leg is everything up to the max-longitude fix (the Le Bouveret turn), the return is after it.
export function raceStats(track, { startMs, endMs, elapsedSec = null, center = null }) {
  const p = track.points;
  const idx = [];
  for (let i = 0; i < p.length; i++) if (p[i].t >= startMs && p[i].t <= endMs) idx.push(i);
  if (idx.length < 5) return null;
  let dist = 0;
  for (let k = 1; k < idx.length; k++) dist += haversine(p[idx[k - 1]], p[idx[k]]);
  const dur = elapsedSec != null ? elapsedSec : (p[idx[idx.length - 1]].t - p[idx[0]].t) / 1000;
  let turn = idx[0], mx = -Infinity;
  for (const i of idx) if (p[i].lon > mx) { mx = p[i].lon; turn = i; }
  let oN = 0, oT = 0, rN = 0, rT = 0;
  if (center) for (const i of idx) {
    const c = center(p[i].lon); if (c == null) continue;
    const north = p[i].lat > c;
    if (i <= turn) { oT++; if (north) oN++; } else { rT++; if (north) rN++; }
  }
  return {
    dist_nm: +(dist * M2NM).toFixed(2),
    sog_kn: +(dist / dur * MS2KN).toFixed(2),
    outboundPctNorth: oT ? Math.round(oN / oT * 100) : null,
    returnPctNorth: rT ? Math.round(rN / rT * 100) : null,
  };
}
