// wind-overlay.test.mjs — GPS+wind → TWA/TWS samples, and Open-Meteo parsing.
// Run:  node test/wind-overlay.test.mjs   (from phase0-engine/)

import { courseSpeed, windAt, deriveSamples, parseOpenMeteo } from '../src/wind-overlay.mjs';

let pass = 0, fail = 0;
const near = (a, b, tol) => a != null && Math.abs(a - b) <= tol;
function ok(id, desc, cond) { console.log(`${cond ? 'PASS' : 'FAIL'}  ${id}  ${desc}`); cond ? pass++ : fail++; }

// course/speed: a boat heading due EAST at ~6 kn
const t0 = Date.parse('2026-06-06T10:00:00Z');
const eastTrack = { points: [0,1,2,3].map((i) => ({ t: t0 + i * 60000, lat: 46.30, lon: 6.20 + i * 0.0024 })) }; // ~6 kn E
{
  const cs = courseSpeed(eastTrack.points);
  ok('CS1', 'COG ≈ 090° (due east)', near(cs[1].cog, 90, 2));
  ok('CS2', 'SOG ≈ 6 kn', near(cs[1].sog, 6.0, 0.3));
}

// wind lookup: nearest station + time interpolation
{
  const ws = [{ lat: 46.30, lon: 6.20, hours: [
    { t: t0, speed_kn: 10, dir_deg: 0 },
    { t: t0 + 3600000, speed_kn: 14, dir_deg: 20 },
  ] }];
  const w = windAt(ws, 46.30, 6.20, t0 + 1800000); // halfway
  ok('W1', 'wind speed interpolates to 12 kn', near(w.speed_kn, 12, 0.1));
  ok('W2', 'wind dir interpolates to 10°', near(w.dir_deg, 10, 0.1));
}

// derive TWA/TWS: boat east (COG 90), wind FROM north (0°) → beam reach TWA 90
{
  const ws = [{ lat: 46.30, lon: 6.20, hours: [{ t: t0, speed_kn: 12, dir_deg: 0 }, { t: t0 + 3600000, speed_kn: 12, dir_deg: 0 }] }];
  const s = deriveSamples(eastTrack, ws);
  ok('D1', 'samples produced with tws/twa/boatspeed', s.length >= 1 && s[0].tws != null && s[0].twa != null && s[0].boatspeed != null);
  ok('D2', 'east boat + north wind → TWA ≈ 90° (beam reach)', near(s[0].twa, 90, 2));
  ok('D3', 'TWS carried from the wind field (12 kn)', near(s[0].tws, 12, 0.1));
}
// boat sailing NORTH into a wind FROM the north → upwind, TWA ≈ 0–small
{
  const northTrack = { points: [0,1,2,3].map((i) => ({ t: t0 + i * 60000, lat: 46.30 + i * 0.0017, lon: 6.20 })) };
  const ws = [{ lat: 46.30, lon: 6.20, hours: [{ t: t0, speed_kn: 8, dir_deg: 0 }, { t: t0 + 3600000, speed_kn: 8, dir_deg: 0 }] }];
  const s = deriveSamples(northTrack, ws);
  ok('D4', 'boat into the wind → small TWA (upwind)', s.length && s[0].twa < 20);
}

// Open-Meteo parse (single + multi location)
{
  const json = { latitude: 46.4, longitude: 6.5, hourly: { time: ['2026-06-06T10:00', '2026-06-06T11:00'], wind_speed_10m: [9, 11], wind_direction_10m: [230, 240] } };
  const ws = parseOpenMeteo(json);
  ok('OM1', 'parses single-location Open-Meteo JSON', ws.length === 1 && ws[0].hours.length === 2 && ws[0].hours[0].speed_kn === 9);
  const multi = parseOpenMeteo([json, { ...json, latitude: 46.24, longitude: 6.17 }]);
  ok('OM2', 'parses multi-location array', multi.length === 2 && multi[1].lat === 46.24);
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
