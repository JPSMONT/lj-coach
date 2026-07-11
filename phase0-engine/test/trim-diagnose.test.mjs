// trim-diagnose.test.mjs — verify shape+wind → the right single trim action.
// Run:  node test/trim-diagnose.test.mjs   (from phase0-engine/)
import { windBand, literatureTarget, resolveTarget, diagnose, slotDiagnose } from '../src/trim-diagnose.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log(`  FAIL ${name} — got ${JSON.stringify(got)}`); } };

// helper: fake a measured shape
const shape = (o) => ({
  mode: o.mode || 'relative',
  depthMidPct: o.depth, twistProfileDeg: o.twist,
  stripes: [{ draftPosPct: o.draft }, { draftPosPct: o.draft }, { draftPosPct: o.draft }],
});

// --- windBand ---
ok('4 kt light', windBand(4) === 'light', windBand(4));
ok('10 kt medium', windBand(10) === 'medium', windBand(10));
ok('18 kt heavy', windBand(18) === 'heavy', windBand(18));
ok('undefined → unknown', windBand(undefined) === 'unknown', windBand());

// --- targets ---
ok('heavy target flatter than light', literatureTarget('heavy').depth[1] < literatureTarget('light').depth[0], null);
ok('personal target overrides', resolveTarget('medium', { medium: { depth: [9, 11], draft: [44, 47], twist: 7, twistTol: 3 } }).source === 'personal', null);
ok('literature fallback', resolveTarget('medium').source === 'literature', null);

// --- draft too far AFT (medium target draft 45–48) → cunningham, headline ---
let d = diagnose(shape({ depth: 11, draft: 55, twist: 8 }), { tws: 10 });
ok('aft draft → luff tension headline', /aft/i.test(d.headline.action) && /cunningham/.test(d.headline.control), d.headline);
ok('targetSource literature', d.targetSource === 'literature', d.targetSource);

// --- draft too far FORWARD → ease luff tension ---
d = diagnose(shape({ depth: 11, draft: 38, twist: 8 }), { tws: 10 });
ok('fwd draft → ease luff tension', /forward/i.test(d.headline.action), d.headline);

// --- top twisted OPEN (twist 16 vs medium target 8±4) with draft on-target → leech close ---
d = diagnose(shape({ depth: 11, draft: 46, twist: 16 }), { tws: 10 });
ok('twist open → close leech', /twisted open/i.test(d.headline.action) && /mainsheet|vang/.test(d.headline.control), d.headline);

// --- too DEEP in heavy air (depth 14 vs heavy 7–9) in ABSOLUTE mode → flatten headline ---
d = diagnose(shape({ mode: 'absolute', depth: 14, draft: 50, twist: 5 }), { tws: 18 });
ok('deep + absolute → flatten headline', /too deep/i.test(d.headline.action) && /backstay|outhaul/.test(d.headline.control), d.headline);

// --- same deep shape in RELATIVE mode: depth down-weighted, so a small draft error can outrank it ---
const rel = diagnose(shape({ mode: 'relative', depth: 14, draft: 54, twist: 5 }), { tws: 18 });
ok('relative mode caveat present', rel.caveats.some((c) => /relative reading/.test(c)), rel.caveats);
ok('relative: draft outranks depth', /aft/i.test(rel.headline.action), rel.headline);

// --- MAJOR-fix (audit #1): in relative mode depth is NEVER the headline, even when far off, if
//     draft & twist are on target — it can only inform (others/caveat), never be the shown action ---
let dr = diagnose(shape({ mode: 'relative', depth: 30, draft: 46, twist: 8 }), { tws: 10 });
ok('relative: big depth is not the headline', !/deep|flat/i.test(dr.headline.action), dr.headline);
ok('relative: depth-off caveat shown', dr.caveats.some((c) => /not shown as the action/.test(c)), dr.caveats);
// in ABSOLUTE mode the same depth IS allowed to headline
dr = diagnose(shape({ mode: 'absolute', depth: 30, draft: 46, twist: 8 }), { tws: 10 });
ok('absolute: big depth can headline', /deep/i.test(dr.headline.action), dr.headline);

// --- ranking fix (audit #2): twist scored by distance PAST tolerance, so a 1% draft error
//     outranks a twist that is only 1° beyond tolerance (both ~1 unit out, draft has higher sens) ---
dr = diagnose(shape({ depth: 11, draft: 49, twist: 13 }), { tws: 10 });
ok('past-tol twist does not beat 1% draft', /aft/i.test(dr.headline.action), dr.headline);

// --- in the groove: everything on target → no action headline ---
d = diagnose(shape({ depth: 11, draft: 46, twist: 8 }), { tws: 10 });
ok('on-target → in the groove', /groove/i.test(d.headline.action), d.headline);

// --- unknown wind caveat ---
d = diagnose(shape({ depth: 11, draft: 60, twist: 8 }), {});
ok('no wind → medium + caveat', d.band === 'unknown' && d.caveats.some((c) => /no wind/.test(c)), d.caveats);

// --- slot: jib more open than main → lead forward ---
let s = slotDiagnose(shape({ depth: 10, draft: 46, twist: 16 }), shape({ depth: 10, draft: 46, twist: 8 }));
ok('jib open → lead forward', /forward/.test(s.control) && s.matched === false, s);
// jib tighter than main → lead aft
s = slotDiagnose(shape({ depth: 10, draft: 46, twist: 4 }), shape({ depth: 10, draft: 46, twist: 12 }));
ok('jib tight → lead aft', /aft/.test(s.control), s);
// matched
s = slotDiagnose(shape({ depth: 10, draft: 46, twist: 9 }), shape({ depth: 10, draft: 46, twist: 8 }));
ok('matched leeches', s.matched === true, s);

console.log(`\ntrim-diagnose: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
