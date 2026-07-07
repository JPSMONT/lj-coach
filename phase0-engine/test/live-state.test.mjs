// live-state.test.mjs — vectors for the live-state reducer + derived racing values.
// Run:  node test/live-state.test.mjs   (from phase0-engine/)

import { initState, applyMessage, applyStream, isStale, deriveTrueWind, trueWindOf, pointOfSail } from '../src/live-state.mjs';
import { decodeRawLine } from '../src/n2k-decode.mjs';
import { scenario, sampleSail } from '../src/n2k-sim.mjs';

let pass = 0, fail = 0;
const near = (a, b, tol) => a != null && Math.abs(a - b) <= tol;
function ok(id, desc, cond) { console.log(`${cond ? 'PASS' : 'FAIL'}  ${id}  ${desc}`); cond ? pass++ : fail++; }

// ---- reducer: fields update from decoded messages; latest wins; timestamps set ----
{
  let s = initState();
  s = applyMessage(s, { name: 'attitude', heel_deg: 18, trim_deg: -2 }, 1000);
  s = applyMessage(s, { name: 'speedWaterReferenced', stw_kn: 6.2 }, 1000);
  s = applyMessage(s, { name: 'attitude', heel_deg: 22, trim_deg: -1 }, 2000); // newer wins
  ok('LS1', 'reducer keeps latest heel/trim + STW', s.heel_deg === 22 && s.trim_deg === -1 && s.stw_kn === 6.2);
  ok('LS2', 'timestamps recorded', s.ts.heel_deg === 2000 && s.ts.stw_kn === 1000);
  ok('LS3', 'null field does not overwrite', applyMessage(s, { name: 'windData', aws_kn: null, awa_deg: 30 }, 3000).aws_kn === undefined);
}

// ---- staleness ----
{
  let s = applyMessage(initState(), { name: 'waterDepth', depth_m: 12 }, 1000);
  ok('LS4', 'fresh field not stale', !isStale(s, 'depth_m', 1500, 3000));
  ok('LS5', 'old field is stale', isStale(s, 'depth_m', 9000, 3000));
  ok('LS6', 'never-seen field is stale', isStale(s, 'heel_deg', 1500, 3000));
}

// ---- true wind: hand-computed vector (AWS 10, BS 5, AWA 45°) ----
// TWS = sqrt(100+25-2*10*5*cos45) = sqrt(54.289) = 7.368
// TWA = atan2(10*sin45, 10*cos45-5) = atan2(7.0711, 2.0711) = 73.68°
{
  const tw = deriveTrueWind({ awa_deg: 45, aws_kn: 10, boatSpeed_kn: 5 });
  ok('TW1', 'true wind speed ≈ 7.37 kn', near(tw.tws_kn, 7.368, 0.02));
  ok('TW2', 'true wind angle ≈ 73.7°', near(tw.twa_deg, 73.68, 0.1));
}
// dead downwind sanity: AWA 180, AWS 6, BS 5 → TWS = 11, TWA 180
{
  const tw = deriveTrueWind({ awa_deg: 180, aws_kn: 6, boatSpeed_kn: 5 });
  ok('TW3', 'DDW: TWS = AWS+BS = 11 kn', near(tw.tws_kn, 11, 0.001));
  ok('TW4', 'DDW: TWA = 180°', near(Math.abs(tw.twa_deg), 180, 0.01));
}
// port/starboard sign is preserved
{
  const tw = deriveTrueWind({ awa_deg: -45, aws_kn: 10, boatSpeed_kn: 5 });
  ok('TW5', 'port apparent → port true (negative)', tw.twa_deg < 0 && near(tw.twa_deg, -73.68, 0.1));
}

// ---- point of sail mapping ----
ok('PS1', 'TWA 40° → beat', pointOfSail(40) === 'beat');
ok('PS2', 'TWA 90° → 90', pointOfSail(90) === '90');
ok('PS3', 'TWA 170° → run', pointOfSail(170) === 'run');
ok('PS4', 'TWA 125° → nearest 120', pointOfSail(125) === '120');

// ---- integration: simulated sail → decode → reduce → sane state + true wind ----
{
  const msgs = scenario(sampleSail()).map(decodeRawLine).filter(Boolean);
  const s = applyStream(initState(), msgs, 5000);
  const tw = trueWindOf(s);
  ok('INT1', 'state populated from simulated sail', s.stw_kn > 0 && s.heel_deg != null && s.aws_kn > 0 && s.awa_deg != null);
  ok('INT2', 'true wind derives to a sane number', tw && tw.tws_kn > 3 && tw.tws_kn < 30);
  ok('INT3', 'point of sail resolves', typeof pointOfSail(tw.twa_deg) === 'string');
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
