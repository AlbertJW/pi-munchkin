# Recommended harness improvements — 2026-09-06

Detailed goals, implementation steps, acceptance criteria, dependencies, and
progress tracking: [Harness improvement plan](HARNESS_IMPROVEMENT_PLAN_2026-09-06.md).

The audit repairs are committed in `cac3926`; release documentation is in
`8badd9a`. Both are on main and pushed. The first live-sync attempt was refused
because a user Pi session remained open. No files were copied by that attempt.
The source surface is
`cebc32aa4d451ad9c06bbf2abfe5fd8864dd68070ccb87f8b9e3115d0efe4720`.
This note proposes work; it does not activate goals or authorize experiments.

## 1. Make continuation and stopping one runtime decision

This is the highest priority. Goals, research synthesis, citation correction,
verification, and context handoff can independently request another turn.
Unify their requests through one owner that knows the active session, goal and
plan identities, revision, cancellation state, and pending work. Reuse the
existing control arbiter where its contract fits rather than adding another
parallel controller.

Start with a no-network fixture using a real Pi AgentSession and a scripted
provider. Exercise pause, cancel, replacement, resume, settlement, compaction,
late child reports, and duplicate callbacks while a follow-up is queued.
Count actual provider requests and tool executions. Require no obsolete work
after cancellation, no duplicate follow-up from competing mechanisms, and an
explicit continuation path for useful unfinished work. Context filtering alone
does not establish those guarantees.

Deliverable: one documented lifecycle contract, runtime-level regression
tests, and a prepared pinned-model smoke. A smoke is the next release proof;
it is not efficacy evidence.

## 2. Enforce an aggregate context budget per serving epoch

The current context profiles already track the serving model and window.
Extend that accounting across everything admitted to a turn: instructions,
tool schemas, history, goal brief, research notes, retrieval output, and
reserved completion space. Several individually bounded tool outputs can
still overflow the combined budget.

Allocate reads and summaries from the remaining budget and preserve full
artifacts behind bounded retrieval. Recalculate on every model/endpoint/window
switch. Test a populated 128K session switching to 32K, concurrent tool outputs,
served-window shrinkage, failed compaction, and recovery without losing the
objective or evidence references. Publish counts and truncation decisions,
never raw private text.

Deliverable: explicit admission accounting and deterministic overflow/recovery
tests, followed by the prepared model-switch smoke.

## 3. Establish a small representative benchmark

Use admitted tasks covering coding edits, failure recovery, documentation,
long-context work, and complex research. Start with a small fixed slate, then
grow it only between campaigns. Record correctness, unsupported claims,
unnecessary tool calls, completion time, input/output usage, and unwanted
continuation. Keep protocol qualification separate from task effectiveness.

Qwen 35B remains the initial adoption cohort. Ling qualifies harness portability;
its results do not establish larger-model performance. Compare identical
case/seed/repetition blocks within each model and surface. Use a Codex reference
only as separately labelled context, not pooled evidence.

Deliverable: frozen baseline manifest, calibrated tasks, decision thresholds,
and an explicit human-run command. Change one mechanism at a time afterward.

## 4. Simplify deep research around named evidence gaps

Build on the existing graph, shared retrieval budgets, parent evidence ledger,
and Jina Reader fallback. Make the next action answer a specific question:
which required claim lacks evidence, which source could resolve it, and how
much budget remains? Keep returned source leads compact and reread material
citations at the parent before synthesis.

Prove that delayed children trigger one synthesis opportunity, blocked branches
remain explicit, repeated URLs do not buy fictitious progress, and settlement
is followed by a final useful answer. Preserve the bounded hierarchy rather
than expanding delegation depth. Test the coordinator offline before preparing
a fresh complex-research screen on the current source.

Deliverable: reliable parent synthesis and measurable answer/citation quality.
The historical planner no-go screens remain historical; successful deployment
of repairs does not reverse their verdicts.

## 5. Qualify optimizer statistics before new campaigns

Candidate and event authority are now stronger, but the policy named exact-sign
currently implements a net-fix threshold. Make the distinction between an
engineering acceptance threshold and a statistical significance rule explicit.
Review continuous-policy options, reflection classifications, repeated-trial
uncertainty, development selection bias, and guard-cohort completeness.

Deliverable: policy contracts with independently calculated golden examples,
invalid-input tests, and no changes to historical evidence. The first campaign
should remain one family, one iteration, a tiny admitted pack, and a human
review packet with no automatic adoption.

## Hold until the benchmark can measure them

Working memory, additional steering, deeper delegation, and broader default
tool exposure should wait for a specific failing task and a measurable
hypothesis. Use the benchmark to identify mechanisms that add context or turns
without improving results, then simplify or remove them. Avoid simultaneous
promotion of unrelated dark candidates.
