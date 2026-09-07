# Harness improvement plan

Created: 2026-09-06
Reviewed: 2026-09-07, against the current worktree and test bodies.
Status: G01 has a fresh disposable pinned Ling protocol receipt after the 2026-09-07 continuation-authority hardening. G02 now has producer integration, offline verification, and a clean pinned Qwen→Ling mechanism receipt; it remains opt-in and has no quality evidence. G03 now has a fail-closed ingestor for fresh real gate rows, exact validity sidecars, and a strict research-shaped row adapter with timeout and symlink hardening (commits `1da150a`, `20adf3a`, `88faf05`, `8f30f10`, `6a30858`, `3039087`), but its Qwen 35B baseline has not run. A 2026-09-07 readiness probe found the frozen G03 source/loaded-surface bindings stale, and the latest dry gate resolves `defiant-9b` rather than Qwen 35B, so a new pack/preregistration revision and serving selection are required before execution. G04's approved screen returned no-go/inconclusive. G05 is pending. This document does not activate an experiment.
Reference: audit `docs/HARNESS_AUDIT_2026-09-06.md`, recommendations `docs/NEXT_HARNESS_IMPROVEMENTS_2026-09-06.md`.

## Purpose and starting point

Make Munchkin reliably preserve the user's objective, continue useful work,
stop when instructed or finished, and fit the active model's context window.
Then measure whether its research and optimization machinery improve actual
outcomes. Prefer fewer independent control paths and stronger runtime evidence.

The starting audit repairs are committed in `cac3926`; `c7ea142` contains the
published recommendations. The last observed live-sync attempt was blocked by
an open Pi session. These are historical observations, not a fresh readiness
check. Read the current source, worktree state, mirror receipt, and runtime
version before implementing any goal.

Use the stable IDs below when referring to work, tests, commits, and evidence.

| ID | Goal | Main outcome | Dependencies |
|---|---|---|---|
| G01 | Authoritative continuation and stopping | One owner decides whether another harness-driven turn may run | Foundation for G02/G04; repaired surface has a fresh disposable Ling receipt |
| G02 | Aggregate context admission | Every request fits a justified budget for its serving epoch | Use G01 for compaction/resume ownership |
| G03 | Representative evaluation baseline | A reusable, trustworthy way to measure task benefit and harm | Registry and offline protocol exist; real baseline remains pending |
| G04 | Evidence-gap research orchestration | Bounded research reaches a supported answer or an explicit unresolved gap | G01/G02 for execution; G03 for evaluation |
| G05 | Qualified optimizer decision policies | Search and selection obey explicit, tested statistical rules | Can develop offline alongside G03; required before automatic campaigns |

Recommended sequence: G01, G02, then establish G03. Develop G04 against that
baseline. Complete G05 before using the optimizer to select candidates. G05
does not prevent manually specified, human-approved mechanism screens; those
screens still need their own preregistered decision rules.

## Current review: what worked, what remains, and what is next

The earlier declaration that G04 was fully complete is superseded by this
review. A valid no-go evaluation satisfies an evaluation outcome; it does not
waive the implementation or end-to-end acceptance criteria. Keep the original
criteria below unchanged and close them with direct evidence.

Useful work is present: explicit claim obligations and gaps, a typed research
round ledger, bounded allocations, duplicate handling, parent evidence checks,
G01 synthesis offers, and private persistence. Post-screen repairs close
undispatched branch reservations and correct the six-field child-receipt
validator. The focused review reran the research and planner integration suites:
12 ledger tests and one wrapper exercising 57 child tests pass. A subsequent
G01 audit added red-green regressions for cross-wrapper authority replacement,
cross-wrapper dispatcher deactivation, single-flight continuation flushing,
session-reload cancellation, and shutdown rebind; follow-up test proof now
drives the rebound authority through an actual provider delivery. The focused
control suite is now 37/37 and the real-session/planner integration set is
75/75. The fresh
repository-wide offline gate previously passed 786/786 tests and all six
stages. The current G03 change leaves harness sources untouched; its optimizer
verification is green, while a repeated full verification currently reproduces
three pre-existing compact-tool/AgentSession timing failures in the harness
test stage. These repairs still need a new pinned live smoke; historical
receipts remain bound to their old surface.

