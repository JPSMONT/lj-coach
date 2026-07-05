// course-io.mjs — serialize / validate a saved race course. Pure, no DOM, no engine.
//
// A saved course is a small JSON file the UI can download and re-open:
//   { "type":"lj-coach-course", "version":1, "name":"Zugersee W/L",
//     "wind":12, "system":"ORC",
//     "legs":[ {"angle":"beat","distanceNm":1.5}, {"angle":"run","distanceNm":1.5} ] }
//
// parseCourse is deliberately strict-but-forgiving: it rejects a file that isn't a
// course, drops individual legs that are malformed, and clamps wind / whitelists the
// rating system — so a hand-edited or partial file can't push bad values into the engine.

export const COURSE_ANGLES = ['beat', '52', '60', '75', '90', '110', '120', '135', '150', 'run'];
const ANGLESET = new Set(COURSE_ANGLES);
const SYSTEMS_OK = ['ORC', 'SRS', 'YARDSTICK'];
const WIND_MIN = 6, WIND_MAX = 20;

// legs may arrive in UI shape {a,d} or file shape {angle,distanceNm}; normalize to file shape.
export function serializeCourse({ name = '', wind, system, legs }) {
  return {
    type: 'lj-coach-course',
    version: 1,
    name: String(name || ''),
    wind,
    system,
    legs: (legs || []).map((l) => ({
      angle: l.angle ?? l.a,
      distanceNm: Number(l.distanceNm ?? l.d),
    })),
  };
}

// Returns { legs:[{a,d}], wind, system, name }. Throws on an unusable file.
// `defaults` supplies wind/system when the file omits (or has invalid) values.
export function parseCourse(obj, defaults = {}) {
  if (!obj || typeof obj !== 'object') throw new Error('not a course file');
  if (obj.type && obj.type !== 'lj-coach-course') throw new Error('unrecognised file type');
  if (!Array.isArray(obj.legs) || obj.legs.length === 0) throw new Error('no legs in file');

  // Drop malformed legs (unknown angle, or a distance that isn't a positive finite number)
  // rather than silently coercing bad data into a plausible-looking value.
  const legs = obj.legs
    .map((l) => ({ a: String(l.angle), d: Number(l.distanceNm) }))
    .filter((l) => ANGLESET.has(l.a) && Number.isFinite(l.d) && l.d > 0);
  if (legs.length === 0) throw new Error('legs invalid (bad angle or distance)');

  const wRaw = Number(obj.wind);
  const wind = Number.isFinite(wRaw)
    ? Math.min(WIND_MAX, Math.max(WIND_MIN, Math.round(wRaw)))
    : (defaults.wind ?? 10);

  const system = SYSTEMS_OK.includes(obj.system) ? obj.system : (defaults.system ?? 'ORC');
  const name = typeof obj.name === 'string' ? obj.name : '';

  return { legs, wind, system, name };
}
