// kwindoo-ingest.mjs — turn Kwindoo GPX exports into fleet tracks for the Debrief / Rivals path analysis.
//
// Kwindoo (kwindoo.com) is the tracker for Centomiglia 2026, Zugersee, and older Kékszalag editions.
// Each boat's export is a standard GPX <trk> — one file per boat — with two Kwindoo quirks:
//   • <metadata><desc> = "Kwindoo tracking - <Race> in <Race>"   (the race name, doubled)
//   • <trk><name>      = "Tracked route for <Skipper>"           (the boat's skipper)
// The raw GPX already parses via track-io.parseGPX into {name, points:[{t,lat,lon}]}; this module adds
// the Kwindoo-specific name/race cleanup and assembles several per-boat files into one fleet, then
// hands LJ's own track to the same weakness-map pipeline the Bol d'Or Debrief uses (wind-overlay +
// polar-performance) and the whole fleet to the Rivals map.
//
// WHY this matters only for long races: on a short Zugersee triangle every boat sails the same line, so
// a Zugersee GPX is only useful here as a PARSER TEST FIXTURE. The real payoff is Centomiglia/Garda,
// where rivals' route/shore/wind choices actually diverge. See feedback_short_vs_long_analysis.

import { parseGPX, trackStats, fleetStats } from './track-io.mjs';

const cleanRace = (xml) => {
  const desc = (xml.match(/<metadata\b[\s\S]*?<desc>([^<]*)<\/desc>/) || [])[1] || '';
  return desc.replace(/^\s*Kwindoo tracking\s*-\s*/i, '').replace(/\s+in\s+.*$/i, '').trim();
};
const cleanSkipper = (name) => (name || '').replace(/^\s*Tracked route for\s*/i, '').trim() || (name || '');

// One Kwindoo GPX (one boat) → { race, tracks:[{ name, skipper, points }] }.
export function parseKwindooGPX(xml) {
  const race = cleanRace(xml);
  const tracks = parseGPX(xml).map((t) => ({ ...t, skipper: cleanSkipper(t.name) }));
  return { race, tracks };
}

// A fleet = several per-boat exports. files: [{ gpx, sail?, label? }].
// Returns { race, boats:[{ skipper, sail, name, points, stats }], leaderboard }.
// leaderboard = boats ranked by distance sailed (a sanity proxy; official rank comes from results).
export function ingestKwindooFleet(files) {
  let race = '';
  const boats = [];
  for (const f of files) {
    const { race: r, tracks } = parseKwindooGPX(f.gpx);
    if (r && !race) race = r;
    for (const t of tracks) {
      boats.push({ skipper: f.label || t.skipper, sail: f.sail || null, name: t.name, points: t.points, stats: trackStats(t) });
    }
  }
  const leaderboard = fleetStats(boats);
  return { race, boats, leaderboard };
}

// Pick Little Johnka's track from an ingested fleet (by sail 6116 / skipper Monteiro / boat CYD27) —
// this is the series you feed to wind-overlay + polar-performance for the weakness map, exactly like
// the Bol d'Or Debrief. Returns { name, points } or null.
export function ljTrack(fleet) {
  const isLJ = (b) => /6116|johnka|monteiro|cyd\s?27/i.test(`${b.sail || ''} ${b.skipper || ''} ${b.name || ''}`);
  const b = (fleet.boats || []).find(isLJ);
  return b ? { name: b.name, points: b.points } : null;
}
