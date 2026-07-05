# LJ Coach — Phase 0 engine (corrected-time spine)

The framework-agnostic corrected-time engine + its acceptance-vector test suite. Pure ES-module JavaScript, no dependencies, runs in Node and drops straight into the web app later. Built to the `Phase0-Build-Spec` (in the Drive `LJ Coach — CURRENT` folder).

## Run the tests
```
cd phase0-engine
node test/acceptance.test.mjs
```
Expect: **12 passed, 0 failed.**

## What's here
- `src/ratings.mjs` — the three rating systems as **speed-ratings (higher = faster)**: ORC `1/GPH`, SRS `TCF`, Yardstick `100/YS`.
- `src/engine.mjs` — the verified formula, whole-course scoring, guards, confidence tiers.
- `data/boats.json` — seed ratings (GPH/YS/TCF), primary-sourced. **LJ basis = 2020 certificate (GPH 660.2).**
- `test/acceptance.test.mjs` — runnable vectors with hand-derived expected values.

## The formula (sign-checked)
```
margin = (V_LJ / V_rival) × (rate_rival / rate_LJ) − 1        [+ = LJ wins]
```
ORC form: `× (GPH_LJ / GPH_rival)`. An earlier draft used `rate_LJ/rate_rival` — inverted; the vectors pin the direction to numeric cases (V2 Esse equal-speed = +8.4% win; Vd Surprise equal-speed = −3.8% loss) so it can't recur.

Whole-course scoring aggregates on **summed leg times** (`corrected = Σ(dist/speed) × rate`, lower wins), never on averaged per-leg margins.

## Data status
- **Rival beat + run VMG grids: DONE, primary-sourced** from each boat's ORC certificate (data.orc.org), independently re-fetched and cell-diffed clean. 9 boats (J/70, UFO 22, Este 24, Surprise, Melges 24, Esse 850, Melges 32, Blu 26 + LJ).
- **Beat-VMG vectors now pass from primary data** and reproduce the Fable-audited win-map: V1 J/70 6kt +13.4, V3 Surprise 12kt −7.3, Esse 6kt +2.0, Melges 24 6kt +11.1, UFO 22 14kt +5.1. Certs ↔ win-map ↔ engine all agree.

## What is NOT here yet (honest scope)
- **LJ run VMG + reaching angles.** LJ's `run_vmg` is `null`: it must come from the **LJ 2020 certificate scan** (the Drive "Speed Guide"/"Speed Angles" files are the ©2021 Speed-Guide basis, not the certificate — using them would mix bases). So the **run/course/reaching vectors (V4, V5, V6) are pending** LJ cert run + reaching speeds. Cape 31 has no public OD cert.
- **APH-as-basis modelling** for the Psaros (currently flagged `aph_offset` → confidence `low`).
- UI (Compare view), import/export, JSON-Schema files (shapes documented in the Build Spec).

## Next
Digitise LJ's run VMG + reaching speeds from the 2020 cert → V4/V5/V6 light up → then the Compare UI. Re-anchor everything when the renewed ORC certificate lands (swap LJ's polar + GPH, re-run the vectors).
