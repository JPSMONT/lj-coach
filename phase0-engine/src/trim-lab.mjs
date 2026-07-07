// trim-lab.mjs — the Training / Trim Lab evaluator (PRD Pillar B, TrimRun schema §2.6).
//
// The loop this closes: the weakness map (polar-performance / session-log) says WHERE we're slow
// and the heel/trim overlay hints WHY. The Trim Lab is how you fix it — run the boat with setup A,
// then setup B, in the SAME conditions, and get an honest answer to "did B actually help?" with a
// significance flag instead of a gut feeling.
//
// Inputs are the same measured perf-samples the weakness map uses ({tws, twa, boatspeed, heel,
// trim}), so a run is just the slice of a SessionLog while a given setup was up. We compare A vs B
// as % of Little Johnka's polar (VMG-matched), only within a MATCHED condition bin (TWS × TWA), so
// we're not fooled by "B looked faster because the breeze filled". Significance is a permutation
// test — assumption-light, no t-distribution tables, deterministic under a seed — so a small,
// noisy on-water sample can't masquerade as a real gain.

import { samplePolarPct } from './polar-performance.mjs';

// Little Johnka's trim vocabulary — the SAME 18 controls the on-deck trim guide shows, grouped by
// system. A logged TrimRun.setup is keyed by these ids, so the guide, the setup log, and the A/B
// verdict all speak one language (and "what changed" between two setups is machine-readable).
export const TRIM_CONTROLS = [
  { id: 'backstay', n: 1, g: 'Mainsail', name: 'Backstay' },
  { id: 'mainsheet', n: 2, g: 'Mainsail', name: 'Mainsheet' },
  { id: 'traveller', n: 3, g: 'Mainsail', name: 'Traveller' },
  { id: 'cunningham', n: 4, g: 'Mainsail', name: 'Cunningham' },
  { id: 'outhaul', n: 5, g: 'Mainsail', name: 'Outhaul' },
  { id: 'vang', n: 6, g: 'Mainsail', name: 'Vang (kicker)' },
  { id: 'rig_tension', n: 7, g: 'Rig', name: 'Rig / forestay tension' },
  { id: 'jib_sheet', n: 8, g: 'Jib', name: 'Jib sheet' },
  { id: 'jib_lead', n: 9, g: 'Jib', name: 'Jib lead — in/out track' },
  { id: 'barber_hauler', n: 10, g: 'Jib', name: 'Barber-hauler' },
  { id: 'jib_halyard', n: 11, g: 'Jib', name: 'Jib halyard / luff' },
  { id: 'spin_guy', n: 12, g: 'Spinnaker (pole)', name: 'Guy / brace — pole fore/aft' },
  { id: 'pole_height', n: 13, g: 'Spinnaker (pole)', name: 'Pole height — mast ring' },
  { id: 'pole_angle', n: 14, g: 'Spinnaker (pole)', name: 'Pole angle — topping + downhaul' },
  { id: 'spin_sheet', n: 15, g: 'Spinnaker (pole)', name: 'Spinnaker sheet' },
  { id: 'tweakers', n: 16, g: 'Spinnaker (pole)', name: 'Tweakers (twinning lines)' },
  { id: 'spin_halyard', n: 17, g: 'Spinnaker (pole)', name: 'Spinnaker halyard' },
  { id: 'crew_weight', n: 18, g: 'Crew', name: 'Crew weight' },
];
export const TRIM_CONTROL_IDS = new Set(TRIM_CONTROLS.map((c) => c.id));

// Keep only recognised control ids; flag the rest (typo / unknown lever) instead of silently
// storing junk. Values are free (a real unit where a scale exists, else a 0–10 feel).
export function normalizeSetup(setup = {}) {
  const clean = {}, unknown = [];
  for (const [id, v] of Object.entries(setup)) {
    if (TRIM_CONTROL_IDS.has(id)) clean[id] = v; else unknown.push(id);
  }
  return { setup: clean, unknown };
}

// What actually changed between setup A and B — the controls whose value differs (or is present in
// only one). This is the "what did we change?" line for an A/B, and drives which icon to surface.
export function diffSetups(a = {}, b = {}) {
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = [];
  for (const id of ids) {
    if (a[id] === b[id]) continue;
    const c = TRIM_CONTROLS.find((x) => x.id === id);
    out.push({ id, n: c ? c.n : null, name: c ? c.name : id, from: a[id] ?? null, to: b[id] ?? null, known: !!c });
  }
  return out.sort((x, y) => (x.n ?? 99) - (y.n ?? 99));
}

// deterministic RNG (mulberry32) so the permutation p-value is reproducible in tests/CI.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

