# LJ Coach — Phase 0 engine (corrected-time spine)

The framework-agnostic corrected-time engine + acceptance-vector tests + a single-file Compare UI. Pure ES-module JavaScript, no dependencies, runs in Node 22+ and drops straight into the web app later. Built to the `Phase0-Build-Spec` (Drive `LJ Coach — CURRENT`).

## Run the tests
```
cd phase0-engine
node test/acceptance.test.mjs
```
Expect: **24 passed, 0 failed.**

## What's here
- `src/ratings.mjs` — the three rating systems as **speed-ratings (higher = faster)**: ORC `1/GPH`, SRS `TCF`, Yardstick `100/YS`.
- `src/engine.mjs` — verified margin formula, whole-course scoring, guards, confidence tiers, and linear wind interpolation between ORC nodes (`interp`/`polarSpeed`/`compareAt`).
- `data/boats.json` — full angle polars (Beat/Run VMG + 52–150° reaching + beat/gybe angles) for 9 boats, primary-sourced from ORC certificates. Each polar boat also carries `downwind_sail` (symmetric spi vs asymmetric gennaker), derived from its gybe angles. **LJ basis = 2020 certificate (GPH 660.2).**
- `test/acceptance.test.mjs` — runnable vectors with hand-derived expected values.
- `ui/compare.html` — **generated** single-file Compare view (see below).
- `ui/template.html` + `ui/build.mjs` — the source template and the build step that produces `compare.html`.

## The Compare UI is generated — don't hand-edit it
`ui/compare.html` must run the *same* engine the tests verify, never a hand-kept copy. So it is generated:
```
node ui/build.mjs      # inlines src/ratings.mjs + src/engine.mjs + data/boats.json into ui/template.html → ui/compare.html
```
Edit `ui/template.html` (markup/UI) or `src/*.mjs` / `data/boats.json` (engine/data), then rebuild. A verification sweep (4050 cases: every boat × angle × wind × system) confirms the inlined engine is bit-identical to `src/`.

## The formula (sign-checked)
```
margin = (V_LJ / V_rival) × (rate_rival / rate_LJ) − 1        [+ = LJ wins]
```
ORC form: `× (GPH_LJ / GPH_rival)`. An earlier draft used `rate_LJ/rate_rival` — inverted; the vectors pin the direction to numeric cases (V2 Esse equal-speed = +8.4% win; Vd Surprise equal-speed = −3.8% loss) so it can't recur. Whole-course scoring aggregates on **summed leg times** (`corrected = Σ(dist/speed) × rate`, lower wins), never averaged per-leg margins. Intermediate winds (7/9/11/15/18/19) are linear-interpolated between the 7 ORC nodes.

## Data status
- **Full angle polars: DONE, primary-sourced** from each boat's ORC certificate (data.orc.org), independently re-fetched and cell-diffed clean. 9 boats (J/70, UFO 22, Este 24, Surprise, Melges 24, Esse 850, Melges 32, Blu 26 + LJ).
- **LJ full polar (Beat/Run VMG + 52–150° reaching): DONE** from the 2020 ORC certificate `183039` (GPH 660.2, CDL 7.050). The Drive "Speed Guide"/"Speed Angles" files are the ©2021 Speed-Guide basis — NOT the certificate; using them would mix bases.
- Vectors reproduce the Fable-audited win-map and the strategy course tables (V1 J/70 6kt +13.4, V4 Melges 24 20kt run −23.9, V5 W/L @10kt +1.2, V6 reaching @14kt −9.2, Vr 90° @14kt −11.4, Vi interpolated 9kt +5.5).

## What is NOT here yet (honest scope)
- **Rating-only boats** (Cape 31, SB20, Lüthi 990, Toucan, Psaros 33/40) have no ORC polar grid — margins refuse (`no_orc_polar`), correctly.
- **APH-as-basis modelling** for the Psaros (flagged `aph_offset` → confidence `low`).
- **LJ sail-inventory what-if** (Drifter/Code 0/Std Spi): the polar shows the VPP-optimal sail per angle; a "wrong sail up" penalty layer is a later refinement. LJ's 2020 cert rates a symmetric spinnaker only — the Code 0 is not yet certified.
- JSON import/export; JSON-Schema files (shapes documented in the Build Spec).

## Next
Re-anchor everything when the renewed ORC certificate lands (swap LJ's polar + GPH, re-run the vectors, rebuild the UI). Then: LJ sail-inventory what-if, import/export.