The approved screen used a disposable mirror. Ling's complex treatment exited
after 156.945 seconds with three blocked branches and no settled answer; its
control timed out after 181.017 seconds. Its simple fact lookup completed after
28.480 seconds without graph activation. Qwen's candidate and control timed
out after 300.182 and 301.026 seconds, respectively; neither produced a terminal
answer, and the candidate did not start the graph. These outcomes establish no
quality improvement. Correctness and citation support remain unscored or
inconclusive, and output bytes are a transport measurement, not token usage.

The source used for that screen was
`5d333e03d863c7374f7a45b3d277e85b54725b7c33f08140eda90bcc0253c62f`,
with disposable loaded hash
`7d5353d80cd2ee75acc8ceab6d0d0633aaef1701ee8d716061a107764c77319d`.
The subsequent offline repair has source hash
`92f2e6d6c24335a5e7f1c1bf2df1af3c0ea860c7d1d8315d49d4676c44b307ef`;
the earlier runs do not validate that repaired surface. The G02–G04 changes
referenced by this review are now committed on `main`; the G01 hardening is committed at
`6a2d4ec` and `a9cab65`, with the post-shutdown dispatch proof in `36cfeab`.
Implementation,
commit/push, mirror synchronization, and adoption are separate milestones.
The earlier post-audit source-surface hash, including the continuation fixes, was
`68d1152c8e30673f67a2ae0ee6e06acc43e859536b9d36d391b1184ddc26e0f2` and has
not been loaded into the live agent directory. The latest repaired worktree
source-surface hash is
`9aed85c14ebae22b7f255d00fbe9eb7a8a90b023a450291837ef9cf40e67bc18`.
A clean committed G01-only
snapshot was separately materialized in a disposable agent directory for the
fresh protocol receipt below; its loaded hash is recorded in `docs/evidence/G01.md`.
It is also repository-only and has no live mirror receipt.

### Findings that prevent full completion

- **G01 reload and flush authority (repaired and disposable-smoke verified):** the
  continuation and dispatcher markers were wrapper-local even though Pi keeps
  the underlying event bus across extension reloads, and asynchronous
  authorization could overlap two flushes. An in-flight authorization also
  survived a session reload and could hold the next session behind a stale
  promise. The current worktree broadcasts replacement/deactivation,
  serializes flushes, cancels stale lifecycle generations, and rebinds the
  authorities when a process-reused session starts after shutdown. The focused
  regressions pass 37/37, the combined real-session/planner set passes 75/75,
and the fresh offline gate passes 786/786. The 2026-09-07 disposable Ling
  receipt drives one real goal update, one arbiter-delivered continuation, and
  a clean exit; it validates the protocol path without changing the live
  mirror or providing model-quality evidence. An unrestricted full-tool Ling
  attempt timed out and remains an explicit loop-risk limitation.

- **G04 runtime enforcement (repaired 2026-09-07):** new v1 deep-research
  graphs now fail closed when the ledger is missing or malformed, and settlement
  requires an explicitly settled parent ledger. Legacy graphs are marked
  explicitly and retain their compatibility path. Ledger mutations use a
  single-writer file lock with atomic publication, so concurrent parent rounds
  preserve every record and budget unit.
- **G04 final-answer proof (repaired 2026-09-07):** `plan_settle` requires a
  bounded `final_answer` for the v1 research contract, rejects citations that
  are not parent-validated, returns the answer exactly once, and terminates the
  loop. A real scripted `AgentSession` fixture proves the persisted answer and
  that a late branch signal cannot start another provider turn.
- **G04 recovery proof (repaired 2026-09-07):** a real Pi compaction lifecycle
  and a fresh session preserve the parent ledger's outstanding reservation and
  unresolved claim. The helper persistence tests remain as lower-level coverage.
- **G04 merge authority (repaired 2026-09-07):** the branch-result handler now
  binds ledger acceptance to the graph merge outcome. Ignored reports cannot
  create reservations or mutate evidence; rejected reports are charged as
  bounded failures. Duplicate and late reports remain idempotent.
