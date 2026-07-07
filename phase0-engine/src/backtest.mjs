// backtest.mjs — validate the corrected-time engine + our ratings against a real regatta result,
// and decompose Little Johnka's finish into boatspeed vs rating vs result. Pure, no DOM.
//
// Feed it a class's official results (per boat: a rating + elapsed time). It (1) recomputes
// corrected time = elapsed × rate and the ranking, so you can confirm it reproduces the official
// scoring; (2) decomposes LJ vs every other boat into elapsed gap (pure boatspeed, valid for a
// mass start), rating gap, and corrected gap (the result); (3) flags any boat whose race rating
// differs from our boats.json value (refTcf) — that's how the Esse 850 error was caught.

import { SYSTEMS } from './ratings.mjs';

// "D:HH:MM:SS" or "HH:MM:SS" -> seconds.
export function parseHMS(str) {
  const p = String(str).trim().split(':').map(Number);
  while (p.length < 4) p.unshift(0);
  const [d, h, m, s] = p;
  return d * 86400 + h * 3600 + m * 60 + s;
}

// speed-rating for an entry under a system (higher = faster), or null.
export function rateFor(entry, systemId) {
  const sys = SYSTEMS[systemId];
  if (!sys) throw new Error(`Unknown system ${systemId}`);
  const v = entry[sys.field];              // 'gph' | 'tcf' | 'ys'
  return (v == null || !Number.isFinite(v) || v <= 0) ? null : sys.rate(v);
}

// entries: [{ name, type?, tcf?/gph?/ys?, elapsedSec, officialRank?, officialCorrectedSec?, refTcf? }]
export function backtest(entries, { systemId = 'SRS', ljName } = {}) {
  const rows = entries.map((e) => {
    const rate = rateFor(e, systemId);
    const corrected = (rate != null && e.elapsedSec > 0) ? e.elapsedSec * rate : null;
    return { ...e, rate, corrected };
  });

  const ranked = rows.filter((r) => r.corrected != null).sort((a, b) => a.corrected - b.corrected);
  ranked.forEach((r, i) => { r.ourRank = i + 1; });

  const lj = rows.find((r) => r.name === ljName);
  const decomp = lj ? rows.filter((r) => r !== lj && r.corrected != null).map((r) => ({
    name: r.name, type: r.type, ourRank: r.ourRank, officialRank: r.officialRank,
    elapsedGapPct: (lj.elapsedSec / r.elapsedSec - 1) * 100,   // + = LJ slower on the water
    ratingGapPct: (r.rate / lj.rate - 1) * 100,                // + = rival rated faster
    correctedGapPct: (lj.corrected / r.corrected - 1) * 100,   // + = LJ behind on corrected
  })).sort((a, b) => a.correctedGapPct - b.correctedGapPct) : [];

  // rating-data flags: race rating vs our stored refTcf (SRS only)
  const flags = rows.filter((r) => systemId === 'SRS' && r.refTcf != null && r.tcf != null
    && Math.abs(r.refTcf - r.tcf) > 0.002)
    .map((r) => ({ name: r.name, type: r.type, raceTcf: r.tcf, ourTcf: r.refTcf, delta: +(r.tcf - r.refTcf).toFixed(3) }));

  // how well our recomputed corrected reproduces the official corrected order
  const withOfficial = rows.filter((r) => r.officialRank != null && r.corrected != null);
  const ourOrder = [...withOfficial].sort((a, b) => a.corrected - b.corrected).map((r) => r.name);
  const offOrder = [...withOfficial].sort((a, b) => a.officialRank - b.officialRank).map((r) => r.name);
  const orderMatches = JSON.stringify(ourOrder) === JSON.stringify(offOrder);

  return { rows: ranked, lj, decomp, flags, reproducesOfficialOrder: orderMatches };
}
