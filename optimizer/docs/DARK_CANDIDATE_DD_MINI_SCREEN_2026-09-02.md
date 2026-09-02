# Dark-candidate DD mini-screen and run sizing (2026-09-02)

## Status

This is a mechanism-screen note, not an efficacy result. The daily-driver
(DD) endpoint for `local-llamacpp/qwen36-35b-iq3s` was probed at
`127.0.0.1:8080/health` and returned `OK`; the model was listed as loaded. A
bounded transport smoke then completed with `READY`, exit 0, zero stderr, and
23 safe telemetry rows. The candidate probes below are exploratory wiring
observations only: they are not gate rows, calibration, A/B evidence, or an
adoption decision.

The live mirror was current for the earlier goal smoke, and has now been
refreshed after the context handoff repair: `npm run mirror:check --
/Users/Albert.Wessels/.pi/agent` reports **122 of 122** first-party files match,
with no unmanaged extensions or orphans. The current loaded surface SHA-256 is
`251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`.

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
| Research ledger (earlier single-source contract) | Exit 0 with exactly one bounded `web_read`, one `research_note`, and a `run-summary`; zero stderr. | **Mechanism fired.** This earlier smoke proves citation-recording wiring only; it is superseded by the Run 3 receipt below for current status. |
| Minimal tool surface | Exit 0; the disposable file was created and the run emitted a first-useful-mutation signal. | **Happy path works.** Needs representative read/edit/verify tasks and comparison against the base surface. |
| Research planner / graph | The first corrected ambient Qwen smoke emitted one `research-start` and two pending branches, then entered an unbounded stream on hash `4f5516aa…` and was invalid. A direct exact-copy probe matched `251708fed…` but stopped open. The first run through the new launcher stopped safely at 350,000 bytes after 52.7s, with one `research-start`, two pending branches, and no merge or settlement. | **Bounded lifecycle receipt, mechanism incomplete.** The explicit `--tools` path intentionally prevents planner-family reactivation. The exact-surface bounded run is not efficacy evidence and does not count toward the six-session gate. Use admitted research fixtures, fact-lookup controls, and the launcher for the next screen. |

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
| Dynamic context epochs / handoff | The Qwen startup smoke confirmed epoch wiring. The v1 threshold probe exposed a late-check gap; v2 correctly failed closed on an oversized initial prompt; v3 established two turns but the settled-turn marker was lost before the second handoff check. The follow-up source repairs now abort the active request synchronously before Pi's asynchronous compactor starts and preserve a committed compaction when a later callback reports `Nothing to compact`. | **Clean mechanism receipts recorded.** On loaded hash `251708fe…`, v4 proved one threshold handoff; the rearm screen then proved exactly two one-shot handoffs after below-70% rearming, with two cancelled oversized requests, three successful responses, and zero native compactions. The active-goal preservation screen proved one `ok=true` handoff with a recovery brief and the same active goal ID before and after compaction. The model-switch screen then proved epoch 0 Qwen → epoch 1 Ling rebinding with two successful turns and separate discovery facts. | Prepare and run the remaining dark-candidate mechanism/value screens. A broader cross-provider/window switch remains a later safety study; only afterward decide whether a small paired efficacy study is warranted. | **Yes.** The receipts prove lifecycle reachability, rearming, active-goal preservation, and model-identity epoch rebinding only; they do not measure capacity, quality, or cross-provider/window safety. |
| Working memory | Exit 0 with one `upsert` and one `list`; both private projections were present. | Mechanism fired, but no comparative value evidence. | A small paired smoke with a task that explicitly needs a durable note, checking note use, context cost, and recovery. | **Yes.** Net value is a context trade-off; use several multi-turn tasks with memory on/off and inspect both success and added tokens before considering adoption. |
| Bash-output guard | Preregistered Qwen 35B paired screen completed: B-noisy, A-ordinary, B-ordinary, A-noisy all exited 0 with zero stderr. Treatment withheld exactly one 12,000-character result at the 8,000-character cap; ordinary treatment and both controls had no withheld event. | **Clean paired mechanism receipt.** One bounded recovery error, no second oversized call, one true loaded hash/session per file, and no raw payload fields. No quality or cost claim; the candidate remains dark. | Prepare a later value screen on representative coding fixtures, reporting false positives, recovery cost, context use, and correctness together. | **Conditional.** Do not enable by default from this mechanism receipt. |
| Research ledger | Citation containment, unique re-attribution, refusal recovery, private ledger, quarantine, budget, and wrap-up tests pass. | Post-fix Run 3 completed its deterministic half: 9/10 sessions completed; Q9-A hit the 15-minute bound without an answer. Arm B recorded 22 notes and rejected 24 attempts across 52 searches and 48 reads; all ten telemetry files were hash/run bound and payload-free. The correction path was not exercised (`corrected=0`), refusals/degradation remained (11 `quote_not_found`, 13 `degraded`), and no independent judge was available. The nominal search/read envelope was exceeded outside plan context (up to 28/17). | Decide and test whether ledger budgets are hard outside plan context, then repeat a judge-backed comparison with a complete baseline. | **Yes.** This run cannot establish quality or net context value, and the candidate remains opt-in/dark. |
| Enforced semantic-loop recovery | Semantic/session ladders, rejected-plan progress, recovery receipts, shadow isolation, and abort policy tests pass. The first Qwen 35B mechanism screen settled only `sweep-b`; two fixtures reached the bound without settlement. The current-surface shutdown retest proved safe abort settlement. A fresh 180-second delivery probe then reached 31 turns/36 tool calls with six episodes but no intervention or settlement and was stopped before the second fixture. | **Retired from the near-term Qwen adoption queue; candidate remains dark.** Shutdown lifecycle is repaired, but repeated Qwen/fixture runs cannot deliver a bounded arbiter decision. This is an operability/subject-suitability retirement, not negative efficacy evidence. | Keep `LOOP_EPISODE_MODE=shadow`. Redesign the fixture envelope only if semantic recovery becomes a priority; otherwise proceed to the planner graph with this candidate explicitly retired and isolated from defaults. | **Yes.** Any future semantic study needs a new bounded fixture and powered preregistration; existing rows cannot be pooled. |
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
3. Preserve the context-epoch wiring smoke and threshold diagnostics. The
   source repairs now cover the late check, initial prompts, and settled-turn
   history. The v4 threshold, rearm, active-goal, and same-router model-switch
   receipts are complete and hash-bound; no capacity or adoption claim follows.