- **G02 production integration (superseded 2026-09-07):** the initial review
  found that the admission extension created a reservation ledger without
  connecting producers. The remediation now exposes an epoch-scoped,
  digest-only reservation boundary, wires Ketch search/read output caps into
  it, releases reservations at Pi tool finalization, and routes recovery
  assembly through the preservation contract when admission is enabled. The
  aggregate feature remains dark pending its pinned model-switch smoke.
- **G03/G04 evaluation coverage:** G03 has a registry and an offline runner, but
  its real baseline is still pending. The G04 early-stop sample is not that
  baseline or a completed quality comparison. Reconcile execution receipts with
  the preregistered order, stop rules, and exclusions before preparing a rerun;
  report deviations rather than changing the historical protocol.

These findings narrow previous completion claims, not the intended goals.
Goal-specific evidence notes remain historical records where they disagree
with this review; their acceptance labels need reconciliation during remediation.

### Ordered next work

1. **Re-run the repaired G04 screen when approved.** The runtime enforcement and
   direct lifecycle proofs are now green offline (G04-A through G04-D). Preserve
   the approved no-go report, issue a fresh preregistration against the repaired
   surface, and run Ling for protocol smoke followed by Qwen 35B for effectiveness.
   Keep the graph flags dark until the new screen separates activation, latency,
   citation correctness, and completion outcomes.
2. **Keep G02 dark and measure value separately.** Producer reservations and
   recovery preservation are wired, and the pinned Qwen→Ling mechanism smoke
   proves epoch rebinding and admitted requests. Prepare a later 128K/32K value
   and safety screen with concrete limits and usage receipts; do not infer that
   this protocol smoke establishes capacity or quality.
3. **Complete the G03 baseline and diagnose research activation.** The shared
   reducer and strict research-shaped row adapter are now wired; the remaining
   work is to emit the private research artifacts during a live run. Inspect the
   saved Qwen traces to separate routing, tool-contract, scheduling, and inference
   latency. Prepare a reproducible real baseline with actual outcome oracles and
   reconstructable provenance. Do not simply lengthen the timeout or change the
   task until the failure mechanism is understood.
4. **Keep historical G04 evidence isolated.** The prior Ling/Qwen no-go remains
   valid only for its recorded source and loaded hashes. Do not pool it with the
   repaired-surface run; promotion still requires a separate evidence-based
   decision.
5. **Then complete G05.** Qualify numerical acceptance and learning policies with
   independent golden calculations before optimizer-driven selection. Prepare a
   tiny review-only campaign after the baseline and policy gates are satisfied.

Immediate priority is steps 1 and 2. More search engines, deeper delegation,
working memory, and broader optimizer autonomy do not address the demonstrated
completion and enforcement gaps. `PLAN_GRAPH` and `DEEP_RESEARCH_PLANNING`
remain off by default.

## Shared working and completion rules

Each goal has three separately recorded milestones:

1. **Implemented:** source and documentation are complete and reviewable.
2. **Offline verified:** required regression and integration evidence passes.
3. **Live validated:** any specified human-approved smoke or evaluation has
   run against the recorded source/config/model/loaded-surface identities.

Passing tests does not imply live validation. Synchronizing files does not
establish runtime behavior. A smoke proves only the behaviors it actually
exercises; it does not establish model-quality improvement.

For each goal, retain a goal-specific evidence note containing the defect or
hypothesis, failing-before/passing-after results, actual runtime version,
verification commands and outcomes, commit IDs, surface fingerprints,
remaining limitations, and rollout/rollback status. Use proposed paths
`docs/evidence/G01.md` through `docs/evidence/G05.md`; create them as work begins.

Use private fixtures and scripted providers for offline tests. Add a failing
regression before repairing a reproduced defect. Preserve unrelated changes,
stage explicit paths, and run the public-repository secret scan before pushing.
Do not change historical receipts or pool measurements across model, config,
benchmark, or surface identities.

