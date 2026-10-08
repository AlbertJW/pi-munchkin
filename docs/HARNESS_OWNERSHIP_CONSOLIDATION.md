# Harness ownership consolidation

This release keeps Pi as the runtime and makes no claim about model-quality improvement.
It preserves the goal repair's numeric ledger schema v2, public tools/commands and
revision checks. Optimizer execution remains mothballed. No real-model study is run.

## Runtime boundaries

`event-bus-owner.ts` resolves the actual emitter behind Pi's per-extension event
facades using a synchronous, opaque ownership probe. It captures no invalidated
Pi API. `extension-lifecycle.ts` replaces subscriptions per emitter and extension/channel.
Its weak registry survives module reload without retaining dead emitters. Disposing one
bus never disposes another. Registration failure does not retain an already-disposed entry.

`runtime-ownership.ts` declares event-bus, session, branch and generation lifetimes.
Bootstrap rotates the generation, replaces session fields only when session identity
changes, and invalidates branch fields on tree navigation. The initial tool roster and
activation memory survive reload per emitter. Goal continuation offers survive reload
for their session. Process secrets and remaining legacy projections are not moved into
this registry in this release.

`plan-runner.ts` is the public Pi adapter. Each registration creates its own mutable
planning-runtime closure. The plan service owns structural validation and presentation;
the research dispatch service owns lease/budget eligibility through injected transaction
ports; the goal service owns command/tool adapters around the existing durable authority.
Goal, plan and research ledgers remain separate. Existing private-artifact writes and
research cross-file transactions are preserved; no projection becomes authority.

Remaining legacy global projections (including capsule identity, active-goal summaries,
plan mode and telemetry fallbacks) are compatibility bridges. This release establishes
subscription and selected-field isolation, not complete simultaneous-session isolation
for every feature. Removing further bridges requires their own compatibility tests.

## Pi contracts

The pinned 0.80.6 contract retains settled/idle delivery through the existing arbiter.
On 1.0.4 normal continuations use `agent_before_settle` with a custom-message draft
and `continue: true`; aborted/error boundaries discard pending offers. The event's
pre-draft `canContinue` must not be used to reject a valid new draft: Pi computes
continuability again after incorporating it. Late idle offers retain the guarded
follow-up path. Authorization is reread immediately before dispatch; a newly active
run also rejects an old in-flight authorization.

Peer support adds exactly **1.0.4**, not all 1.x versions. Existing 0.80.6–0.84.x
peer support is retained. The compatibility adapter does not replace cross-process
locks with Pi's in-process mutation queue.

## Provenance and context

`/runtime-receipt` records actual registered/active tools, bounded behavioral modes,
source-file hashes, nearest package identities, Pi version and requested/observed
provider identities. Its source discovery is labelled **discovered**, not loaded.
The host qualifier obtains **loaded** paths directly from ExtensionRunner. Source
hash coverage is explicitly the relative-import closure, not arbitrary transitive
npm dependencies. Missing sources fail instead of producing a partial receipt.
No credentials, command strings, endpoints, prompts or source contents enter receipts.
Receipts persist as non-model-facing custom entries.

Capability activation and status share registration-derived family metadata.
Explicit user tool exclusions remain authoritative. Context measurement records order,
boundary, before/after hashes and byte counts, plus the declared recovery mechanism.
`CONTEXT_PIPELINE_RECEIPTS=on` enables Munchkin's per-request dedup observer; it is
**off by default** to avoid adding full-context serialization overhead to ordinary runs.
Third-party stages are observed end-to-end in qualification rather than rewritten.

Intervention entries distinguish proposed, selected and dispatch-accepted. Acceptance
into Pi's API is explicitly **not proof that a provider/model consumed the intervention**.
Task/run/branch correlation identifiers are hashed. Task/run lineage propagates to
children; parent branch identity does not.

## Offline acceptance suite

`harness/acceptance/tasks-v1.json` contains 40 frozen authored fixtures: ten repairs,
ten evidence-reconciliation tasks, ten resumed-work authority cases, and ten browser
interaction cases. Five per category are regression cases and five capability cases.
They exercise named harness failure mechanisms; this synthetic starter corpus is not
a representative sample of the user's workload and cannot establish general benefit.
Oracle answers remain in the evaluator's bank and are excluded from prepared projects.

