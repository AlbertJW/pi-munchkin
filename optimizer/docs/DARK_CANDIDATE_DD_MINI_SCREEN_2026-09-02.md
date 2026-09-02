# Dark-candidate DD mini-screen and run sizing (2026-09-02)

## Status

This is a mechanism-screen note, not an efficacy result. The daily-driver
(DD) endpoint for `local-llamacpp/qwen36-35b-iq3s` was probed at
`127.0.0.1:8080/health` and returned `OK`; the model was listed as loaded. A
bounded transport smoke then completed with `READY`, exit 0, zero stderr, and
23 safe telemetry rows. The candidate probes below are exploratory wiring
observations only: they are not gate rows, calibration, A/B evidence, or an
adoption decision.

The live mirror is now current: `npm run mirror:check --
/Users/Albert.Wessels/.pi/agent` reports **122 of 122** first-party files match,
with no unmanaged extensions or orphans. The loaded surface SHA-256 is
`7624ee447fb6a9a77f96e4abf5ee9b01580ddd478f3ae67b329f858761e07ca7`.

The cheapest deterministic probe did run: the candidate-specific suites for
planning, research ledger, working memory, bash-output guarding, semantic-loop
recovery, context epochs, and dynamic tool activation passed **118/118** tests.
`npm run verify:optimizer` also passed its offline checks (including 35 Python
selftests and the dry gate); Seatbelt/grade-jail checks were reported
unavailable only because this managed sandbox denies `sandbox-exec`.

Passing these tests establishes contracts and safety boundaries. It does not
show that a model invokes a mechanism, recovers with it, or produces better
work. The run lengths below are the minimum useful next evidence, not results.

## DD mechanism probes (2026-09-02, exploratory)

All runs used an isolated temporary Pi agent directory and the loaded Qwen
35B DD endpoint. Summaries contain only exit status, byte counts, event kinds,
and structural artifact fields; model text, tool arguments, source contents,
and URLs were not retained in the report.

| Probe | Safe observation | Classification |
|---|---|---|
| Goal mode (full and narrowed goal-tool surfaces) | The original full and narrowed probes exited 1 before a model response because Qwen returned `failed to parse grammar`. A red-green compatibility fix then lowered the model-visible nested string limits to 1,999. After mirroring, the authoritative live-surface smoke exited 0 with zero stderr, created/read a goal ledger, reached `complete`, and emitted the expected lifecycle events. | **Live mechanism smoke passed.** The receipt is bound to the loaded hash above, but it is still one happy-path lifecycle, not a gate row or quality result. |
| Context discovery / serving epoch | Exit 0; `context-profile`, `context-calibration`, `context-budget`, and `serving-truth` events appeared once each. No threshold-crossing handoff was attempted. | **Wiring exposed.** Requires a multi-turn near-budget run and a cross-epoch switch for safety evidence. |
| Bash-output guard | Exit 0; a bounded 12,000-character bash result produced one `withheld` event, with no stderr. | **Mechanism fired.** Run noisy and ordinary paired fixtures to estimate false positives and recovery cost. |
| Enforced semantic loop | Exit 0 after three instructed missing-file attempts; three observations/receipts, a tier observation, two steers, one steer injection, one post-steer progress signal, and two unavailable notices were recorded. | **Mechanism ladder exposed.** Needs the preregistered repeated-failure fixture set; this is not an efficacy score. |
| Working memory | Exit 0; one `upsert` and one `list` event, with both private working-memory projections present. | **Mechanism fired.** Needs paired multi-turn tasks to measure whether retained notes repay their context cost. |
| Research ledger (single-source contract) | Exit 0 with exactly one bounded `web_read`, one `research_note`, and a `run-summary`; zero stderr. | **Mechanism fired.** This proves citation-recording wiring only; it is not the post-fix Run 3 comparison. |
| Minimal tool surface | Exit 0; the disposable file was created and the run emitted a first-useful-mutation signal. | **Happy path works.** Needs representative read/edit/verify tasks and comparison against the base surface. |
| Research planner / graph | A research-shaped run emitted `research-start` and persisted a schema-v5 graph with one pending branch, but did not settle inside the 240-second bound. | **Activation exposed, execution incomplete.** Needs a shorter fixture-shaped planner run for contract timing, then the six-session comparative screen. |