Human approval remains required for live inference, calibration, campaigns,
and promotion. Prepare the exact command, limits, identities, and expected
receipt before requesting execution. Existing approval for a particular action
should not be requested again. Check that Pi is stopped before mirroring.

80/20 settlement can defer optional polish or broader coverage with value,
risk, and rationale. It cannot waive user control, evidence integrity, budget
enforcement, required tests, or an unperformed live-validation requirement.
If a goal stops after offline verification, record it at that milestone.

## G01 — Authoritative continuation and stopping

### Goal statement

Make every harness-generated continuation pass through one authoritative
runtime decision, so useful unfinished work continues once when appropriate,
while paused, cancelled, replaced, blocked, or settled work cannot be restarted
by obsolete queued messages or late callbacks.

### Why this matters

Goals, research synthesis, citation checks, verification, and model handoff
currently have separate ways to request more work. The repaired context filter
can remove stale instructions, but does not prove that an already queued
provider turn is cancelled. A test double also previously hid a real callback
contract error. The next proof must exercise actual scheduling.

### Implementation work

1. Inventory every first-party `sendMessage`, `sendUserMessage`, automatic
   follow-up, abort, compaction, and recovery trigger. Record its owner,
   lifecycle hook, queue behavior, and supported Pi callback contract.
2. Define typed continuation requests with session identity, goal/plan identity
   where applicable, revision or cancellation generation, reason, idempotency
   key, and bounded expiry. The decision rechecks persisted authority at dispatch.
3. Extend the existing control arbiter where appropriate. Preserve its safety
   priorities and verification duties. Avoid a second competing dispatcher.
   An extension proposes work; the owner authorizes and records its delivery.
4. Specify priority and merge rules. User pause/cancel/replacement and hard-stop
   conditions invalidate obsolete requests. Several compatible requests at one
   boundary produce at most one provider continuation, with bounded content.
5. Define cancellation's precise boundary. Once the authoritative transition
   commits, queued obsolete requests must not start. Already executing provider
   requests or tools receive the supported cancellation signal; partial effects
   are reported, not claimed to have been undone. Preserve unrelated user work.
6. Migrate goal continuation, research synthesis/citation correction, and context
   handoff to this ownership model. Bind late results to the originating session
   and generation. Completion must still allow delivery of the final answer.
7. Persist the minimum decision state needed across compaction and recovery.
   An unchanged goal update cannot earn another retry. Recovery must neither
   lose useful pending work nor replay an already consumed request.
8. Build a no-network fixture with a real Pi `AgentSession` and scripted provider.
   If Pi lacks a necessary queue operation, document that API gap and implement
   a supported integration change; do not conceal it with casts or a permissive
   test double.

Likely starting files: `harness/extensions/plan-runner.ts`, `ketch.ts`,
`runtime-truth.ts`, `control-arbiter.ts`; `harness/lib/control-proposal.ts`,
`control-arbiter.ts`, `goal-state.ts`, and `compaction-coordinator.ts`.

### Required acceptance criteria

- **G01-A:** Real-session fixtures count actual provider requests and tool
  executions. Pausing/cancelling/replacing at each tested queue boundary starts
  zero obsolete requests after the authoritative transition.
- **G01-B:** Duplicate events, late child results, competing correction requests,
  reloads, and repeated no-op goal updates cannot manufacture duplicate work.
- **G01-C:** Pause, block, cancellation, full completion, and 80/20 settlement
  stop autonomous steering. Only a user-owned transition resumes an inactive goal.
- **G01-D:** A live active goal with justified pending work receives one valid
  continuation. An ordinary user message is never discarded as stale harness work.
- **G01-E:** Compaction and recovery preserve the complete objective through
  authoritative storage and bounded inspection. Final-answer delivery remains
  possible after plan settlement.
- **G01-F:** A bounded, pinned-model lifecycle smoke confirms the exercised
  control transitions, with a fresh loaded-surface and telemetry receipt.

### Completion evidence and permitted deferrals

Deliver the inventory, transition/ownership contract, real-session race tests,
and smoke receipt. UI polish and additional explanatory status views may be
deferred. Queue ownership and the actual-provider-call assertions may not.

## G02 — Aggregate context admission per serving epoch

