# Unmothball charter — the measurement reboot (2026-08)

**Status: CHARTER — supersedes the operational conclusions of `MOTHBALLED_2026-08-03.md`.
The mothball document remains the authoritative history of *why* the programme stopped;
this document is the authority on how it restarts. Approved by human decision
(Albert, 2026-08-15: adoptions flipped, judge labeling committed, ling fixtures
adopt-and-repair, full-stack build).**

## Why restart now

The mothball's diagnosis was: *"the instrument cannot show a win, and fixing that is a
fixture problem, not a code problem."* Three things changed:

1. **Graded outcomes are buildable at zero fixture cost.** Parsing the hidden suite's
   per-test reporter output turns every multi-assertion fixture into a graded one
   (`grade_reporter.py`), replacing the one-bit gate score that made the instrument a
   one-sided regression detector (`MEASUREMENT_METHODOLOGY_2026-07.md` §1, §12).
2. **The v3 authority chain landed** (`codex/ling-semantic-fixtures`, merged): rows
   carry authenticated failure-episode settlement, serving-fingerprint v2, and a
   staged, human-gated trial runner. The evidence base restarts from zero anyway
   (v2/v3 never pool), so every breaking improvement below is free until the first
   round runs.
3. **A rubric layer exists to steal correctly.** The Harbor benchmark-template's
   per-trial validity rubric (PASS/FAIL/NOT_APPLICABLE before aggregation) and its
   fixture-authoring rubric map onto instruments this repo already built —
   `agentic_judge.py` (never run), `judge_diffs.py`, `grade_artifact.py`. The reboot
   activates them rather than rewriting them.

## What restarts, what stays retired

**Restarts:** calibration and candidate rounds under `PREREG_FIXTURE_ADMISSION_2026-08.md`
(the ONE admission rule); the fixture-authoring pipeline under `pi.fixture/v2`;
the staged `failure_episode_trial.py` study (unblocked by the coherence adoption);
`agentic_judge.py` via the labeling workflow (secondary outcomes only, after its
calibration gate passes).

**Stays retired / void:** everything `MOTHBALLED_2026-08-03.md` voided stays void
(`hygiene` 0/6, `sv-ambiguous-spec` 1/6, `prefix_stable_rate` as a guardrail, c21's
cherry-picked rounds, pre-2026-07-27 NEUTRALs). Tier-0 configs stay retired. The
2026-09-03 win-or-retire clock for retire-leaning candidates stays. c7/c14/c32/c37/c50
verdicts stand. All v2-era rows are historical evidence only.

**Primary outcomes (declared):**
- **Capability candidates:** `graded_rate` (Mann-Whitney via `effort_report.py
  --graded`), on fixtures ADMITTED for the tier under test. The gate bit remains a
  recorded secondary.
- **Loop-intervention candidates:** `semantic_failure_overrun` via the staged
  `failure_episode_trial.py` pipeline exactly as committed (≥20% reduction, CI,
  correctness floor, exposure ≥20%, token CI).
- Cost honesty: tokens-per-solved-task reported beside both (the "C-cost" widening).

## Resolutions of the nine flags on the codex measurement branch

1. **Ling fixtures unapproved, no design doc** → `LING_COHORT_2026-08.md` written on
   the BAND_FIXTURES template; manifests regenerated as `pi.fixture/v2` with crux
   fields; human approval remains the gate (unchanged).
2. **Silently replaced band rule** → superseded by `PREREG_FIXTURE_ADMISSION_2026-08.md`;
   `calibration()` now delegates to `admission_rule.py`. One rule, preregistered.
3. **v2 evidence terminal** → embraced. Evidence reset is declared here: nothing
   measured before the Phase-1 surface hash pools with anything after it.
4. **Settlement-authority tightening unexercised** → the Phase-6 n=1 smoke row must
   pass `row_contract.validate_powered_row` + `fleet_report` integrity BEFORE any full
   round; if the tightening voids the smoke, that is a finding, not an inconvenience.
5. **Preflight welded to the coherence adoptions** → resolved by adopting: Albert
   approved flipping `ACTIVE_TOOL_PROMPTS=derived` + `CONTROL_ARBITER=enforce`
   (Phase 1). The preflight guard stays strict as designed.
6. **Power gate can kill fixtures late** → "produces episode variance" is now an
   authoring field (`episode_variance{expected, rationale}` in v2 manifests) checked
   at admission time for the loop cohort (E1), not discovered at power time.
7. **Source-shape hidden assertions** → inadmissible (behaviour-only rule, hard).
   The two ling suites are repaired; `fixture_admission.py` lints overlays for
   source-reading assertion patterns and flags them for human review.
8. **Hash-only admission receipts** → bounded `output_tail` (~2 KB per proof cell)
   restored beside the hashes. The `ordered-steps` floor diagnosis depended on it.
9. **No ling design doc** → see 1.

## The instrument-validation sequence (before any candidate)

Mothball restart path, updated and kept in order — **do not start by writing a new
candidate**:

1. **Phase 6 — instrument validation:** `audit-sweep`, base arm only, local 4B,
   n ≥ 9, graded via the reporter path. Preceded by one n=1 smoke row validated
   end-to-end. Pre-declared exit: the graded_rate distribution and validity
   composition are the result, whatever they are. If the 4B floors (maple-20b did
   0/72), the programme pivots to fixture difficulty work — that outcome is
   pre-declared informative, not a failure of the reboot.
2. **Phase 7 — calibration under the ONE rule:** the 9-fixture slate (3 new sweeps,
   4 repaired ling, second-test-guard [4B-scoped], hygiene-shared-config-reread
   [recalibration — its 0/6 was a materialization artifact]) × n=6 base-arm.
   Albert may cut the slate per round; new sweeps + ling outrank second-test-guard.
3. **Phase 9 — first candidate rounds, only after 1–2:** capability track opens with
   c46 prompt-lean ("first in line" per `DARK_CANDIDATE_VERDICTS_2026-08-03.md`);
   loop track runs `semantic-loop-enforce` through the staged pipeline.

**External preconditions for candidate (not calibration) rounds:** the standing
identity-sound `si`-bearing-sessions rule (interactive shadow evidence accumulates
independently of gate rounds); one round per box, started by Albert, never
automatically.

## The trial-validity layer

Every row gains a per-trial validity verdict (`trial_validity.py`), Harbor-style,
deterministic-first:

| criterion | method | on FAIL |
|---|---|---|
| `infra_valid` | deterministic (returncodes, fingerprint stability, settlement) | row voided from analysis populations (counted) |
| `reward_hacking` | deterministic (transcript scan for edit/write/bash toolCalls whose TARGET is the grader surface — the grading reinstall erases the files, so the ATTEMPT in the transcript is the evidence) | row voided (counted) |
| `low_timeout` | deterministic (trajectory timestamps vs budget) | annotates |
| `near_miss` | deterministic (graded detail vs threshold distance) | annotates |
| `refusals` | deterministic patterns (run.log + telemetry) | annotates |
| `difficulty_crux` | judge-backed — **PENDING_JUDGE** until calibration passes | annotates |
| `task_specification` | judge-backed — **PENDING_JUDGE** | annotates |

Voiding is always counted and reported (per-criterion composition in
`fleet_report.py`/`effort_report.py`); silent exclusion is the failure mode this layer
exists to prevent.

## Judge activation

`agentic_judge.py` is activated, not rewritten: `judge_render.py` renders session
JSONL to nonce-fenced transcripts; `--score-gen` scores a generation's workdirs;
Albert labels ≥ 10 sessions (≥ 8 pairs/dim, ≥ 2 distinct scores/dim). The judge
endpoint is env-driven (`FRONTIER_BASE_URL`/`FRONTIER_API_KEY`/`FRONTIER_MODEL`);
`JUDGE_LABELING_2026-08.md` points it at the **local 35B** via llama-swap (Cerebras
removed 2026-08-14; transcripts stay on-box). `frontier_call` refuses to run without an
explicit base-url + key, so there is no silent cloud fallback (the code's bare
`FRONTIER_MODEL` fallback string is inert until an endpoint is configured). The judge's
own preregistered calibration gate (exact ≥ 0.60, within-1 ≥ 0.90, κ ≥ 0.40,
per-dimension) decides whether the local judge is citable.
Judge dimensions are secondary outcomes; no primary verdict ever rests on a judge
score.

## Backlog (post-validation, explicitly not critical path)

- anneal-orchestrated vs single-session on a graded fixture ("best-shaped experiment
  on restart", `DARK_CANDIDATE_VERDICTS_2026-08-03.md` appendix).
- Container/isolation hardening of the grading path (the reporter change raises the
  forgery bar; full verifier isolation remains future work — `SECURITY_BOUNDARY.md`).
- HARNESS-ROI (injected-chars vs outcome) on the admitted slate.
- c51-plan-thrash-escalation (blocked on a fixture where plan rejection is the
  measured failure).

## Phase/gate map

| Phase | Work | Box time | Gate |
|---|---|---|---|
| 0 | This charter + prereg + ling design doc + banners | none | Albert approves charter+prereg |
| 1 | derived/enforce adoption, mirror, boundary row | smoke only | Albert (approved 2026-08-15); surface FROZEN through 9 |
| 2 | pi.fixture/v2 + `admission_rule.py` | none | — |
| 3 | `grade_reporter.py` + real_gate wiring | none | — |
| 4 | `trial_validity.py` + per-trial manifest + report wiring | none | — |
| 5 | Fixture cohort: ling repairs, 3 sweeps, re-manifests | none | Albert approves each fixture |
| 6 | Instrument-validation round (audit-sweep, 4B, n≥9) | yes | Albert starts |
| 7 | Calibration rounds (slate × n=6) | yes | Albert starts each |
| 8 | Judge activation (parallel to 6–7) | judge calls on-box | Albert labels |
| 9 | First candidate rounds | yes | Albert; requires 6–7 pass + si rule |