// Condition bin label for a sample — coarse TWS/TWA buckets so A/B compares like-for-like.
export function conditionBin(sample, { twsStep = 2, twaStep = 15 } = {}) {
  if (sample.tws == null || sample.twa == null) return null;
  const twaAbs = Math.abs(sample.twa);
  const lo = (v, step) => Math.floor(v / step) * step;
  return { tws_bin: `${lo(sample.tws, twsStep)}–${lo(sample.tws, twsStep) + twsStep}`, twa_bin: `${lo(twaAbs, twaStep)}–${lo(twaAbs, twaStep) + twaStep}` };
}

// Score a set of perf-samples as % of polar (+ heel/trim) — one setup's summary.
export function summarize(boat, samples, grid) {
  const pct = [], heel = [], trim = [];
  for (const s of samples) {
    const sc = samplePolarPct(boat, s, grid);   // null below the 4-kt / polar-floor guards
    if (!sc) continue;
    pct.push(sc.pct);
    if (s.heel != null) heel.push(Math.abs(s.heel));
    if (s.trim != null) trim.push(s.trim);
  }
  return {
    n: pct.length,
    meanPct: pct.length ? +mean(pct).toFixed(1) : null,
    meanHeel: heel.length ? +mean(heel).toFixed(1) : null,
    meanTrim: trim.length ? +mean(trim).toFixed(1) : null,
    _pct: pct,
  };
}

// Permutation test on the two %-of-polar samples: p = P(|Δ| this large under the null of no
// difference). Returns { p, iters }. Two-sided.
function permutationP(a, b, { iters = 5000, seed = 12345 } = {}) {
  const obs = Math.abs(mean(a) - mean(b));
  const pool = a.concat(b), na = a.length;
  const rand = rng(seed);
  let hits = 0;
  for (let k = 0; k < iters; k++) {
    // Fisher–Yates partial shuffle of the pool
    const p = pool.slice();
    for (let i = p.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    const d = Math.abs(mean(p.slice(0, na)) - mean(p.slice(na)));
    if (d >= obs - 1e-12) hits++;
  }
  return { p: (hits + 1) / (iters + 1), iters };
}

// Evaluate setup A vs setup B on matched conditions. aSamples/bSamples are perf-samples; if a
// condition bin is given, both are filtered to it first. Returns which is faster + significance.
export function evaluateAB(boat, aSamples, bSamples, grid, { minN = 8, alpha = 0.05, iters = 5000, seed = 12345, condition = null, setupA = null, setupB = null } = {}) {
  const inBin = (s) => { if (!condition) return true; const b = conditionBin(s); return b && b.tws_bin === condition.tws_bin && b.twa_bin === condition.twa_bin; };
  const A = summarize(boat, aSamples.filter(inBin), grid);
  const B = summarize(boat, bSamples.filter(inBin), grid);
  const under = A.n < minN || B.n < minN;
  let p = null, significant = false, faster = null, deltaPct = null;
  if (!under) {
    deltaPct = +(B.meanPct - A.meanPct).toFixed(1);
    ({ p } = permutationP(A._pct, B._pct, { iters, seed }));
    significant = p < alpha;
    faster = deltaPct > 0 ? 'B' : deltaPct < 0 ? 'A' : 'tie';
  }
  const note = under
    ? `inconclusive — need ≥${minN} scoreable samples per setup (have A=${A.n}, B=${B.n})`
    : significant ? `setup ${faster} is faster by ${Math.abs(deltaPct)} pp of polar (p=${p.toFixed(3)})`
      : `no significant difference (Δ=${deltaPct} pp, p=${p.toFixed(3)}) — keep testing or treat as equal`;
  const changed = (setupA && setupB) ? diffSetups(setupA, setupB) : null;
  return { a: { n: A.n, meanPct: A.meanPct, meanHeel: A.meanHeel, meanTrim: A.meanTrim },
    b: { n: B.n, meanPct: B.meanPct, meanHeel: B.meanHeel, meanTrim: B.meanTrim },
    deltaPct, faster, p, significant, underpowered: under, changed, note };
}

// Assemble a TrimRun record (Build Spec §2.6) from a setup + its samples.
export function makeTrimRun({ id, session_id, objective, setup = {}, condition = null, samples, boat, grid }) {
  const s = summarize(boat, samples, grid);
  const { setup: clean, unknown } = normalizeSetup(setup);   // keyed by TRIM_CONTROLS ids
  return {
    id, session_id, objective,
    setup: clean,                // e.g. { traveller: 'down 5cm', backstay: 6, jib_lead: 'out 1', pole_height: 'high' }
    setup_unknown: unknown,      // flagged, not silently dropped
    condition: condition || (samples[0] ? conditionBin(samples[0]) : null),
    result: { pct_target: s.meanPct, heel: s.meanHeel, trim: s.meanTrim, n: s.n, significance: null },
    owner_only_edit: true,
  };
}
