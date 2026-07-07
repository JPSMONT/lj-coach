// trim-lab.test.mjs — A/B trim evaluation (condition binning, permutation significance, TrimRun).
// Run:  node test/trim-lab.test.mjs   (from phase0-engine/)

import { conditionBin, summarize, evaluateAB, makeTrimRun, TRIM_CONTROLS, normalizeSetup, diffSetups } from '../src/trim-lab.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = JSON.parse(readFileSync(join(root, 'data/boats.json'), 'utf8'));
const LJ = DATA.boats.find((b) => b.id === 'lj');
const GRID = DATA._meta.tws_grid;

let pass = 0, fail = 0;
const near = (a, b, tol) => a != null && Math.abs(a - b) <= tol;
function ok(id, desc, cond) { console.log(`${cond ? 'PASS' : 'FAIL'}  ${id}  ${desc}`); cond ? pass++ : fail++; }

// deterministic noise so the test is stable
let _s = 99; const noise = (amp) => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return ((_s / 0x7fffffff) - 0.5) * 2 * amp; };
// beat @ ~7.8 kt TWS, TWA 41 (band 6–8). boatspeed sets the % of polar (target beat-VMG ≈ 4.08).
const run = (bs, heel, trim, n) => Array.from({ length: n }, () => ({ tws: 7.8, twa: 41, boatspeed: bs + noise(0.12), heel, trim }));

// slow + over-heeled (setup A) vs faster (setup B), SAME condition
const A = run(4.59, 26, -2, 40);   // ~85% of polar
const B = run(5.19, 20, -1, 40);   // ~96% of polar

// --- condition binning ---
{
  const b = conditionBin({ tws: 7.8, twa: 41 });
  ok('C1', 'TWS bin 6–8', b.tws_bin === '6–8');
  ok('C2', 'TWA bin 30–45', b.twa_bin === '30–45');
}
// --- per-setup summary ---
{
  const sA = summarize(LJ, A, GRID), sB = summarize(LJ, B, GRID);
  ok('S1', 'A ≈ 85% of polar', near(sA.meanPct, 85, 3) && sA.n === 40);
  ok('S2', 'B ≈ 96% of polar', near(sB.meanPct, 96, 3));
  ok('S3', 'summary carries mean heel (A over-heeled ~26°)', near(sA.meanHeel, 26, 0.5));
}
// --- A/B: B is significantly faster ---
{
  const r = evaluateAB(LJ, A, B, GRID, { minN: 8 });
  ok('E1', 'B flagged faster', r.faster === 'B' && r.deltaPct > 0);
  ok('E2', 'delta ≈ +11 pp of polar', near(r.deltaPct, 11, 3));
  ok('E3', 'significant (p<0.05)', r.significant === true && r.p < 0.05);
  ok('E4', 'not underpowered', r.underpowered === false);
}
// --- null: two draws from the SAME setup are NOT significantly different ---
{
  const A2 = run(4.59, 26, -2, 40);
  const r = evaluateAB(LJ, A, A2, GRID, { minN: 8 });
  ok('N1', 'no significant difference', r.significant === false && r.p >= 0.05);
  ok('N2', 'small delta', Math.abs(r.deltaPct) < 3);
}
// --- underpowered guard ---
{
  const r = evaluateAB(LJ, A.slice(0, 4), B.slice(0, 4), GRID, { minN: 8 });
  ok('U1', 'flags inconclusive when n < minN', r.underpowered === true && r.significant === false && /inconclusive/.test(r.note));
}
// --- condition filter: only compares matched bins ---
{
  const offBin = run(6.5, 12, 0, 30).map((s) => ({ ...s, tws: 12, twa: 90 })); // different condition
  const r = evaluateAB(LJ, A, B.concat(offBin), GRID, { minN: 8, condition: { tws_bin: '6–8', twa_bin: '30–45' } });
  ok('F1', 'off-condition samples excluded from B', r.b.n === 40);
}
// --- TrimRun record (Build Spec §2.6) ---
{
  const tr = makeTrimRun({ id: 'tr1', session_id: 's1', objective: 'flatten main, ease traveller upwind',
    setup: { traveller: 'down 5cm', backstay: 6 }, samples: B, boat: LJ, grid: GRID });
  ok('T1', 'has §2.6 shape', tr.id === 'tr1' && tr.setup.traveller === 'down 5cm' && tr.owner_only_edit === true);
  ok('T2', 'result populated with pct_target', near(tr.result.pct_target, 96, 3) && tr.result.n === 40);
  ok('T3', 'condition inferred from samples', tr.condition.tws_bin === '6–8');
}

// --- trim vocabulary registry (the 18 controls the guide shows) ---
{
  ok('R1', '18 controls registered', TRIM_CONTROLS.length === 18);
  ok('R2', 'ids unique', new Set(TRIM_CONTROLS.map((c) => c.id)).size === 18);
  ok('R3', 'includes the LJ-specific levers', ['jib_lead', 'barber_hauler', 'pole_height', 'pole_angle', 'tweakers', 'spin_guy'].every((id) => TRIM_CONTROLS.some((c) => c.id === id)));
}
// --- normalizeSetup: keep known ids, flag unknown ---
{
  const { setup, unknown } = normalizeSetup({ traveller: 'down 5cm', backstay: 6, jib_lead: 'in 1', wibble: 3 });
  ok('NS1', 'known controls kept', setup.traveller === 'down 5cm' && setup.backstay === 6 && setup.jib_lead === 'in 1');
  ok('NS2', 'unknown control flagged, not stored', unknown.includes('wibble') && !('wibble' in setup));
}
// --- diffSetups: what changed between A and B ---
{
  const d = diffSetups({ traveller: 'up', backstay: 5, cunningham: 'off' }, { traveller: 'down', backstay: 5, cunningham: 'on' });
  ok('D1', 'reports only the changed controls', d.length === 2 && d.every((c) => c.id !== 'backstay'));
  const trav = d.find((c) => c.id === 'traveller');
  ok('D2', 'captures from→to and the control number', trav && trav.from === 'up' && trav.to === 'down' && trav.n === 3 && trav.known === true);
}
// --- makeTrimRun normalizes the setup ---
{
  const tr = makeTrimRun({ id: 'tr2', session_id: 's1', objective: 'test', setup: { pole_height: 'high', bogus: 1 }, samples: B, boat: LJ, grid: GRID });
  ok('TR1', 'setup keyed by known ids only', tr.setup.pole_height === 'high' && !('bogus' in tr.setup));
  ok('TR2', 'unknown ids surfaced separately', tr.setup_unknown.includes('bogus'));
}
// --- evaluateAB carries the changed-controls list when setups are given ---
{
  const r = evaluateAB(LJ, A, B, GRID, { minN: 8, setupA: { traveller: 'up', backstay: 6 }, setupB: { traveller: 'down', backstay: 6 } });
  ok('AB1', 'changed = just the traveller', Array.isArray(r.changed) && r.changed.length === 1 && r.changed[0].id === 'traveller');
  const r2 = evaluateAB(LJ, A, B, GRID, { minN: 8 });
  ok('AB2', 'changed is null when no setups passed', r2.changed === null);
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
