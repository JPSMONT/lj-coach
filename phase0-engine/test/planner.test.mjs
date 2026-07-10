// planner.test.mjs — verify the plan glue (pattern match, catchability tiers, pre-start line).
// Run:  node test/planner.test.mjs   (from phase0-engine/)
import { matchPattern, catchTier, planConfidence, preStartCall } from '../src/planner.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  FAIL ${name} — got ${JSON.stringify(got)}`); } };

const patterns = [
  { name: 'Bise', bearing: 45, favoured_side: 'SOUTH bank' },
  { name: 'Vent (SW)', bearing: 225, favoured_side: 'mid-lake, go east' },
  { name: 'Vaudaire', bearing: 135, favoured_side: 'east end' },
  { name: 'Joran', bearing: 315, favoured_side: 'north shore' },
  { name: 'no-bearing pattern' },   // must be ignored
];

// --- matchPattern: nearest bearing, circular ---
ok('NE 50° → Bise', matchPattern(patterns, 50).pattern.name === 'Bise', matchPattern(patterns, 50));
ok('SW 230° → Vent', matchPattern(patterns, 230).pattern.name === 'Vent (SW)', matchPattern(patterns, 230));
ok('NW 300° → Joran (not Vaudaire)', matchPattern(patterns, 300).pattern.name === 'Joran', matchPattern(patterns, 300));
ok('wrap 10° → Bise (circular)', matchPattern(patterns, 10).pattern.name === 'Bise', matchPattern(patterns, 10));
ok('offDeg reported', matchPattern(patterns, 50).offDeg === 5, matchPattern(patterns, 50).offDeg);
ok('no dir → null', matchPattern(patterns, null) === null, matchPattern(patterns, null));

// --- catchTier ---
ok('+1% catchable', catchTier(1) === 'catchable', catchTier(1));
ok('−1% marginal', catchTier(-1) === 'marginal', catchTier(-1));
ok('−3% out', catchTier(-3) === 'out', catchTier(-3));

// --- planConfidence ---
ok('light air → low', planConfidence(10, 5) === 'low', planConfidence(10, 5));
ok('bad match → low', planConfidence(70, 12) === 'low', planConfidence(70, 12));
ok('moderate → medium', planConfidence(40, 12) === 'medium', planConfidence(40, 12));
ok('clean + breeze → high', planConfidence(10, 12) === 'high', planConfidence(10, 12));

// --- preStartCall ---
const m = matchPattern(patterns, 50); // Bise
const call = preStartCall(m, [
  { name: 'Esse 850', pct: 2.1, tier: 'catchable' },
  { name: 'J/70', pct: -1.2, tier: 'marginal' },
  { name: 'Cape 31', pct: -5.0, tier: 'out' },
]);
ok('call names the side', /SOUTH bank/.test(call), call);
ok('call watches the tightest in-play boat (J/70)', /Watch J\/70 \(-1\.2%\)/.test(call), call);
ok('call ignores out-of-reach boat', !/Cape 31/.test(call), call);
ok('no match → prompt', /Enter a wind/.test(preStartCall(null, [])), preStartCall(null, []));

console.log(`\nplanner: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
