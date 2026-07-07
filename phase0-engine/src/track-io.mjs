// track-io.mjs — ingest GPS tracks (GPX or KML/gx:Track, e.g. a SuiviRegate export) into per-boat
// time-position series, and compute speed/distance stats. Pure, no deps.
//
// A SuiviRegate KMZ is a zipped KML — unzip it first (in the shell: `unzip -p file.kmz`), then pass
// the KML string to parseKML. GPX exports go straight to parseGPX. Both return the same shape:
//   [{ name, points: [{ t:ms|null, lat, lon }] }]
//
// With fix timestamps you get real speed-over-ground per leg (great-circle distance / dt). Turning
// that into per-leg VMG needs the wind + the course marks — a further step (the SuiviRegate fixes
// are ~60–120 s apart → good for leg-average VMG, too coarse for instantaneous polars).

const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };

export function parseGPX(xml) {
  const tracks = [];
  const trkRe = /<trk\b[^>]*>([\s\S]*?)<\/trk>/g;
  let m;
  while ((m = trkRe.exec(xml))) {
    const body = m[1];
    const name = (body.match(/<name>([^<]*)<\/name>/) || [])[1] || '';
    const points = [];
    const ptRe = /<trkpt\b[^>]*?lat="([\-\d.]+)"[^>]*?lon="([\-\d.]+)"[^>]*?(\/>|>([\s\S]*?)<\/trkpt>)/g;
    let p;
    while ((p = ptRe.exec(body))) {
      const inner = p[4] || '';
      const tm = (inner.match(/<time>([^<]+)<\/time>/) || [])[1];
      points.push({ t: tm ? Date.parse(tm) : null, lat: num(p[1]), lon: num(p[2]) });
    }
    if (points.length) tracks.push({ name, points });
  }
  return tracks;
}

export function parseKML(xml) {
  const tracks = [];
  const pmRe = /<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/g;
  let m;
  while ((m = pmRe.exec(xml))) {
    const body = m[1];
    const name = (body.match(/<name>([^<]*)<\/name>/) || [])[1] || '';
    const points = [];
    const whens = [...body.matchAll(/<when>([^<]+)<\/when>/g)].map((x) => Date.parse(x[1]));
    const coords = [...body.matchAll(/<gx:coord>([^<]+)<\/gx:coord>/g)].map((x) => x[1].trim().split(/\s+/).map(Number));
    if (coords.length) {
      coords.forEach((c, i) => points.push({ t: Number.isFinite(whens[i]) ? whens[i] : null, lon: c[0], lat: c[1] }));
    } else {
      const cs = (body.match(/<coordinates>([\s\S]*?)<\/coordinates>/) || [])[1];
      if (cs) cs.trim().split(/\s+/).forEach((tok) => { const [lon, lat] = tok.split(',').map(Number); if (Number.isFinite(lat)) points.push({ t: null, lon, lat }); });
    }
    if (points.length) tracks.push({ name, points });
  }
  return tracks;
}

// Auto-detect and parse.
export function parseTrack(xml) {
  return /<gpx\b|<trkpt\b/i.test(xml) ? parseGPX(xml) : parseKML(xml);
}

const R = 6371000, toRad = (d) => d * Math.PI / 180;
const M2NM = 1 / 1852, MS2KN = 3600 / 1852;

// Great-circle distance between two {lat,lon} in metres.
export function haversine(a, b) {
  const dphi = toRad(b.lat - a.lat), dlam = toRad(b.lon - a.lon);
  const s = Math.sin(dphi / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dlam / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Distance / duration / speed stats for one track.
export function trackStats(track) {
  const p = track.points.filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));
  let dist = 0; const legSpeeds = [];
  for (let i = 1; i < p.length; i++) {
    const d = haversine(p[i - 1], p[i]);
    dist += d;
    if (p[i].t && p[i - 1].t) { const dt = (p[i].t - p[i - 1].t) / 1000; if (dt > 0) legSpeeds.push(d / dt * MS2KN); }
  }
  const dur = (p.length >= 2 && p[0].t && p[p.length - 1].t) ? (p[p.length - 1].t - p[0].t) / 1000 : null;
  const avg = legSpeeds.length ? legSpeeds.reduce((a, b) => a + b, 0) / legSpeeds.length : null;
  return {
    name: track.name,
    fixes: p.length,
    distance_nm: dist * M2NM,
    duration_s: dur,
    avgSpeed_kn: avg,                                        // mean of per-fix speeds
    maxSpeed_kn: legSpeeds.length ? Math.max(...legSpeeds) : null,
    speedMadeGood_kn: (dur && dist) ? dist / dur * MS2KN : null, // total distance / total time
  };
}

export function fleetStats(tracks) {
  return tracks.map(trackStats).sort((a, b) => (b.distance_nm || 0) - (a.distance_nm || 0));
}
