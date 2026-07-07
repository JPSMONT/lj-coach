// session-log.mjs — turn the boat's own recorded instrument stream into a SessionLog and then
// into REAL weakness-map samples (measured STW + measured true wind + heel/trim). This is the
// definitive feed the wind-overlay path was standing in for: no model wind, no SOG-for-boatspeed.
//
// Source of truth: the YDWG-02 Wi-Fi Gateway RAW stream (Appendix E format, already parsed by
// n2k-decode and verified by the n2k tests). On the water the below-deck iPhone reads the gateway
// over RAW/UDP and records it (Build Spec §4); the same text also comes off any Yacht Devices RAW
// export. We reduce that stream with the SAME live-state reducer the cockpit uses, sample it at
// 1 Hz into the frozen SessionLog schema (Build Spec §2.5), and hand it to the weakness map.
//
// Why this matters for coaching: because the samples carry measured heel and trim (pitch) from the
// DST810, weaknessWithTrim can report, for every (wind × angle) cell where LJ is below polar, what
// the heel and fore-aft trim were — the test that separates a trim/crew-weight problem from a
// helming one. That is the cause-finder the model-wind debrief could only gesture at.

import { decodeRawLine } from './n2k-decode.mjs';
import { initState, applyMessage, trueWindOf, pointOfSail, isStale } from './live-state.mjs';
import { measuredSpeed } from './live-race.mjs';
import { samplePolarPct, bandOf } from './polar-performance.mjs';

