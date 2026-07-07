// wind-overlay.mjs — turn a GPS track + a wind field into {tws, twa, boatspeed} samples that
// feed the polar-performance weakness map. This is how a PAST race (GPS only, no on-boat wind)
// gets a polar-% read: overlay a modelled wind field on the track.
//
// Pipeline: track fixes → per-fix course-over-ground + speed-over-ground → look up the wind at
// that place & time → true wind angle = |windFromDir − COG|, true wind speed = model speed,
// boatspeed ≈ SOG. Feed the samples to weaknessMap.
//
// Honest caveats (the numbers inherit these): (1) model wind (e.g. AROME 1.3 km / ERA5 25 km) is
// the synoptic/mesoscale wind, not the exact racing wind — it smooths lake thermals, shore
// convergence and gusts; (2) COG ≠ heading and SOG ≠ STW (no current/leeway correction) — fine on
// a near-currentless lake but not exact. Treat the result as INDICATIVE. The boat's own instrument
// log (YDWG-02: STW + measured true wind) is the definitive source and needs none of this.

import { haversine } from './track-io.mjs';

const MS2KN = 3600 / 1852, R2D = 180 / Math.PI, D2R = Math.PI / 180;
const norm180 = (a) => { a = ((a + 180) % 360 + 360) % 360 - 180; return a; };

function bearing(a, b) {
  const p1 = a.lat * D2R, p2 = b.lat * D2R, dl = (b.lon - a.lon) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

// Per-fix course-over-ground (deg) + speed-over-ground (kn) via centered differences.
export function courseSpeed(points) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const d = haversine(a, b), dt = (b.t - a.t) / 1000;
    out.push({ t: points[i].t, lat: points[i].lat, lon: points[i].lon,
      cog: d > 1 ? bearing(a, b) : null, sog: dt > 0 ? d / dt * MS2KN : null });
  }
  return out;
}

// windSeries: [{lat, lon, hours:[{t, speed_kn, dir_deg}]}]. Nearest station in space, linear in time.
export function windAt(windSeries, lat, lon, t) {
  let st = null, best = Infinity;
  for (const s of windSeries) { const d = (s.lat - lat) ** 2 + (s.lon - lon) ** 2; if (d < best) { best = d; st = s; } }
  if (!st || !st.hours.length) return null;
  const h = st.hours;
  let i = 0; while (i < h.length - 1 && h[i + 1].t <= t) i++;
  const a = h[i], b = h[Math.min(h.length - 1, i + 1)];
  if (t <= a.t) return { speed_kn: a.speed_kn, dir_deg: a.dir_deg };
  if (t >= b.t || b === a) return { speed_kn: b.speed_kn, dir_deg: b.dir_deg };
  const f = (t - a.t) / (b.t - a.t);
  const speed = a.speed_kn + f * (b.speed_kn - a.speed_kn);
  const dir = a.dir_deg + f * norm180(b.dir_deg - a.dir_deg);   // shortest-arc interpolation
  return { speed_kn: speed, dir_deg: (dir + 360) % 360 };
}

// track (track-io shape) + windSeries → [{t, tws, twa, boatspeed}] for polar-performance.
export function deriveSamples(track, windSeries, { minSog = 0.5 } = {}) {
  const out = [];
  for (const p of courseSpeed(track.points)) {
    if (p.cog == null || p.sog == null || p.sog < minSog) continue;
    const w = windAt(windSeries, p.lat, p.lon, p.t);
    if (!w) continue;
    out.push({ t: p.t, tws: w.speed_kn, twa: Math.abs(norm180(w.dir_deg - p.cog)), boatspeed: p.sog });
  }
  return out;
}

// Parse an Open-Meteo hourly response (single object or an array of locations) into windSeries.
// Expects hourly.wind_speed_10m (kn) + hourly.wind_direction_10m (deg-from) + hourly.time.
export function parseOpenMeteo(json) {
  const arr = Array.isArray(json) ? json : [json];
  return arr.map((loc) => {
    const h = loc.hourly || {};
    const times = (h.time || []).map((s) => Date.parse(/[zZ]$/.test(s) ? s : s + ':00Z'));
    return {
      lat: loc.latitude, lon: loc.longitude,
      hours: times.map((t, i) => ({ t, speed_kn: h.wind_speed_10m[i], dir_deg: h.wind_direction_10m[i] })),
    };
  });
}