The offline grader accepts golden mechanisms and rejects broken seeds. Browser and
resumed-work outcomes also require independent, artifact-bound end-to-end checks.
They remain awaiting verification when only a local function check passes. The VM
fixture grader is not a security sandbox for arbitrary generated code; real study
execution must use an isolated executor and independent browser/resume verification.

Prepare a manifest with exact baseline/candidate commits, loaded receipt hashes,
provider/model/serving identity, all three positive integer budgets (provider requests,
output tokens and deadline), ordering seed and independent judge identity. Bind a named comparison and frozen
baseline/candidate configuration maps differing on exactly one axis; the initial
comparison catalog is `harness/acceptance/interventions-v1.json`:

```
npm run acceptance:prepare -- manifest.json /absolute/new-study-directory
npm run acceptance:summarize -- outcomes.json
```

Preparation writes fixture projects and a deterministic 240-task-run schedule
(40 tasks × three trials × two arms). It neither authorizes inference nor invokes
an optimizer. Model-run execution is deliberately absent. Separate authorization,
verified receipt bindings, artifact isolation, browser/resume graders and a held-out
corpus are prerequisites to any real study. Summary reports completion, repeated
success, normalized artifact quality, input/output tokens, aggregate cost/latency/harm, paired task differences and a deterministic
10,000-resample task-level bootstrap interval. It never automatically promotes a
feature or infers significance from a screen.

## Qualification and deployment

`npm run verify` retains all six stages. `npm run compat:peers` checks exact peer
boundaries. The ownership qualifier takes the host package and live agent directory:

```
npm run qualify:ownership -- /absolute/pi-package /absolute/live-agent /absolute/receipt.json
```

It copies the live first-party package into temporary storage, overlays only the
committed deployment allowlist, loads the actual installed external packages, and
uses a scripted provider. It checks bounded active continuation and terminal states,
two real AgentSessions across three reloads, actual context order, exact UTF-8 recall,
corrupt archive rejection, recall exclusion, dedup followed by packing, actual tree
navigation, persisted transcript reopening and native compaction with one scripted
summary owner. Network attempts fail the check.
Use `--live-copy` after deployment to qualify copied installed bytes without overlay.

The deployment script permits exactly 31 reviewed code destinations. It preserves the
live package manifest, settings, other extensions and all goal data. Its committed
baseline records expected hashes and permissions, including absence of new modules.
It requires clean published source and a valid process inventory proving no Pi writer
is running. Backups contain the affected original bytes/modes and surrounding hashes.
All replacements are staged before rename; process inspection repeats at publication.
Post-deployment host qualification runs before verification is recorded. Failure
restores affected files and verifies their original hashes while writers stay stopped.

```
npm run deploy:ownership -- prepare /absolute/agent /absolute/new-backup harness/deployment/ownership-baseline.json
npm run deploy:ownership -- apply /absolute/new-backup/receipt.json
npm run deploy:ownership -- rollback /absolute/new-backup/receipt.json
```

Keep every Pi writer stopped throughout deployment and recovery. Process inspection
cannot prevent a user from starting another writer. If one starts during publication,
stop it before completing rollback. Never delete a goal lock while writers run. The
existing goal-repair lock-removal procedure remains applicable. Report broader mirror
differences separately; this overlay is not a whole-checkout synchronization.

The process-isolated planning trace comparison checks the public tool schemas,
commands, planning/execution tool surfaces, command messages, mutation guard and
rejected oversized-write preservation against the published goal repair baseline.
Only generated IDs, timestamps and temporary paths are normalized. It is a bounded
flat-plan parity check, not an exhaustive equivalence proof for research workflows.

```
npm run qualify:planning-parity -- /absolute/goal-repair-baseline /absolute/parity.json
```

Request sequence numbers now belong to the session and survive reload. Request
receipts link accepted proposal IDs and hashed task/run/branch identifiers. This
is correlation evidence; it does not assert model consumption of a correction.
