# Dark-candidate DD mini-screen and run sizing (2026-09-02)

## Status

This is an offline qualification note, not an efficacy result. The daily-driver
(DD) endpoint for `local-llamacpp/qwen36-35b-iq3s` was probed at
`127.0.0.1:8080/health` and refused the connection. No model, calibration, A/B
round, mirror, or rollout was started. The current source tree therefore has
no new DD observations to pool.

The live mirror is also intentionally stale: `npm run mirror:check --
/Users/Albert.Wessels/.pi/agent` reports exactly **1 of 122** first-party files
different, `extensions/pi-munchkin/extensions/telemetry-flush.ts`. This is the
graceful-shutdown implementation boundary and must be resolved by an approved
mirror before any DD row can be authoritative.

The cheapest deterministic probe did run: the candidate-specific suites for
planning, research ledger, working memory, bash-output guarding, semantic-loop
recovery, context epochs, and dynamic tool activation passed **118/118** tests.
`npm run verify:optimizer` also passed its offline checks (including 35 Python
selftests and the dry gate); Seatbelt/grade-jail checks were reported
unavailable only because this managed sandbox denies `sandbox-exec`.

Passing these tests establishes contracts and safety boundaries. It does not
show that a model invokes a mechanism, recovers with it, or produces better
work. The run lengths below are the minimum useful next evidence, not results.

## Candidate disposition

| Candidate | Minimal result now | DD evidence currently available | Next useful run | Longer run? |
|---|---|---|---|---|
| Hierarchical planner / deep-research graph | Graph, branch, budget, depth, evidence, and settlement contracts pass. Existing screen is still a blocked draft. | None on DD; flags remain off and the current source is not loaded. | After semantic-loop precondition, fixture admission, mirror, and a new loaded hash: six candidate mechanism sessions plus three fact-lookup negative controls, using the existing preregistration. | **Yes.** A later comparative A/B needs multiple complex, contested, and comparative questions; one session cannot expose branch quality or synthesis trade-offs. |
| Persistent goal mode | Goal migration, authority, blocked state, paging, inactive recovery, tool removal, and lifecycle tests pass. | None on DD for the repaired source; it is pending rollout. | First run a 1–3-session pinned DD lifecycle smoke covering start, pause, resume, block, complete/80-20, and compaction recovery. | **Conditional.** If the smoke is clean, use paired long-horizon goal tasks to measure persistence and steering cost; do not judge benefit from the smoke. |
| Dynamic context epochs / handoff | 32K↔128K profiles, endpoint/model rearm, shrinkage, one-shot handoff, stale lease, wording, and endpoint redaction tests pass. | No new DD evidence on this source; the loaded receipt is stale. | One no-goal and one active-goal DD session crossing a safe-budget boundary, followed by a model/provider switch when the serving box supports it. | **Yes.** Handoff safety needs multi-turn, near-budget sessions and at least one cross-epoch switch; a short turn only tests wiring. |
| Working memory | Private ledger, byte/record caps, hostile-note framing, exact restoration, capsule identity, and off-by-default tests pass. | No authoritative DD evidence; the feature is dark. | A small paired smoke with a task that explicitly needs a durable note, checking note use, context cost, and recovery. | **Yes.** Net value is a context trade-off; use several multi-turn tasks with memory on/off and inspect both success and added tokens before considering adoption. |
| Bash-output guard | Oversize withholding, small-output pass-through, non-bash isolation, path-escape messaging, and integration tests pass. | Prior DD round was neutral (89% vs 89%, n=9/arm) and the guard never fired. | A targeted DD fixture that deliberately requests a bounded but noisy shell listing, with guard exposure as the primary outcome. | **Conditional.** Do not spend a broad A/B until the trigger is observed; if it fires, run several noisy and ordinary tasks to measure false positives and recovery. |
| Research ledger | Citation containment, unique re-attribution, refusal recovery, private ledger, quarantine, budget, and wrap-up tests pass. | DD Run 2 supplied weak 10-session evidence: 11 notes recorded, 18 refusals, and one empty answer; fixes were applied afterward. | Execute the already specified post-fix Run 3: five preregistered questions × two arms (10 sessions), with deterministic ledger metrics and an independent judge for synthesis. | **Yes.** The mechanism is opt-in and stochastic; a single DD smoke cannot measure refusal storms, zero-note answers, or answer-quality cost. |
| Enforced semantic-loop recovery | Semantic/session ladders, rejected-plan progress, recovery receipts, shadow isolation, and abort policy tests pass. | No DD efficacy evidence; the enforce screen remains design-only and its current preregistration is for the 4B subject. | Finish or explicitly retire the existing semantic-loop prerequisite, then run its mechanism screen with repeated-failure fixtures before any planner graph screen. | **Yes.** Recovery requires repeated failures across several fixtures and arms; one ordinary coding task is almost guaranteed to miss the mechanism. |
| Minimal tool surface | Core-profile selection, explicit allowlist preservation, capability activation, and surface-parity tests pass. | No DD efficacy result for `MUNCHKIN_TOOL_SURFACE=minimal`; it remains opt-in. | One happy-path DD coding smoke to catch missing tool dependencies, then a paired base/minimal run on representative read/edit/verify tasks. | **Yes.** Tool removal can trade context savings for recovery failures; use multiple task shapes and report tool errors, turns, context, and correctness together. |

## What can be concluded now

The local contracts are healthy, but the DD instrument is unavailable and the
source-only repairs cannot be inferred from the stale live mirror. No candidate
earns adoption or retirement from this note. The only candidate with a useful
prior DD signal is the bash guard's non-firing neutral round; that result
supports a trigger-focused follow-up, not a default flip. The research ledger's
post-fix comparison and the semantic-loop screen both require longer runs by
design. The planner graph is downstream of the semantic-loop gate and must not
be used to bypass it.

## Ordered next actions

1. Human-approve the source boundary, mirror it, and record a new loaded hash.
2. Run the prepared Qwen35B graceful-shutdown settlement smoke in
   `PREREG_QWEN35B_GRACEFUL_SHUTDOWN_2026-09-01.md`.
3. If lifecycle evidence is authoritative, run the short goal/context smoke;
   keep both defaults and dark flags unchanged.
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