4. Do not rerun those completed context screens. A future safety study may test
   a different provider or declared window, but it requires its own
   preregistration and must not pool with these same-router receipts.
5. Preserve the failed Qwen semantic mechanism screen and the incomplete
   delivery probe as non-efficacy evidence. The shutdown retest retires the
   missing-settlement blocker; repeated Qwen/fixture loops still produced no
   bounded delivery, so semantic-loop enforcement is retired from the near-term
   adoption queue. Only a redesigned fixture and fresh preregistration may
   reopen it; proposed exposure artifacts remain distinct from delivered
   arbiter decisions.
6. Preserve the completed research-ledger Run 3 receipt. Decide whether the
   nominal search/read budget should be hard-enforced outside plan context,
   add a red-green test for that policy, and only then repeat a judge-backed
   ledger comparison. Preserve the clean paired bash-guard mechanism receipt;
   a value screen on representative coding fixtures is still optional and
   must report recovery cost, context use, false positives, and correctness.
7. With semantic-loop enforcement explicitly retired for this cohort, use the
   committed hash-verifying planner launcher with an outer stream limit, author
   and admit research fixtures with negative controls, and then run the
   hierarchical planner/deep-research mechanism screen. Follow with a separate
   powered comparative evaluation; keep planner and deep-research flags dark
   until the mechanism screen is complete.

Every model run must bind the current loaded surface, provider/model,
configuration, registry, and serving identity. Rows across a surface or model
epoch never pool.
