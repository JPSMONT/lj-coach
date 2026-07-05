# LJ Coach App

Race-analytics app for **Little Johnka** (Ceccarelli 27, SUI 6116 · ORC 183039 · GPH 660.2).
Standalone repo. Reuses the Bol d'Or backend over its API (system-of-record + live-relay) —
no shared code, no coupling to the Bol d'Or repo.

## Phase 0 — corrected-time engine (built)
`phase0-engine/` — pure ES-module JS, no dependencies (Node 22+).

- `src/engine.mjs` — corrected-time margin engine. Verified formula
  `margin = (V_LJ / V_rival) × (rate_rival / rate_LJ) − 1`  (+ = LJ wins);
  whole-course scoring on summed leg *times*; guards (sub-4kt / no-rating / no-speed /
  NaN-TWS); confidence tiers; linear wind interpolation between ORC nodes.
- `src/ratings.mjs` — ORC (1/GPH) · SRS (TCF) · Yardstick (100/YS).
- `data/boats.json` — full angle polars (Beat/Run VMG + 52–150° reaching) for 9 boats,
  primary-sourced from ORC certificates. LJ basis = **2020 ORC certificate** (single basis).
- `test/acceptance.test.mjs` — `node test/acceptance.test.mjs` → **24/24 pass**.
- `ui/compare.html` — single-file drill-down Compare view.

Canonical design docs (PRD, win-map, strategy) live in the Drive folder
**"LJ Coach — CURRENT"**. This repo holds the code.
