// polar-performance.mjs — the "where are we weak?" engine.
//
// Given time-samples of {tws, twa, boatspeed} — from the boat's own instrument log (STW + true
// wind, once the YDWG-02 is in) OR from GPS speed-over-ground + a wind overlay for a past race —
// it scores each sample as a percentage of Little Johnka's polar target, then bins by TWS band ×
// point of sail. The output is a weakness map: the (wind, angle) cells where we consistently sail
// below our polar. This is what turns "we felt slow in the light" into a measured, targeted fix.
//
// Honest scope: this measures BOATSPEED vs polar. It does not judge tactics (which side, when to
// gybe) — for that you compare tracks (see track-analyze). Both together separate "slow" from
// "wrong side". On beat/run the comparison is VMG (measuredSpeed); on reaching it's boatspeed.

import { polarSpeed } from './engine.mjs';
import { pointOfSail } from './live-state.mjs';
import { measuredSpeed } from './live-race.mjs';

// TWS bands (kt). Light air is split finely because that's where the polar is hardest to hold.
export const TWS_BANDS = [[0, 6, '<6'], [6, 8, '6–8'], [8, 10, '8–10'], [10, 12, '10–12'], [12, 16, '12–16'], [16, 99, '16+']];
export function bandOf(tws) {
  const b = TWS_BANDS.find((x) => tws >= x[0] && tws < x[1]);
  return b ? b[2] : null;
}

// Percentage of polar for one sample (VMG-matched on beat/run). Returns null if unusable
// (below the VPP floor, missing data, or no polar at that angle).
export function samplePolarPct(boat, { tws, twa, boatspeed }, grid) {
  if (tws == null || twa == null || boatspeed == null || tws < 4) return null;
  const pos = pointOfSail(twa);
  if (!pos) return null;
  const target = polarSpeed(boat, pos, tws, grid);
  if (!(target > 0)) return null;
  const measured = measuredSpeed(boatspeed, twa, pos);
  return { pos, band: bandOf(tws), pct: (measured / target) * 100 };
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// Aggregate samples into the weakness map. minN = ignore thin cells when ranking weakest.
export function weaknessMap(boat, samples, grid, { minN = 3 } = {}) {
  const cells = {}, byBand = {}, byPos = {};
  let used = 0;
  for (const s of samples) {
    const r = samplePolarPct(boat, s, grid);
    if (!r || r.band == null) continue;
    used++;
    (cells[`${r.band}|${r.pos}`] = cells[`${r.band}|${r.pos}`] || []).push(r.pct);
    (byBand[r.band] = byBand[r.band] || []).push(r.pct);
    (byPos[r.pos] = byPos[r.pos] || []).push(r.pct);
  }
  const cellArr = Object.entries(cells).map(([k, v]) => {
    const [band, pos] = k.split('|');
    return { band, pos, avgPct: +mean(v).toFixed(1), n: v.length };
  });
  const bands = TWS_BANDS.map((b) => b[2]).filter((b) => byBand[b])
    .map((band) => ({ band, avgPct: +mean(byBand[band]).toFixed(1), n: byBand[band].length }));
  const byPoint = Object.entries(byPos).map(([pos, v]) => ({ pos, avgPct: +mean(v).toFixed(1), n: v.length }));
  const weakest = cellArr.filter((c) => c.n >= minN).sort((a, b) => a.avgPct - b.avgPct).slice(0, 5);
  return { samplesUsed: used, cells: cellArr, bands, byPoint, weakest, overallPct: used ? +mean(Object.values(byBand).flat()).toFixed(1) : null };
}