### Goal statement

Before every provider request, account for the combined context being sent and
admit it only within a justified input budget for the active serving epoch,
while preserving the user's objective and access to essential evidence.

### Why this matters

Individually bounded tools can still overflow a request when several results,
schemas, notes, and history are combined. Switching from a large context window
to a smaller one must change the admission decision immediately.

### Implementation work

1. Inventory all context contributors: system instructions, tool schemas,
   retained history, user input, goal/recovery briefs, research cards, tool
   results, and any working-memory notes. Identify double-counting risks.
2. Define one accounting record per request and serving epoch. Include effective
   window, input allowance, completion reserve, overhead, estimated/observed
   usage, uncertainty margin, and reservations for outstanding tool results.
   State whether the tokenizer is exact, estimated, or unavailable.
3. Count completion reserve and overhead once. Reconcile the assembled provider
   payload with the admission record; metadata from an earlier model cannot
   authorize a request for the new model.
4. Allocate retrieval/output allowances from the remaining aggregate budget.
   Concurrent results share reservations; they do not each receive the entire
   remainder. Store full artifacts privately and expose bounded pages or excerpts.
5. Establish a preservation order: user objective and constraints, active state,
   required evidence references, and the next action precede optional commentary.
   Never silently discard requirements. Truncation must be explicit and recoverable.
6. Recompute on provider/model/endpoint/window changes and served-window shrinkage.
   Route compaction and continuation through G01. Retain the documented handoff
   hysteresis unless evidence supports an independently reviewed policy change.
7. Handle unknown usage, an oversized initial prompt, failed compaction, and
   stale callbacks explicitly. If safe admission cannot be justified, return a
   bounded actionable reason rather than silently sending the oversized request.

Likely starting files: `harness/lib/context-profile.ts`; extensions
`runtime-truth.ts`, `context-inlet-guard.ts`, `context-surface.ts`,
`compact-tool.ts`, and the consumers that supply retrieval/recovery text.

### Required acceptance criteria

- **G02-A:** Fixtures assemble competing context contributors and prove the
  combined admitted payload plus reserves stays within the declared accounting
  envelope. An underestimated token count is distinguishable from a verified count.
- **G02-B:** A populated 128K session switching to 32K, and the reverse switch,
  preserve objective/criteria identity and recalculate the budget before dispatch.
- **G02-C:** The same model ID on different providers/endpoints creates distinct
  accounting epochs. Served-window shrinkage invalidates the old allowance.
- **G02-D:** Concurrent tool outputs, repeated compaction callbacks, and recovery
  cannot multiply reservations or send an unauthorized follow-up.
- **G02-E:** Failed compaction and oversized initial input have deterministic,
  bounded outcomes. Required state remains inspectable after compaction.
- **G02-F:** Telemetry contains counts, hashes, confidence, and outcome classes;
  it contains no raw endpoints or private context. A pinned model-switch smoke
  records actual usage and the exercised handoff behavior.

### Completion evidence and permitted deferrals

Deliver the accounting contract, preservation policy, stress fixtures, and
model-switch smoke receipt. Exact tokenizers for every provider and visual
budget dashboards may be deferred if the fallback is conservative, labelled,
and tested. Aggregate admission and requirement preservation are mandatory.

## G03 — Representative, reproducible evaluation baseline

### Goal statement

Create a small governed benchmark that measures whether harness changes improve
real task outcomes without hiding regressions, invalid trials, excess context,
or unwanted continuation.

### Implementation work

1. Inventory and reuse admitted fixtures. Propose an initial 12-case slate:
   two coding edits, two failure-recovery tasks, two documentation tasks, two
   long-context tasks, and four research tasks (comparative, contested,
   multi-part, and lightweight fact lookup). Adjust only before freezing the pack.
2. Define deterministic local oracles wherever possible: persisted edits,
   verification outcomes, required artifacts, evidence coverage, source identity,
   stop behavior, and isolation. Any human/model rubric needs a documented
   procedure and must not turn eloquent prose into correctness evidence.