These probes do not repair the stale mirror, create gate rows, or qualify any
candidate for adoption. They only identify which mechanisms are reachable on
the DD and which studies are worth the longer budget.

The goal failure had a specific source-level cause. Goal schemas exposed nested
`maxLength: 2_000` bounds for objective text, criterion text, delivered value,
and deferral rationale, while the existing `web_read` schema documents that
this llama.cpp grammar path fails at nested limits of 2,000 or more. The
worktree now lowers only those model-visible caps to 1,999 while retaining the
runtime ledger's independent 2,000-byte validation bound. The targeted schema
test was red before the change and green after it; the live-surface Qwen smoke
confirmed grammar initialization and goal completion. The receipt is recorded
in `PREREG_QWEN35B_GOAL_GRAMMAR_2026-09-02.md` and is authoritative only for
protocol reachability on this loaded surface, not for efficacy.

## Current candidate configuration hashes

These hashes were recomputed from the checkout on 2026-09-02 and supersede any
older unassigned or stale preregistration values:

| configuration | SHA-256 |
|---|---|
| `deep-research-planning.json` | `0d01aab9292db845b5f228174e2a1a4c10328883daebd482dcd9c9c9f5f5fd1e` |
| `deep-research-planning-control.json` | `a2e5efef3ab36d90ab58ee91920b766e5c7a162905da970778e9439c3c1c92f7` |
| `semantic-loop-enforce.json` | `72346849b6358bdf542457ddcea2b3ae19dabb8be56ef7a3e4862cfafc57a7f7` |
| `c35-bash-output-guard.json` | `40b1411d2b2494b7b24a0b3f8d958a0fd9cd9086e6afefde405744d903cf9314` |
| `c46-prompt-lean.json` | `47c9a04ca233ff552ff71e4e4f77003244cb148d8704f38fb62d2f5cf615b639` |

## Candidate disposition

| Candidate | Minimal result now | DD evidence currently available | Next useful run | Longer run? |
|---|---|---|---|---|
| Hierarchical planner / deep-research graph | Graph, branch, budget, depth, evidence, and settlement contracts pass; a DD run emitted `research-start` and persisted one pending schema-v5 branch before its 240-second bound. | Mechanism activation observed, but no settled branch or answer-quality evidence; flags remain dark and the mirror is stale. | After semantic-loop precondition, fixture admission, mirror, and a new loaded hash: six candidate mechanism sessions plus three fact-lookup negative controls, using the existing preregistration. | **Yes.** A later comparative A/B needs multiple complex, contested, and comparative questions; one session cannot expose branch quality or synthesis trade-offs. |
| Persistent goal mode | Goal migration, authority, blocked state, paging, inactive recovery, tool removal, and lifecycle tests pass. The pre-fix DD probes failed before inference with Qwen `failed to parse grammar`; the post-fix live-surface smoke exited 0, created/read the ledger, and settled a goal as `complete`. | **Live mechanism receipt recorded.** The loaded hash is bound and the mirror is clean; no gate, behavior, or quality row is valid yet. | Reissue a current-hash 1–3-session lifecycle screen covering start, pause, resume, block, complete/80-20, and compaction recovery. | **Conditional.** If the lifecycle screen is clean, use paired long-horizon goal tasks to measure persistence and steering cost; do not judge benefit from the smoke. |
| Dynamic context epochs / handoff | The current-hash Qwen smoke exited 0 with empty stderr and emitted one each of `context-profile`, `context-calibration`, `context-budget`, and `serving-truth`; served `65536` versus registry `61440` was `ok`, with endpoint redaction intact. | Startup/epoch wiring is now confirmed on the loaded surface; no threshold-crossing handoff, rearm, or model switch was exercised. | One no-goal and one active-goal DD session crossing a safe-budget boundary, followed by a model/provider switch when the serving box supports it. | **Yes.** Handoff safety needs multi-turn, near-budget sessions and at least one cross-epoch switch; a short turn only tests wiring. |
| Working memory | Exit 0 with one `upsert` and one `list`; both private projections were present. | Mechanism fired, but no comparative value evidence. | A small paired smoke with a task that explicitly needs a durable note, checking note use, context cost, and recovery. | **Yes.** Net value is a context trade-off; use several multi-turn tasks with memory on/off and inspect both success and added tokens before considering adoption. |
| Bash-output guard | Exit 0; a bounded 12,000-character bash result produced one `withheld` event. | Trigger mechanism observed; no false-positive or recovery estimate. | A targeted DD fixture that deliberately requests a bounded but noisy shell listing, with guard exposure as the primary outcome. | **Conditional.** Do not spend a broad A/B until the trigger is observed; now that it fired, run several noisy and ordinary tasks to measure false positives and recovery. |
| Research ledger | Citation containment, unique re-attribution, refusal recovery, private ledger, quarantine, budget, and wrap-up tests pass. A single-source DD contract smoke recorded one read and one note cleanly. | DD Run 2 supplied weak 10-session evidence: 11 notes recorded, 18 refusals, and one empty answer; fixes were applied afterward. The new smoke is wiring evidence only. | Execute the already specified post-fix Run 3: five preregistered questions × two arms (10 sessions), with deterministic ledger metrics and an independent judge for synthesis. | **Yes.** The mechanism is opt-in and stochastic; a single DD smoke cannot measure refusal storms, zero-note answers, or answer-quality cost. |
| Enforced semantic-loop recovery | Semantic/session ladders, rejected-plan progress, recovery receipts, shadow isolation, and abort policy tests pass. A DD exact-three-failure probe emitted three observations/receipts, tier observation, two steers, one steer injection, post-steer progress, and two unavailable notices. | Mechanism ladder observed; no efficacy evidence. | Finish or explicitly retire the existing semantic-loop prerequisite, then run its mechanism screen with repeated-failure fixtures before any planner graph screen. | **Yes.** Recovery requires repeated failures across several fixtures and arms; one ordinary coding task is almost guaranteed to miss the mechanism. |
| Minimal tool surface | Exit 0; the disposable file was created and a first-useful-mutation signal appeared. | Happy-path mechanism observed; no comparative efficacy result. | One happy-path DD coding smoke to catch missing tool dependencies, then a paired base/minimal run on representative read/edit/verify tasks. | **Yes.** Tool removal can trade context savings for recovery failures; use multiple task shapes and report tool errors, turns, context, and correctness together. |

