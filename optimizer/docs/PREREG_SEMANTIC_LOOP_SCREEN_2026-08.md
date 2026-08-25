# Pre-registration: semantic-loop-enforce calibration + mechanism screen (2026-08-25)

> **STATUS: PREPARED. No stage of this study may be started without Albert's explicit,
> per-stage approval.** This document is committed before any data it governs, as
> `PREREG_FIXTURE_ADMISSION_2026-08.md` requires. It declares the calibration screen and the
> mechanism screen for the dark candidate `LOOP_EPISODE_MODE=enforce`; the powered trial that
> may follow is governed by the staged pipeline exactly as committed
> (`failure_episode_trial.py`, methodology §15/§18, charter `UNMOTHBALL_2026-08.md`).
>
> This document **supersedes `PREREG_FAILURE_EPISODE_BASELINE_2026-08.md`** (its eligibility
> rule predates the ONE admission rule, and two of its three fixtures were voided).

## 1. Candidate

`optimizer/prompt-lab/configs/pending/semantic-loop-enforce.json`, frozen at sha256
`72346849b6358bdf542457ddcea2b3ae19dabb8be56ef7a3e4862cfafc57a7f7`. Control is
`configs/baseline.json` at `5306ecc5a68682ce8fe6d52d59e0171367cfae0f390965bc4956c0f9d706d379`.
The study manifest must carry exactly these two hashes (`failure_episode_trial.load_manifest`
re-derives and refuses a mismatch). One candidate; nothing else is co-tested.

The candidate's sole delta is `LOOP_EPISODE_MODE=enforce` (schema-constrained to
`shadow|enforce`). Everything else — tool profile, planner, arbiter, plateau, capsule — runs at
the adopted defaults in **both** arms.

## 2. Subject and stratum

**Model: `qwopus35-4b`** (local Mac stratum, llama-swap router, bare registry alias, sessions
launched non-interactively with stdin redirected from `/dev/null`). Chosen over the stronger
tool operators because:

- it *demonstrably drives the harness*: calib4b produced 12 authoritative rows with 473 tool
  calls and zero reward-hacking flags — unlike `ling3`, whose ~95% tool-call failure was the
  mothball's stop reason and which is no longer in the registry;
- it *exhibits the failure mode the candidate targets* (repeat spirals, pseudo-tool-calls were
  measured on the small qwen tier). A subject too competent to open failure episodes cannot
  satisfy E1 and would screen the fixture, not the mechanism.

**Mothball posture.** `MOTHBALLED_2026-08-21.md` stands. Restart condition #1 ("a subject that
can drive the harness") is argued satisfied by the subject choice above; conditions #2 (judge
held-out set) and #3 (out-of-process verifier) remain open and are non-blocking for this screen:
the judge-gated validity criteria (`difficulty_crux`, `task_specification`) annotate rows as
`PENDING_JUDGE`, they never void, and no primary outcome reads them. **Albert's approval of the
first stage below is the unmothball decision for this track only.** The Mac stratum never pools
with the network box.

## 3. Fixture slate

Five fixtures (manifest allows 2–12); all approved, none expired (earliest expiry 2026-11-01):

| fixture | why it is on the slate |
|---|---|
| `sweep-b` | `episode_variance.expected: true` — authored as *the loop-cohort instrument* (iterate against a red project gate); band prediction 0.30–0.60 |
| `sweep-c` | `expected: true`; rejection-guard/cycle self-checks fail repeatedly; band prediction 0.10–0.45 |
| `ling-exact-gate-recovery` | `expected: true`; gate failures after the first edit open `verification_assertion` episodes; independent instance of the sweep-b mechanism class |
| `ling-partial-order-release` | `expected: true`; the cohort's test of whether graded partial credit rescues the floored full-pass class |
| `audit-sweep` | the only fixture with **measured** episode exposure (17 episodes, `semantic_failure_overrun` 66, on the p6smoke row — stale surface, ranking evidence only); artifact-graded at the finest resolution (8 subscores). Floor risk on weak subjects is accepted as insurance against the zero-margin ≥2 requirement |

