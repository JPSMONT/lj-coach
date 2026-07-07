// live-state.mjs — reduce the decoded N2K message stream into "current boat state",
// and derive the racing values the instruments don't send directly (true wind, point of sail).
//
// Pure and dependency-free. Feed it the objects from n2k-decode.mjs (decodeRawLine / decodeMessage);
// it keeps the latest value of each field plus a timestamp so the cockpit can grey out stale data.
//
// Sign convention: angles measured off the bow, negative = port, positive = starboard.
// True wind here is WATER-referenced (uses STW), the sailing-relevant reference; falls back to SOG.

const TO_RAD = Math.PI / 180, TO_DEG = 180 / Math.PI;

export function initState() { return { ts: {} }; }

// message.name (from n2k-decode) -> which state fields it updates.
const FIELD_MAP = {
  speedWaterReferenced: (m) => ({ stw_kn: m.stw_kn }),
  attitude:             (m) => ({ heel_deg: m.heel_deg, trim_deg: m.trim_deg }),
  waterDepth:           (m) => ({ depth_m: m.depth_m }),
  temperature:          (m) => ({ waterTemp_c: m.waterTemp_c }),
  temperatureExtended:  (m) => ({ waterTemp_c: m.waterTemp_c }),
  windData:             (m) => ({ aws_kn: m.windSpeed_kn, awa_deg: m.windAngle_deg }),
  cogSogRapid:          (m) => ({ sog_kn: m.sog_kn, cog_deg: m.cog_deg }),
  vesselHeading:        (m) => ({ heading_deg: m.heading_deg }),
  positionRapid:        (m) => ({ lat: m.lat_deg, lon: m.lon_deg }),
};

// Apply one decoded message; returns a new state (only non-null fields update, with a timestamp).
export function applyMessage(state, msg, now = Date.now()) {
  const map = FIELD_MAP[msg && msg.name];
  if (!map) return state;
  const upd = map(msg);
  const next = { ...state, ts: { ...(state.ts || {}) } };
  for (const [k, v] of Object.entries(upd)) {
    if (v != null) { next[k] = v; next.ts[k] = now; }
  }
  return next;
}

export function applyStream(state, msgs, now = Date.now()) {
  let s = state;
  for (const m of msgs) s = applyMessage(s, m, now);
  return s;
}

// A field is stale if never seen or older than maxAgeMs (cockpit greys these out).
export function isStale(state, field, now = Date.now(), maxAgeMs = 3000) {
  const t = state && state.ts && state.ts[field];
  return t == null || now - t > maxAgeMs;
}

// ---- derived: true wind (water-referenced) from apparent wind + boat speed ----
// TWS = sqrt(AWS² + BS² − 2·AWS·BS·cos AWA)
// TWA = atan2( AWS·sin AWA , AWS·cos AWA − BS )     (port/starboard sign preserved)
export function deriveTrueWind({ awa_deg, aws_kn, boatSpeed_kn }) {
  if (awa_deg == null || aws_kn == null || boatSpeed_kn == null) return null;
  const side = awa_deg < 0 ? -1 : 1;
  const a = Math.abs(awa_deg) * TO_RAD, aws = aws_kn, bs = boatSpeed_kn;
  const tws = Math.sqrt(aws * aws + bs * bs - 2 * aws * bs * Math.cos(a));
  const twa = Math.atan2(aws * Math.sin(a), aws * Math.cos(a) - bs) * TO_DEG;
  return { tws_kn: tws, twa_deg: side * twa };
}

// Convenience: derive true wind straight from a live state (uses STW, falls back to SOG).
export function trueWindOf(state) {
  const bs = state.stw_kn != null ? state.stw_kn : state.sog_kn;
  return deriveTrueWind({ awa_deg: state.awa_deg, aws_kn: state.aws_kn, boatSpeed_kn: bs });
}

// ---- derived: map a true-wind angle to the polar's point-of-sail key --------
const REACH = [52, 60, 75, 90, 110, 120, 135, 150];
export function pointOfSail(twa_deg) {
  if (twa_deg == null) return null;
  const a = Math.abs(twa_deg);
  if (a <= 55) return 'beat';
  if (a >= 158) return 'run';
  let best = REACH[0];
  for (const x of REACH) if (Math.abs(x - a) < Math.abs(best - a)) best = x;
  return String(best);
}
