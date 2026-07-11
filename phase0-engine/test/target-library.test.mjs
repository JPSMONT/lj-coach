// target-library.test.mjs — personal targets = median of FAST shapes per band, gated by a minimum count,
// and they slot into resolveTarget/diagnose as the personal target. Run: node test/target-library.test.mjs
import { bandOf, personalTargets, librarySummary } from '../src/target-library.mjs';
import { resolveTarget } from '../src/trim-diagnose.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  FAIL ${name} — got ${JSON.stringify(got)}`); } };

// --- bandOf matches diagnose windBand boundaries ---
ok('4kt light', bandOf(4) === 'light', bandOf(4));
ok('10kt medium', bandOf(10) === 'medium', bandOf(10));
ok('18kt heavy', bandOf(18) === 'heavy', bandOf(18));

const E = (band, verdict, draft, depth, twist) => ({ ts: 1, sailId: 'main', band, tws: 10, draftPct: draft, depthPct: depth, twistDeg: twist, mode: 'absolute', verdict });

// --- below minN → no personal target for that band ---
let lib = [E('medium', 'fast', 46, 11, 8), E('medium', 'fast', 45, 12, 7)];
ok('2 fast < minN → no personal medium', personalTargets(lib).medium === undefined, personalTargets(lib));

// --- ≥minN fast → personal target = median-centred band ---
lib = [E('medium', 'fast', 44, 12, 7), E('medium', 'fast', 46, 11, 9), E('medium', 'fast', 45, 12, 8), E('medium', 'slow', 60, 15, 20)];
const pt = personalTargets(lib);
ok('3 fast → personal medium exists', !!pt.medium, pt);
ok('personal draft centred on median 45', pt.medium.draft[0] === 43 && pt.medium.draft[1] === 47, pt.medium.draft);
ok('personal depth centred on median 12', pt.medium.depth[0] === 11 && pt.medium.depth[1] === 13, pt.medium.depth);
ok('slow entries ignored', pt.medium.n === 3, pt.medium.n);
ok('source personal', pt.medium.source === 'personal', pt.medium.source);

// --- resolveTarget prefers the personal target over literature ---
const r = resolveTarget('medium', pt);
ok('resolveTarget picks personal', r.source === 'personal' && r.draft[0] === 43, r);
ok('resolveTarget falls back to literature for a band with none', resolveTarget('heavy', pt).source === 'literature', resolveTarget('heavy', pt));

// --- summary counts ---
const sum = librarySummary(lib);
ok('summary medium 3 fast / 4 total', sum.medium.fast === 3 && sum.medium.total === 4, sum.medium);

console.log(`\ntarget-library: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