const norm360 = (a) => ((a % 360) + 360) % 360;
const secOfDay = (hms) => { const m = /(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(hms); if (!m) return null; return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (m[4] ? +`0.${m[4]}` : 0); };

// The SessionLog sample fields we populate (Build Spec §2.5). leeway/twd may be null (computed later).
const SAMPLE_FIELDS = ['lat', 'lon', 'sog', 'cog', 'stw', 'heel', 'pitch', 'twa', 'tws', 'twd', 'awa', 'aws'];

// Reduce a YDWG-02 RAW stream into a SessionLog (1 Hz by default).
// rawLines: string (newline-separated) or string[]. dateEpochMs anchors the time-of-day clock;
// pass the race date's midnight UTC in ms so sample.t is an absolute epoch (else t is ms-of-day).
export function streamToSessionLog(rawLines, { boat_id = 'lj', venue_id = null, dateEpochMs = 0, sampleMs = 1000, staleMs = 4000 } = {}) {
  const lines = Array.isArray(rawLines) ? rawLines : String(rawLines).split(/\r?\n/);
  let state = initState();
  const samples = [];
  let base = null, dayRolls = 0, prevSod = null, nextSampleAt = null, lastClock = null;
  const seen = {}; // field -> was it ever fresh

  const snapshot = (t, nowClock) => {
    const tw = trueWindOf(state) || {};
    const heading = state.heading_deg != null ? state.heading_deg : state.cog_deg;
    const twd = (tw.twa_deg != null && heading != null) ? +norm360(heading + tw.twa_deg).toFixed(1) : null;
    const s = { t };
    const put = (k, v) => { s[k] = (v == null ? null : +(+v).toFixed(k === 'lat' || k === 'lon' ? 6 : 2)); };
    put('lat', state.lat); put('lon', state.lon); put('sog', state.sog_kn); put('cog', state.cog_deg);
    put('stw', state.stw_kn); put('heel', state.heel_deg); put('pitch', state.trim_deg);
    put('twa', tw.twa_deg); put('tws', tw.tws_kn); s.twd = twd;
    put('awa', state.awa_deg); put('aws', state.aws_kn); s.leeway = null;
    // per-sample freshness → data_quality contribution
    for (const f of ['stw', 'heel', 'aws', 'sog']) {
      const stField = { stw: 'stw_kn', heel: 'heel_deg', aws: 'aws_kn', sog: 'sog_kn' }[f];
      if (s[f] != null && !isStale(state, stField, nowClock, staleMs)) seen[f] = true;
    }
    return s;
  };

  for (const line of lines) {
    const msg = decodeRawLine(line);
    if (!msg) continue;
    const sod = secOfDay(msg.time);
    if (sod == null) continue;
    if (prevSod != null && sod + 1e-6 < prevSod) dayRolls++;     // midnight rollover
    prevSod = sod;
    const clockMs = (dayRolls * 86400 + sod) * 1000;             // ms since first day's midnight
    if (base == null) { base = clockMs; nextSampleAt = clockMs; }
    // emit any sample boundaries the state has fully passed (snapshot reflects all prior messages)
    while (clockMs > nextSampleAt) {
      samples.push(snapshot(dateEpochMs + nextSampleAt, nextSampleAt));
      nextSampleAt += sampleMs;
    }
    state = applyMessage(state, msg, clockMs);
    lastClock = clockMs;
  }
  // flush remaining boundaries up to and including the last timestamp (final full state)
  while (base != null && nextSampleAt <= lastClock) {
    samples.push(snapshot(dateEpochMs + nextSampleAt, nextSampleAt));
    nextSampleAt += sampleMs;
  }
  const dq = {};
  for (const f of ['stw', 'heel', 'aws', 'sog']) dq[f] = seen[f] ? 'green' : 'grey';
  return {
    id: `session-${dateEpochMs || 0}`, boat_id, venue_id,
    start: samples.length ? samples[0].t : null, end: samples.length ? samples[samples.length - 1].t : null,
    samples, data_quality: dq,
  };
}

// SessionLog → weakness-map input samples, using MEASURED boatspeed (STW) and MEASURED true wind,
// and carrying heel + trim so the map can attribute a cause. minStw drops drifting/again-parked fixes.
export function sessionToPerf(session, { minStw = 0.5 } = {}) {
  const out = [];
  for (const s of session.samples || []) {
    if (s.stw == null || s.tws == null || s.twa == null || s.stw < minStw) continue;
    out.push({ t: s.t, tws: s.tws, twa: Math.abs(s.twa), boatspeed: s.stw,
      heel: s.heel == null ? null : Math.abs(s.heel), trim: s.pitch });
  }
  return out;
}

// Like weaknessMap, but each (band × point-of-sail) cell also reports mean heel and mean trim —
// so an under-polar cell can be read against how the boat was sitting. This is the trim/heel
// cause-finder: slow + over-heeled points at trim/crew weight; slow + normal heel points at helming.
export function weaknessWithTrim(boat, samples, grid, { minN = 3 } = {}) {
  const cells = new Map();
  for (const s of samples) {
    const sc = samplePolarPct(boat, s, grid);   // {pos, band, pct} or null (fires the sub-4kt/floor guards)
    if (!sc) continue;
    const key = `${sc.band}|${sc.pos}`;
    let c = cells.get(key);
    if (!c) { c = { band: sc.band, pos: sc.pos, n: 0, pctSum: 0, heelSum: 0, heelN: 0, trimSum: 0, trimN: 0 }; cells.set(key, c); }
    c.n++; c.pctSum += sc.pct;
    if (s.heel != null) { c.heelSum += s.heel; c.heelN++; }
    if (s.trim != null) { c.trimSum += s.trim; c.trimN++; }
  }
  const list = [...cells.values()].filter((c) => c.n >= minN).map((c) => ({
    band: c.band, pos: c.pos, n: c.n,
    avgPct: Math.round(c.pctSum / c.n),
    avgHeel: c.heelN ? +(c.heelSum / c.heelN).toFixed(1) : null,
    avgTrim: c.trimN ? +(c.trimSum / c.trimN).toFixed(1) : null,
  }));
  const weakest = [...list].sort((a, b) => a.avgPct - b.avgPct).slice(0, 6);
  const nAll = list.reduce((s, c) => s + c.n, 0);
  const overallPct = nAll ? Math.round(list.reduce((s, c) => s + c.avgPct * c.n, 0) / nAll) : null;
  return { cells: list, weakest, overallPct, samplesUsed: nAll };
}

export { SAMPLE_FIELDS };
