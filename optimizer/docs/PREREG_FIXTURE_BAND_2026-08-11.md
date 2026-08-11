# Preregistration — discriminating-band fixture calibration (2026-08-11)

**Status: written and committed BEFORE any calibration session was run.** That ordering is the
whole point: a selection rule chosen after seeing the numbers is not a rule, it is a preference.

## Why this exists

Every candidate trial the run-kernel roadmap plans is gated on fixtures that can actually
discriminate. The existing pool cannot:

- Saturated fixtures (models pass nearly always) cannot show harm or help.
- Floored fixtures (models fail nearly always) cannot either, and this project has already
  produced two floored rounds from fixture defects rather than model behaviour
  (`retry-trap` 1/42 and `hygiene-shared-config-reread` 3/24, both caused by the gate withholding
  `docs/` — see `MEASUREMENT_METHODOLOGY_2026-07.md` section 9).

The 2026-08-11 ling3 runs made the gap concrete: a 1.3B-active model completed the two easy tasks
it was given on the first attempt. Nothing currently in the pool sits in the middle.

## What is being calibrated

Four new fixtures, authored 2026-08-11, each built around one deliberate trap:

| Fixture | Trap |
|---|---|
| `misleading-symptom` | the error surfaces downstream of the actual defect; patching the symptom passes the visible tests |
| `ordered-steps` | two transformations do not commute; the intuitive order is wrong only for a record both touch |
| `second-test-guard` | the obvious fix for the stated requirement breaks a different visible test |
| `documented-escape` | the obvious approach deterministically fails; a `docs/` file names the supported alternative |

Per-fixture design intent, traps and the full verification record:
`optimizer/real-gate-fixtures/BAND_FIXTURES_2026-08-11.md`. Review packets for the approval
gate are under `optimizer/real-gate-fixtures/review-packets/`.

Each ships a **shortcut mutant**: a plausible fix that passes the visible suite and fails the
hidden one. Its purpose is to measure test-fitting directly rather than infer it.

## Procedure

- Subjects: `qwopus35-4b` and `ling3-tiny-experimental`, both local. Two model tiers, because a
  fixture that discriminates on one tier and not the other is a fact about that tier, not the
  fixture (`harness-model-independent`).
- **n = 3 per (fixture, model)** — 24 sessions total. This is calibration, not a powered trial.
- Harness at deployed defaults, single arm. No candidate flag is set, nothing is compared.
- One round at a time on the serving box.
- Each fixture must pass `fixture_admission.py` first: pristine fails the hidden test, gold passes
  both suites, the shortcut mutant passes visible and fails hidden.

## Outcome measure

Primary: **mean gate-pass rate per fixture**, pooled across the two models
(6 sessions per fixture).

Secondary, recorded but not selection-bearing:
- whether any real session produced the shortcut-mutant behaviour (test-fitting observed in the wild);
- median tool calls and repeated calls per session (`effort_report.py --graded`), for the
  variance estimate that the later powered rounds need to compute their sample size;
- failure-episode exposure per session, to confirm these fixtures actually generate the failure
  class the loop-intervention candidate is meant to address.

## Selection rule — declared in advance

A fixture enters the candidate-round pool **iff its mean gate-pass rate is within [0.30, 0.70]**.

- `< 0.30` → **floored**. Do not use. Diagnose first: a floored fixture is more often a defect in
  the fixture (an unfair hidden test, a file the prompt names but the model cannot see, an
  environment trap) than a genuine difficulty result. Redesign or retire.
- `> 0.70` → **saturated**. Retire from candidate rounds. May be kept as a `pass_to_pass`
  regression guard, where saturation is a virtue.
- Exactly at a boundary counts as inside the band.

If **fewer than two** fixtures land in the band, the correct conclusion is that the fixture set is
not ready and no candidate trial starts. Authoring more fixtures is cheaper than a round that
measures nothing.

## Declared limitations

- n=3 per cell gives a wide interval on each rate; the band test is deliberately coarse and
  exists to reject the two useless extremes, not to estimate difficulty precisely.
- Pooling two models is a deliberate simplification. A fixture at 0.0 on one model and 1.0 on the
  other pools to 0.5 and would pass this rule while discriminating on neither; the per-model rates
  are therefore recorded, and any fixture whose per-model rates straddle the band is treated as
  **model-specific** and admitted only for the model where it discriminates.
- These fixtures were authored by an LLM fleet and independently reviewed by a second fleet.
  Review is not proof. The admission tool's three-state check is the binding gate.
- Nothing here authorizes any adoption. This calibration selects measuring instruments; it does
  not measure the harness.

## Surface binding

Calibration runs bind the loaded surface hash recorded in `docs/SURFACE_BOUNDARIES.md` for
2026-08-11. Results do not pool across any later boundary row.
