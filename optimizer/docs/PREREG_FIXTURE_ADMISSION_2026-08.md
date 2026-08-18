# Preregistration: fixture admission rule (2026-08)

**Status: PREREGISTERED — committed before any calibration data under this rule exists.**
A rule chosen after seeing the numbers is not a rule. This document is the single
admission rule for fixture calibration from 2026-08-15 onward. It supersedes, by name:

1. **The 2026-08-11 band rule** (`PREREG_FIXTURE_BAND_2026-08-11.md`): pooled mean
   gate-pass ∈ [0.30, 0.70] over 2 models × n=3, with a per-model straddle clause.
   Superseded because the binary gate bit is the wrong unit (the one-sided-detector
   problem, `MEASUREMENT_METHODOLOGY_2026-07.md` §1/§12) and because pooling across
   model tiers hid model-specific fixtures until a straddle clause had to be invented.
   Its one standing conclusion — the 2026-08-11 calibration returned NOT READY — is
   unaffected and remains true for that fixture set on that evidence.
2. **The unpreregistered rule in `failure_episode_trial.calibration()`** (committed
   2026-08-13 on `codex/ling-semantic-fixtures`): single model, n=6,
   `2 ≤ correct ≤ 4`, plus episode exposure in ≥ 2 sessions. Superseded because it was
   never preregistered and because it silently welded a study-specific eligibility
   condition (episode exposure) into general admission. Its thresholds are preserved
   below where they were right (the transitional binary clause; the episode clause,
   now correctly scoped). It never gated a run, so this supersession adjusts no firing
   guard.

## The rule

Per **fixture**, per **model tier**, **base arm only**, **n = 6** authoritative
sessions (`pi.eval-row/v3`, `authoritative: true`, `status: "complete"`).

### Core admission (all fixtures)

A fixture is **admitted for a model tier** iff all of:

- **A1 — grader coverage:** ≥ 5 of 6 rows carry `subscores` (not `subscores_blocked`).
  A fixture whose grader refuses is not measurable, whatever its difficulty.
- **A2 — graded band:** mean `graded_rate` (= `subscores.fixed / subscores.total`)
  ∈ **[0.20, 0.80]** (boundaries inclusive).
- **A3 — variance floor:** sample standard deviation of `graded_rate` **≥ 0.15**.
  A fixture where every session scores the identical mid-band value discriminates
  nothing; mid-band mean without variance is a constant, not an instrument.

**Transitional clause (grader-less fixtures only):** a fixture with no graded suite
(binary gate bit only) is admitted iff **2 ≤ correct ≤ 4** of 6. This clause exists so
legacy fixtures can participate while the corpus converts to graded suites; it expires
when the last grader-less fixture leaves the calibration slate, and no NEW fixture may
be authored grader-less.

### Purpose extension (loop-intervention cohort only)

For a fixture to be **eligible for a `semantic_failure_overrun` study** (the
`failure_episode_trial.py` pipeline), additionally:

- **E1 — episode exposure:** `context.failure_episodes.total_episodes > 0` in
  **≥ 2 of 6** sessions.

E1 is *trial eligibility for that study family*, not general admission. A fixture can
be admitted for capability candidates (graded_rate outcomes) while ineligible for loop
studies. Conflating these two was the scope error this document corrects.

### Scope and pooling

- Admission is **per model tier**. There is no pooled admission. A fixture admitted on
  the 4B is a 4B instrument; "tier-general" is a separately earned label requiring
  independent admission on a second tier.
- Rows straddling a surface-hash boundary, a schema generation, or a serving-identity
  change never pool (standing doctrine). `row_contract.canonical_generation` enforces the
  schema part mechanically in the adoption/verdict readers wired to it (`fleet_report`,
  `fleet_verdict`, `propose`); the powered study path is stronger still, pinning v3-only via
  `validate_powered_row(require_complete=True)` plus a single serving-contract check
  (`failure_episode_trial`). `effort_report`/`span_screen`/`munchkin` read a single per-round
  generation file and enforce their own per-row schema + single-serving-contract guards rather
  than calling `canonical_generation` — the no-pool guarantee holds by construction there, not
  by that one function universally.
- The verdict vocabulary: **ADMITTED** (all core criteria), **SATURATED**
  (mean > 0.80), **FLOORED** (mean < 0.20), **DEGENERATE** (band met, variance floor
  failed), **UNMEASURABLE** (A1 failed). Floored and degenerate fixtures get a
  mandatory diagnosis (per-suite re-run of failed end states, as done for
  `ordered-steps` on 2026-08-11) before any redesign or retirement.

### Slate readiness

A calibration slate is **READY** for candidate rounds iff **≥ 2 fixtures are ADMITTED
for the tier under test**. Fewer than two ⇒ NOT READY, no candidate trial starts —
carried over unchanged from the 2026-08-11 prereg.

## Mechanical binding

The rule is implemented once, in `optimizer/prompt-lab/admission_rule.py`, with a
registered selftest. `failure_episode_trial.calibration()` delegates to it (core +
E1); the calibration report path consumes the same functions. No tool may restate the
thresholds locally.

## What would change this rule

Only a new preregistration document that names this one as superseded, committed
before the data it governs. Results obtained under this rule are never grounds to
adjust it retroactively; a discouraging calibration is a result.