Declared negative expectation: `sweep-a`, `ling-cross-file-contract`, `ling-path-evidence`
(`expected: false`) are deliberately absent; their inclusion would spend sessions on fixtures
authored not to produce episodes.

## 4. Eligibility and admission — by reference only

Per-fixture admission is the ONE rule in `PREREG_FIXTURE_ADMISSION_2026-08.md`, applied
mechanically by `optimizer/prompt-lab/admission_rule.py` (core A1/A2/A3 + the loop-cohort E1
extension). This document deliberately does not restate any threshold. The study stops per the
pipeline if fewer than two slate fixtures come out ADMITTED **and** episode-eligible. All
historical band and exposure numbers cited in §3 were measured on superseded surfaces and are
ranking evidence only; nothing pools across the current boundary.

## 5. Stages, costs, and gates

Scheduler: `optimizer/prompt-lab/failure_episode_trial.py` with a private operator-supplied
study manifest (built by `optimizer/prompt-lab/make_episode_manifest.py`; kept outside the
repository). Every stage is a separate Albert-started action; one round per serving box; nothing
auto-advances.

1. **preflight** — no sessions. Verifies transport safety, source defaults, registry hash,
   fixture authority, and a live serving fingerprint.
2. **calibrate** — 5 fixtures × 6 base-arm sessions = **30 sessions** (shadow; the base arm
   inherits the default `LOOP_EPISODE_MODE=shadow`). Historical 4B session time ≈ 8–9 min
   (stale estimate) → roughly 4–5 h of box time. Produces the admission verdicts and
   `eligible_fixtures`.
3. **mechanism screen** *(added by this prereg; between calibrate and power)* — one
   `real_gate.sh` generation of **6 candidate-arm sessions** on `eligible_fixtures[0]`
   (`ARM=cand`, distinct `GEN`, same frozen configs and surface). **Pass rule: at least 2 of 6
   rows show mechanism exposure — `context.failure_episodes.interventions` non-empty
   (equivalently `exposure.status = targeted` for `failure-episode/intervention`).** On failure:
   STOP and diagnose before any powered stage; first suspect is arbiter pre-emption (§7 hazard
   1), quantified from `control-arbiter/decision` rows. These 6 rows are a screen, never trial
   data: they carry a different generation, are not bound to any manifest cell, and are excluded
   from power, primary, and replication. No efficacy claim of any kind is made from them.
4. **power** — computation only, on the calibrate rows (zero-inclusive
   `semantic_failure_overrun`, 30% binomial-thinning alternative, 500×1000 bootstrap,
   n ∈ 40–80/arm, ≥80% required; failure at 80 stops the study).
5. **primary / replication** — 2 × power_n sessions each on `eligible_fixtures[0]` /
   `[1]` (80–160 sessions per stage at the smallest/largest n). Outcome, guards, and the
   adoption predicate are the committed pipeline's, by reference (§15/§18: ≥20% reduction with
   the 95% bootstrap interval below zero, correctness ≥ −5 pp, intervention exposure ≥ 20%, no
   significant token regression, same-direction replication). Reports never auto-flip a default.

## 6. Exposure definitions

