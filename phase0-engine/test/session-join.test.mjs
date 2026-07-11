// session-join.test.mjs — nearest-time conditions lookup. Run: node test/session-join.test.mjs
import { nearestSample, conditionsAt } from '../src/session-join.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  FAIL ${name} — got ${JSON.stringify(got)}`); } };

const base = Date.UTC(2026, 5, 6, 10, 0, 0);
const session = { samples: [
  { t: base + 0,    stw: 5.1, sog: 5.4, tws: 7.0, twa: 42, aws: 11.0, awa: 30, heel: 18 },
  { t: base + 1000, stw: 6.2, sog: 6.5, tws: 12.0, twa: 44, aws: 16.0, awa: 28, heel: 22 },
  { t: base + 2000, stw: 6.9, sog: 7.1, tws: 14.0, twa: 90, aws: 18.0, awa: 85, heel: 15 },
] };

// nearest within tolerance picks the closest sample
let r = conditionsAt(session, base + 1100);
ok('nearest picks t+1000', r && r.tws === 12.0 && r.twa === 44, r);
ok('gap reported (~100ms)', r && r.gapMs === 100, r && r.gapMs);
ok('boatspeed prefers STW', r && r.sog === 6.2, r && r.sog);
ok('carries AWS/AWA/heel', r && r.aws === 16.0 && r.awa === 28 && r.heel === 22, r);

// exact reaching sample
r = conditionsAt(session, base + 2000);
ok('exact t+2000 reach', r && r.twa === 90 && r.tws === 14.0 && r.gapMs === 0, r);

// beyond tolerance → null (don't tag with stale conditions)
ok('far gap → null', conditionsAt(session, base + 60000, { maxGapMs: 15000 }) === null, null);

// STW missing → falls back to SOG
r = conditionsAt({ samples: [{ t: base, sog: 4.4, tws: 6.5, twa: 40 }] }, base);
ok('falls back to SOG', r && r.sog === 4.4, r && r.sog);

// guards
ok('null time → null', conditionsAt(session, null) === null, null);
ok('empty samples → null', conditionsAt({ samples: [] }, base) === null, null);
ok('accepts bare array', nearestSample(session.samples, base + 100).gapMs === 100, null);

console.log(`\nsession-join: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
