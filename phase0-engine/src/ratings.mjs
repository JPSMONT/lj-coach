// ratings.mjs — rating-system definitions for the LJ Coach corrected-time engine.
//
// Every rating here is a "speed-rating": HIGHER = FASTER boat.
//   ORC:       rate = 1 / GPH        (lower GPH = faster boat = higher rate)
//   SRS:       rate = TCF            (higher TCF = faster boat, per the ACVL rule)
//   Yardstick: rate = 100 / YS       (lower YS = faster boat = higher rate)
//
// Corrected time (time-on-time):  corrected = elapsed_time * rate   ... LOWER corrected wins.
// (A faster boat has a higher rate, so its short elapsed time is scaled up to compare fairly.)
//
// This file only DEFINES how a rating maps to a rate. The number for each boat lives in the
// boat data (data/boats.json). Do not hard-code boat numbers here.

export const SYSTEMS = {
  ORC: {
    id: 'ORC',
    field: 'gph',                 // boat.ratings.gph  (seconds/NM)
    rate: (v) => 1 / v,           // higher rate = faster
    label: 'ORC single-number (GPH)',
  },
  SRS: {
    id: 'SRS',
    field: 'tcf',                 // boat.ratings.tcf  (Surprise = 1.000 base)
    rate: (v) => v,               // higher TCF = faster
    label: 'Swiss Rating System (applied Std TCF)',
  },
  YARDSTICK: {
    id: 'YARDSTICK',
    field: 'ys',                  // boat.ratings.ys
    rate: (v) => 100 / v,         // lower YS = faster
    label: 'Swiss-Sailing Yardstick',
  },
};

// Return the speed-rating (higher = faster) for a boat under a system, or null if the boat
// has no number for that system (e.g. a Zürichsee sportboat has no SRS TCF).
export function rateOf(boat, systemId) {
  const sys = SYSTEMS[systemId];
  if (!sys) throw new Error(`Unknown rating system: ${systemId}`);
  const raw = boat?.ratings?.[sys.field];
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;
  return sys.rate(raw);
}