3. Version the pack, admission receipts, split assignment, seeds, repetitions,
   timeouts, and resource limits. Keep development/test payloads quarantined from
   optimizer diagnosis. A small pilot may expose insufficient discrimination;
   record that and revise the next pack rather than changing an active campaign.
4. Separate protocol qualification from effectiveness. Ling remains a portability
   smoke subject. Qwen 35B is the first adoption cohort. Resolve the registered
   model and actual serving configuration at preparation time.
5. Freeze an explicit baseline and one candidate contrast. Preserve provenance,
   grading, isolation, and privacy controls in both arms. Match case, seed,
   repetition, context configuration, and time limits; randomize arm order.
6. Record primary task outcome plus hard guards and secondary costs: unsupported
   claims, unwanted continuation, tool calls/retries, wall time, input/output
   tokens, compactions, and invalid-trial reasons. Missing child telemetry remains
   unavailable and must not be reported as zero cost.
7. Prepare and run an explicitly approved bounded baseline screen. Report per-case
   and per-cohort outcomes. A separately labelled Codex reference can provide
   context; its observations must never be pooled with local-model trials.

Likely starting areas: `optimizer/real-gate-fixtures`,
`optimizer/research-fixtures`, `optimizer/prompt-lab/tool_contract.py`,
`optimizer/v2/benchmark.py`, `pi_gate.py`, and existing provenance/reporting tools.

### Required acceptance criteria

- **G03-A:** Every admitted case has a versioned specification, oracle, limits,
  split membership, and isolation receipt. Duplicate/leaking splits are rejected.
- **G03-B:** Offline fake runs prove pairing, arm identity, configuration binding,
  telemetry binding, invalid-trial handling, and deterministic report generation.
- **G03-C:** The first real baseline has a complete provenance audit and reports
  every attempted trial, including exclusions and timeouts with reasons.
- **G03-D:** Ceiling/floor or insufficient-sample results are explicitly
  uninformative/inconclusive. The 12-case pilot does not automatically establish
  statistical power or authorize adoption.
- **G03-E:** Protocol results, model-quality results, and external references are
  visibly distinct. Historical surface/model identities remain separate.
- **G03-F:** A reviewer can reconstruct the reported result from immutable
  manifests and private receipts without rerunning inference.

### Completion evidence and permitted deferrals

Deliver the admitted pack, frozen baseline preregistration, executed baseline
report, and reconstruction instructions. Large fleets, many repetitions, and
external reference runs may be deferred. Provenance, useful oracles, a completed
baseline, and honest uncertainty may not. Adoption remains a later decision.

## G04 — Research driven by explicit evidence gaps

Progress (reviewed 2026-09-07): the contract and helper tests are present, but
full implementation and end-to-end verification remain incomplete. The review
above identifies settlement, merge-authority, final-answer, and recovery gaps.
The parent-only `research_round` tool remains dark. An approved disposable Ling
and Qwen screen produced a no-go/inconclusive outcome; it supplies diagnostic
evidence but does not close the unproven implementation criteria.

### Goal statement

Make complex research progress from named missing evidence to a supported final
answer, using the existing bounded graph and parent-owned ledger, with a clear
stop or escalation when the remaining budget cannot resolve the gaps.

### Implementation work

1. Represent required claim obligations and unresolved questions explicitly.
   Record what is missing, why it matters, and which next action could resolve it.
   Keep these records separate from untrusted text retrieved from the web.
2. Add a bounded research-round record: selected gaps, proposed queries, chosen
   sources, reads performed, evidence cards, budget consumption, conflicts,
   and next permitted action. Validate model proposals as data.
3. Use the existing graph and budget authority. Preserve at most three top-level
   branches, the bounded researcher/scout hierarchy, and the allocated discovery
   envelope of three searches/five reads plus up to five parent validation reads
   unless a later separately evaluated profile explicitly changes those limits.
4. Reserve shared budget before dispatch. Repeated queries, canonical duplicate
   URLs, failed children, and retries cannot create a fresh allowance or satisfy
   a claim without usable evidence. Exhaustion records a specific unresolved gap.