- **Calibration (shadow) exposure** — per session: `failure-episode/observed` reaching
  `count ≥ 2`, `failure-episode/tier-observed` with `mode="shadow"`, and **exactly one**
  `failure-episode/settled` summary with `semantic_failure_overrun > 0`. (E1 itself is the
  admission rule's; this is the mechanism-level reading beside it.)
- **Enforce exposure** — `failure-episode/intervention` (the candidate config's declared
  target). This records **proposal**, not delivery (§7 hazard 2); the delivered count —
  `control-arbiter/decision` rows with `winner_reason = "semantic_tier"` — is reported beside it
  wherever exposure is cited. Tier-3 walls additionally surface as `loop-breaker/block` and
  `failure-episode/receipt`.
- **Forbidden as exposure evidence:** `failure-episode/resumed` (dead under the adopted
  `RUN_CAPSULE=recovery` default — `/loop-resume` takes the capsule path and never records it)
  and any `injected_chars > 0` filter (tier-3 interventions legitimately carry
  `injected_chars: 0` and would be silently dropped).

## 7. Declared measurement hazards (verified in source before this prereg)

1. **Arbiter plateau collision.** `VERIFICATION_PLATEAU=enforce` (adopted default, both arms)
   proposes `failure_recovery` at the same arbiter priority (600) as semantic tier-1/2 steers;
   equal-priority ties break on emission index and the loser is **dropped, not merged**. A
   semantic intervention can therefore be proposed and recorded yet never reach the model. Both
   arms share the config, but only the enforce arm has semantic proposals to lose. Consequence:
   the mechanism screen (§5.3) gates on proposal exposure but its diagnosis path reads
   `control-arbiter/decision`; any powered analysis citing exposure must report
   proposed-vs-delivered side by side.
2. **Proposed ≠ delivered.** `failure-episode/intervention` records unconditionally in
   `applyEpisodeAction` before the arbiter decides, and its `injected_chars` is the
   pre-composition message length (the arbiter may merge lens/verification text around it).
   `injected_chars` is descriptive only; never a filter, never a delivery proof.
3. **Dead secondary metrics — fixed 2026-08-25.** `context_telemetry.py` required 64-hex
   `episode_id`s while the harness emits 16-hex ids, silently zeroing `failures_after_second`,
   `recovered_episodes`, and `recovery_calls_total/max` on every real row. Fixed (with a
   counterfactually-proven self-test) before any row of this study exists. The primary outcome
   `semantic_failure_overrun` was never affected (it comes from the settled summary).
4. **Exact-detector masking.** Equal-tier exact call/outcome detectors outrank
   `semantic_episode` in the one-action-per-turn selection. A fixture whose failure loop repeats
   *byte-identical* calls will mask semantic interventions. The slate's episode generators
   produce varying call variants against stable failure classes, which is the semantic-dominant
   shape; the calibrate stage's `tier-observed` detector breakdown is the check.
5. **Subagent asymmetry.** Tier 2 additively activates `subagent`, so the enforce arm is more
   likely to spawn children. Children inherit the enforce env but are excluded from the
   authenticated telemetry channel: each child emits its own settled row in its own session and
   **cannot** contaminate the parent's single-settlement contract. Child effort is still real
   cost; token totals remain the guard.

## 8. Identity freeze

The study manifest (private, operator-held) binds, and every row is refused unless it matches:

- loaded harness surface
  `3cbb10ede617e95033992654906912e2262596c6f7910f03597cefe3020a9d49` (the `2026-08-25`
  hierarchical-planner merge row in `docs/SURFACE_BOUNDARIES.md`; source `69ea21cd…`). The helper recomputes
  the live loaded hash at manifest-build time; if either hash differs from the values here,
  THIS PREREG IS STALE and must be re-issued before any session runs.
  [RE-ISSUED three times 2026-08-25 under this rule, before any data: shotgun
  (`acd18a54…`) → reload-re-entry fix (`12e1896b…`) → explicit-inference fix (`a9461aee…`) →
  the dark hierarchical-planner merge bound above. The candidate and control configs are
  untouched by all three; PLAN_GRAPH/DEEP_RESEARCH_PLANNING stay off in BOTH arms. Zero
  sessions have run; nothing else in this prereg changed.]
- model-registry sha256 (of the live `models.json`, hash computed without display),
- both config sha256s (§1), and the rendered-governor sha256 (variant-A render of the live
  governor; identical for both arms by construction, asserted by the helper),
- serving fingerprint stability pre/post within every session; one serving contract per stage.

No row from any earlier surface, schema generation, or serving identity pools with this study.

## 9. What this study cannot conclude

Calibration and the mechanism screen make **no efficacy claim** — they establish only that the
instrument can express the effect (band + variance) and that the mechanism fires. Only the
powered primary + replication, under the committed adoption predicate, can support a default
flip, and that flip remains a separate human checkpoint regardless of the numbers.