## What can be concluded now

The local contracts are healthy and the DD transport is reachable. The goal
grammar defect is fixed, mirrored, and green in a hash-bound live mechanism
smoke, but that receipt is not a quality result. No candidate earns adoption or
retirement from this note. Bash guarding, semantic recovery, working memory,
minimal tools, context discovery, and goal execution have exposed their wiring;
the research graph started but did not settle within its bound. The research
ledger's post-fix comparison, semantic-loop screen, context handoff safety, and
planner graph all require longer runs by design. The planner graph remains
downstream of the semantic-loop gate and must not bypass it.

## Ordered next actions

1. Preserve the goal receipt in `PREREG_QWEN35B_GOAL_GRAMMAR_2026-09-02.md`;
   do not interpret the pre-fix failures or this happy path as goal efficacy.
2. Preserve the fresh Qwen35B graceful-shutdown run as an invalid lifecycle
   receipt: all three rows reached the task gate but lacked authenticated
   settlement. Do not resume or pool them. The duplicate-SIGTERM timeout cause
   is fixed in gate commit `6ef1464` and the bounded jailed fixture now emits
   `session_shutdown` then `agent_settled`; prepare a new full gate
   preregistration before collecting rows. That screen is now complete: the
   `equil` row is lifecycle-valid at 198/480s, while `parens` (478/480s) and
   `bigdata` remained in active mutation tails and are voided. Record and keep
   those rows separate; the next work is bounded active-tool cancellation and
   semantic-loop recovery, not a longer unqualified retry.
3. Run the prepared context-epoch wiring smoke in
   `PREREG_QWEN35B_CONTEXT_EPOCHS_2026-09-02.md`; keep both defaults and dark
   flags unchanged. Treat it as reachability evidence only, then prepare a
   separate multi-turn handoff/rearm/model-switch screen.
4. Reissue the semantic-loop preregistration if its prerequisite is still
   active, or record its explicit retirement.
5. Run research-ledger Run 3 and the targeted bash-guard trigger screen as
   separate studies.
6. Only after those gates, admit fixtures and run the hierarchical planner /
   deep-research mechanism screen, followed by a separately powered
   comparative evaluation.

Every model run must bind the current loaded surface, provider/model,
configuration, registry, and serving identity. Rows across a surface or model
epoch never pool.