5. Bound retrieval with G02. Use existing Ketch/Jina Reader paths; additional
   search backends are optional later work. Preserve original citation URLs,
   retrieval method, truncation, and parent-validation status.
6. Make parent synthesis a G01-owned action. Late/duplicate reports merge once;
   child summaries and citations remain unverified until the parent rereads the
   material source and records matching evidence cards.
7. Define answer readiness separately from graph terminality. Blocked required
   branches cannot silently settle. Optional deferrals require value, risk, and
   rationale. Settlement must lead to a useful final answer, with uncertainty and
   unresolved obligations visible, rather than another research loop.
8. Evaluate against G03 with research-shaped controls and a fresh preregistration.
   Historical no-go screens remain unchanged and inform the new falsifiers.

Likely starting areas: `skills/deep-research`, `harness/extensions/ketch.ts`,
`plan-runner.ts`, `harness/lib/plan-graph.ts`, `branch-report.ts`,
`research-evidence.ts`, `research-ledger.ts`, `research-reservations.ts`, and
`harness/vendor/pi-subagent`.

### Required acceptance criteria

- **G04-A:** Scripted research fixtures prove global budget conservation through
  child failures, duplicate reports, delayed arrival, restart, and compaction.
- **G04-B:** Child-only evidence, fabricated quotes, truncated reads, conflicting
  sources, or missing required cards cannot manufacture successful settlement.
- **G04-C:** When evidence permits synthesis, exactly one valid parent action is
  scheduled and the final answer is delivered. After stopping, late reports do
  not restart the run.
- **G04-D:** Exhausted or blocked work ends with explicit gaps and a bounded
  explanation. It does not claim full completion or silently increase budgets.
- **G04-E:** Straightforward fact lookup remains lightweight without graph
  activation. Complex research uses the profile when authorized.
- **G04-F:** An approved Qwen 35B screen measures correctness, material citation
  support, completion, and cost against the frozen comparison. A no-go or
  inconclusive result is a valid completed evaluation, not grounds to alter data.

### Completion evidence and permitted deferrals

Deliver the round/stop contract, fake retrieval and parent-synthesis tests,
recovery evidence, and the complex-research screen report. More search engines,
deeper delegation, and richer source-quality scoring may be deferred. Parent
verification, bounded spending, final-answer delivery, and explicit gaps may not.

## G05 — Qualified optimizer decision and learning policies

### Goal statement

Make optimizer acceptance, reflection, and final selection follow unambiguous,
preregistered rules whose numerical behavior is independently tested and whose
evidence cannot be inflated by retries, selection, or missing guard cohorts.

### Implementation work

1. Inventory every policy name, manifest field, decision calculation, report
   label, and reflection classification. Document the present exact-sign naming
   mismatch: a net-fix threshold is not a statistical significance test.
2. Version future policy contracts. Expose an engineering threshold as such;
   provide a separately named statistical rule when required. Do not reinterpret
   previously approved manifests or rewrite historical policy results.
3. Specify binary direction, ties, discordant pairs, minimum observations,
   alpha/thresholds, and the independent sampling unit. Repetitions of one case
   must not automatically count as independent cases.
4. Specify continuous paired differences, direction, exact versus sampled
   permutation behavior, maximum exact workload, seeds, numeric tolerance,
   and stopping rule. Reject unused or contradictory configuration fields.
5. Audit repeated candidate testing and development selection. Quarantine dev/test
   payloads from diagnosis; state how much dev feedback search receives and what
   generalization claim is justified. Positive lessons require complete validation.
6. Use task outcomes for fixed/regressed/still-failing/still-passing classifications
   where those labels are defined. Do not label arbitrary continuous score changes
   as task success without a preregistered success criterion.
7. Require complete matched cells and declared guard cohorts. Missing, duplicate,
   nonfinite, unstable-serving, invalid-provenance, and unexposed observations
   cannot advance candidates. Preserve direction and uncertainty in final ranking.
8. Add independent golden calculations and adversarial synthetic outcomes.
   Prove replay/resume preserve decisions and candidate IDs without duplicate
   provider sessions or task rollouts. Maintain human-only adoption.

Likely starting files: `optimizer/v2/policies.py`, `manifest.py`, `engine.py`,
`events.py`, `provider.py`, `pi_gate.py`, and their tests/reporting interfaces.

### Required acceptance criteria

- **G05-A:** Policy names and every accepted manifest field correspond to actual
  documented behavior. Historical manifests retain their original meaning.
- **G05-B:** Independently calculated binary and continuous examples match results
  for both metric directions, ties, small samples, boundary values, and uncertainty.
- **G05-C:** Malformed policies start zero sessions. Invalid observations and
  incomplete guard cohorts yield rejection or an explicit invalid/inconclusive
  result, never acceptance.
- **G05-D:** Reflection and evolution cannot receive development payloads/traces
  or positive lessons from rejected candidates. Continuous classifications have
  an explicit outcome definition.
- **G05-E:** Interrupted/replayed fake campaigns produce identical decisions and
  candidate graphs without duplicate logical sessions or charged rollouts.
- **G05-F:** A first real campaign is prepared with G03's admitted pack, one
  permitted family, one iteration, explicit approval identity, bounded spend,
  and a review packet. If live validation is approved, execute and audit it;
  otherwise leave this milestone explicitly pending. No automatic deployment.

### Completion evidence and permitted deferrals

Deliver the policy specification, golden calculations, malformed-data and
quarantine tests, replay evidence, and prepared campaign. Before claiming live
qualification, include the audited campaign receipt. Advanced search strategies,
large fleets, and alternative statistical families may be deferred; correct
policy semantics and evidence integrity may not.

## Progress register

Keep this register current as work is actually completed. Link evidence rather
than replacing pending cells with verbal assurances.

| Goal | Implemented | Offline verified | Live validated | Evidence |
|---|---|---|---|---|
| G01 | Implemented in `6a2d4ec` + `a9cab65`; dispatch proof in `36cfeab`, shutdown cancellation proof in `b2b7777` | Focused 37-test control suite and 75-test real-session/planner integration pass; the earlier 779-test gate count is historical, and the current full gate has three pre-existing compact timing failures | Fresh 2026-09-07 disposable Ling receipt: one real goal update, one authority continuation, two provider turns, clean exit; no mirror or adoption claim | `docs/evidence/G01.md`; current review above |
| G02 | Implemented behind `CONTEXT_ADMISSION=on`; producer reservation and recovery-preservation wiring complete | Focused producer, recovery, catalog, typecheck, package smoke, and optimizer verification pass; prior full suite passed 782/782, with five unrelated flaky probes on a later parallel run | Clean 2026-09-07 Qwen→Ling mechanism receipt: two status-200 turns, epochs 0/1, two admitted requests, one bound session/surface; no quality or capacity claim | `docs/evidence/G02.md`; `optimizer/docs/screens/PREREG_QWEN35B_CONTEXT_ADMISSION_SWITCH_2026-09-07.md`; current review above |
| G03 | Registry, offline protocol, fail-closed real-row ingestor, and strict research row adapter implemented (`1da150a`, `20adf3a`, `88faf05`, `8f30f10`, `6a30858`, `3039087`); executed baseline outstanding | Fake pairing/registry/ingestion/research-adapter checks and 72 focused tests recorded; optimizer verification passes | Real Qwen baseline not run; dry gate serves `defiant-9b`, and frozen pack/preregistration source and loaded-surface identities drifted and need a fresh revision | `docs/evidence/G03.md` |
| G04 | Implemented: bounded research contracts, runtime enforcement, merge authority, final-answer proof, and recovery handling are committed | Focused research/planner suites plus real synthesis delivery and compaction/recovery probes pass | Approved early-stop no-go/inconclusive screen remains bound to its older surface; repaired source has no new live receipt | `docs/evidence/G04.md`, `optimizer/docs/screens/G04_DEEP_RESEARCH_EVALUATION_2026-09-07.md`; current review above |
| G05 | Pending | Pending | Pending | Not yet created |

Existing repairs are prerequisites, not proof that these larger goals are done.
Working memory, extra steering, deeper delegation, and broad tool-surface
promotion stay outside this plan until a measured failure justifies them.
