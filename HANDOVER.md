# Handover — pi_munchkin, 2026-08-24

## 2026-09-04 preserve malformed planner state on creation (repository-only)

The planner audit found that `readState()` uses `undefined` for both a missing
file and malformed persisted state. A new `plan_write` or
`research_plan_start` could therefore treat corruption as an empty slot and
overwrite it. Creation now checks for an existing unreadable state first and
fails closed, preserving the bytes for inspection or explicit cancellation.
The counterfactual regression is green; planner integration is 46/46 and the
full suite is 696/696. No model execution, mirror, rollout, or push occurred.

Source surface is `0f770e94dca9bc81e1cd5e0aefc0747b3a717ea404bfb3ff8e759055c992dcf9`;
loaded mirror remains `73bbd494f5c23f3b7262bd9f17c44b57574ca23d4b211c07dbd1d6067c23c315`.
Planner flags remain dark; future smoke requires a fresh approved preflight plus
loaded-hash rebind.

## 2026-09-04 honor explicit planner resume boundaries (repository-only)

The planner audit found a second explicit-surface leak in `/plan-go`: after a
user omitted `plan_update`, the command could still add it while restoring the
execution surface, including after a restart. `/plan-go` now refuses to enter
execution unless the status tool was explicitly selected, and both restore
paths skip planner additions for explicit allowlists. The counterfactual test is
green; the planner suite is 45/45 and the full suite is 695/695. No model
execution, mirror, rollout, or push occurred.

Source surface is `92c22a49aa0ff412c235b34851cc50ee7adb37f33ba9ca53d205b5b9401f6e2b`;
loaded mirror remains `73bbd494f5c23f3b7262bd9f17c44b57574ca23d4b211c07dbd1d6067c23c315`.
Planner flags remain dark; the preflight source pin is updated for the next
approved smoke.

## 2026-09-04 conserve planner expansion remainder (repository-only)

The reusable `plan_expand` path could reserve a research branch’s original
allocation again after that branch had already consumed part of it. Expansion
now checks the parent’s unspent search/read remainder before writing children;
the targeted regression was red before the guard and green afterward. No model
execution, mirror, rollout, or push occurred.

Source surface was `b3b53dd48e6522f80801a42c9dcef20853d65733795d7b3b3eb3ba3d4899c271`;
loaded mirror remains `73bbd494f5c23f3b7262bd9f17c44b57574ca23d4b211c07dbd1d6067c23c315`.
Planner flags remain dark; the preflight source pin is updated for the next
approved smoke.

## 2026-09-04 preserve explicit planner tool boundaries (repository-only)

The planner audit found that `research_plan_start` could add graph lifecycle
tools after a caller had supplied an explicit tool allowlist. Graph activation
is still additive for ordinary sessions, but an explicit allowlist must already
contain `plan_update`, `plan_expand`, and `plan_settle`; otherwise graph start
fails before writing state. The counterfactual integration test is green after
the guard. Full offline tests are 694/694 and planner integration is 45/45; no
model execution, mirror, rollout, or push occurred.

Source surface is `9bd8e7e84826db9ebd79f3ce72c1133dd15223ac055c4af76ee6a483696da1d3`;
loaded mirror remains `73bbd494f5c23f3b7262bd9f17c44b57574ca23d4b211c07dbd1d6067c23c315`.
Planner flags remain dark; the preflight source pin is updated for the next
approved smoke.

## 2026-09-04 require an open branch report for scouts (repository-only)

The planner audit found that a non-terminal read of a terminal branch report
could expose pending leaves to the scout dispatcher. Dispatch now requires an
open parent report (`pending` or `in_progress`), in addition to the declared
leaf and exact allocation checks. The targeted regression is green after the
guard; no model execution, mirror, rollout, or push occurred.

Source surface is `3128d2a69ba7364a31a3085445aa82e402ade3b200f6598abf9e06dbc6193a1f`;
loaded mirror remains `73bbd494f5c23f3b7262bd9f17c44b57574ca23d4b211c07dbd1d6067c23c315`.
Planner flags remain dark; the preflight source pin is updated for the next
approved smoke.

## 2026-09-04 fail closed on malformed v5 planner state (repository-only)

The planner audit found that v5 recovery normalized an invalid item status into
`pending`, allowing corrupted state to become executable. v5 graphs now pass
through strict graph validation before any bounded migration cleanup; malformed
state remains untouched and fails closed. The counterfactual regression was red
before the fix and green afterward; planner integration is 44/44, the full
suite is 694/694, and no model execution, mirror, rollout, or push occurred.

Source surface is `faa0534944512e79e1d3394e06feced673316735359f3e5ebd4511aff654c146`;
loaded mirror remains `73bbd494f5c23f3b7262bd9f17c44b57574ca23d4b211c07dbd1d6067c23c315`.
Planner flags remain dark; the preflight source pin is updated for the next
approved smoke.

## 2026-09-04 bind scout dispatch to declared leaves (repository-only)

The planner audit found that a depth-one branch could mint a valid-looking
depth-two context for a leaf absent from its current `branch_plan` report, or
change the declared allocation before dispatch. Scout validation now reads the
parent's non-terminal report and requires a pending/in-progress declared leaf
with an unchanged budget before launching any child. The counterfactual
regression was red before the fix and green afterward; planner integration is
43/43, the full suite is 693/693, and the subagent hardening suite is 28/28.

Source surface is `177ea8b7532b17528c560fc4e7962bf56039e0bec5efc26bf10a7203b2cbf173`;
loaded mirror remains `73bbd494f5c23f3b7262bd9f17c44b57574ca23d4b211c07dbd1d6067c23c315`.
Planner flags remain dark. No model execution, mirror, rollout, or push occurred;
the preflight source pin is updated for the next approved smoke.

## 2026-09-04 require productive split evidence (repository-only)

The planner audit found that a split branch could mark itself `done` after all
children were blocked or deferred despite producing no usable evidence. A split
completion now needs parent yield plus a source lead or at least one productive
done child; graph reload and settlement enforce the same rule. Productive child
splits and flat plans remain valid. The counterfactual regression was red before
the fix and green afterward; planner integration is 43/43 and the full suite is
693/693.

Source surface is `9e290b2cf3db24108f57c842249060bbae91307ef484b692ae9704f87e25af65`;
loaded mirror remains `73bbd494f5c23f3b7262bd9f17c44b57574ca23d4b211c07dbd1d6067c23c315`.
Planner flags remain dark. No model execution, mirror, rollout, or push occurred;
the preflight source pin is updated for the next approved smoke.

## 2026-09-04 require terminal child resolution (repository-only)

The bottom-up planner audit found that a branch could return terminal `done`
while leaving a delegated child open. Terminal `branch_plan` writes now use the
terminal report validator and fail with an actionable child-resolution error.
Persisted v5 graph validation also shares the evidence-yield rule, while split
parents may still have zero local yield when a productive child supplies the
evidence. The counterfactual regression was red before the fix and green
afterward; the isolated planner suite is 42/42 and the full suite is 693/693.

Source surface is `ee4fd6c127a50f31310f9d4a7d368a502b1425263465816d67af233c578259b1`;
loaded mirror remains `73bbd494f5c23f3b7262bd9f17c44b57574ca23d4b211c07dbd1d6067c23c315`.
Planner flags remain dark. No model execution, mirror, rollout, or push occurred;
the preflight source pin is updated for the next approved smoke.

## 2026-09-03 reject zero-evidence planner completion (repository-only)

The bottom-up planner audit found that a transport-complete retrieval with zero
usable results could still be marked `done`. Direct terminal branches now need a
positive retrieval yield and at least one source lead; terminal scout leaves need
positive yield as well. Split parents may have zero local yield when their child
coverage supplies the evidence. “Not found” work must be blocked or deferred with
an explicit gap. Both the child tool and parent report validator enforce the same
rule, and the isolated planner suite is 41/41.

Source surface is `2c2e077350e4f5e5b96c3d2659a420abf9a87be1e756d1f150427d6e4f841602`;
loaded mirror remains `73bbd494f5c23f3b7262bd9f17c44b57574ca23d4b211c07dbd1d6067c23c315`.
Planner flags remain dark. No model execution, mirror, rollout, or push occurred;
the preflight source pin is updated for the next approved smoke.

## 2026-09-03 terminal planner reports stop child follow-up (repository-only)

The planner audit found that `branch_plan` persisted terminal reports but did
not tell Pi to stop the child agent loop, so a child could spend its bounded run
on an unnecessary follow-up turn after it had already published its result.
Terminal valid and fail-closed blocked reports now return `terminate: true`;
pending reports remain resumable. The counterfactual regression was red before
the fix and green afterward. The isolated planner suite is 39/39.

Source surface is `9710fa437ae97b36aa6c6a2ad53af5d953dd7f597e89bd3519bd11d2dd032503`;
loaded mirror remains `73bbd494f5c23f3b7262bd9f17c44b57574ca23d4b211c07dbd1d6067c23c315`.
Planner flags remain dark. No model execution, mirror, rollout, or push occurred;
the preflight source pin is updated for the next approved smoke.

## 2026-09-03 require actual retrieval receipts for planner completion (repository-only)

The bottom-up planner audit found one remaining receipt fail-open: a direct
branch, or a terminal scout with no coverage metadata, could claim complete
coverage without any observed web retrieval. Direct branches now require at
least one actual safe retrieval receipt; terminal scouts require the same from
their returned receipt. Split parents may have zero local calls when their
children supply the terminal coverage. Counterfactual regressions were red
before the guard and green afterward.

The isolated planner integration suite is green at 38/38; the source surface is
`015c4fe3e94436d432ef5d002d7edae239f2dc282fa482ff359fca576aeaedc3`; loaded
mirror remains `73bbd494f5c23f3b7262bd9f17c44b57574ca23d4b211c07dbd1d6067c23c315`.
Planner flags remain dark. No model execution, mirror, rollout, or push occurred;
a future smoke needs a fresh approved preflight and loaded-hash rebind.

## 2026-09-03 rebind planner preflight after receipt hardening (repository-only)

The receipt-boundary source change invalidated the planner preflight's pinned
source digest. The expected digest is now current, so `verify:optimizer` passes
its no-inference identity gate again. The full aggregate verification is clean;
no model execution, mirror, rollout, or push occurred.

Source pin remains `4adffc342d095ebd584835d57102cc156d68bf3fea812cac56542bcdffc7339f`;
loaded mirror remains `73bbd494f5c23f3b7262bd9f17c44b57574ca23d4b211c07dbd1d6067c23c315`.
Planner flags remain dark and a future smoke needs a fresh approved preflight plus
loaded-hash rebind.

## 2026-09-03 bind planner completion to retrieval receipts (repository-only)

The planner audit found that a model-declared complete branch report was not
bound to the result metadata from the web tools that actually ran. A failed or
truncated search/read could therefore be described as complete. Parent Ketch
calls now publish a process-local safe aggregate, and delegated scouts return
their aggregate through the runner; branch reports reject complete claims when
the observed retrieval was incomplete. No query, URL, or page text enters this
receipt. Two counterfactual regressions were red before the guards and green
afterward.

The full offline suite is green at 692/692, with typecheck, optimizer
verification, pack/health checks, and secret scan clean. Source pin is
`4adffc342d095ebd584835d57102cc156d68bf3fea812cac56542bcdffc7339f`; loaded
mirror remains `73bbd494f5c23f3b7262bd9f17c44b57574ca23d4b211c07dbd1d6067c23c315`.
Planner flags remain dark; no inference, mirror, rollout, or push occurred. A
future smoke needs a fresh approved preflight and loaded-hash rebind.

## 2026-09-03 reject unknown planner schema downgrades (repository-only)

The next planner reload probe found that any schema number other than `v5`
was treated as legacy `v4`. A forged future research graph could therefore
lose its research markers during migration and settle as ordinary work. Only
the two versions with defined migration semantics are now accepted; unknown
versions fail closed and the private state file remains byte-identical. The
counterfactual regression was red before the guard and green afterward.

The full offline suite is green at 691/691, including typecheck, health,
package smoke, optimizer verification, and secret scan. Source pin is
`fb68dc56…`; loaded mirror remains `73bbd494…`. Planner flags remain dark; no
inference, mirror, rollout, or push occurred. A future smoke needs a fresh
approved preflight and loaded-hash rebind.

## 2026-09-03 fail closed on planner dispatch and profile gaps (repository-only)

The bottom-up planner audit found two adjacent integrity gaps. A root dispatch
whose persisted research epoch had disappeared was previously treated as epoch
zero, so it could launch a child whose result could never merge; preparation now
fails closed and releases every acquired lease. A v5 graph carrying only
research evidence gaps could also reload without its profile and bypass
research settlement gates; those markers now require a valid deep-research
profile. Both regressions were red before the fixes and green afterward.

The source surface is `f2400010…`; the loaded mirror remains `73bbd494…`.
Planner flags remain dark; no inference, mirror, rollout, or push occurred.

## 2026-09-03 preserve research profile settlement gates (repository-only)

The follow-up planner audit found that a v5 research graph with a malformed
profile could reload without that profile and become an ordinary graph. That
removed the deep-research source-verification requirements and allowed
`plan_settle` to succeed without parent rereads. Reload now fails closed for
invalid profiles and for research-only node markers without a valid profile;
the persisted file is left untouched. The settlement-bypass regression was red
before the fix and green afterward.

The source surface is `9dadc7d1…`; the loaded mirror remains `73bbd494…`.
Planner flags remain dark; no inference, mirror, rollout, or push occurred.

## 2026-09-03 reject oversized persisted planner graphs (repository-only)

The bottom-up planner audit found that `migrateState` truncated persisted
graphs to the first 24 nodes before running graph validation. A corrupt or
stale v5 graph could therefore lose unresolved tail work on reload and then
accept a mutation against the shortened state. Reload now rejects any state
whose item array exceeds the structural limit, leaving the private file
untouched. The new regression was red before the guard and green afterward.

The source surface is `0d045321…`; the loaded mirror remains `73bbd494…`.
Planner flags remain dark; no inference, mirror, rollout, or push occurred.

## 2026-09-03 research-branch reopen evidence reset (repository-only)

The bottom-up audit found that an explicitly reopened terminal research branch
kept its prior completion receipt and delegated source leads. A parent could
therefore flip the branch back to `done` without a fresh validated child report.
Reopening now preserves cumulative budget consumption but clears coverage,
source leads, evidence gaps, and deferral; a new validated report is required
before settlement. The regression was red before the fix and green afterward.
Planner flags remain dark; no inference, mirror, rollout, or push occurred.

Source pin is `fcc74b8c…`; loaded mirror remains `73bbd494…`. A future smoke
needs a fresh approved preflight and loaded-hash rebind.

## 2026-09-03 parent-only planner branch merge (repository-only)

The ownership audit found that a delegated process could still process a local
`plan/branch-result` signal through the merge subscriber, even though direct
planner tools and commands were fenced. The subscriber now fails closed for
delegated processes and shared reload markers. A regression forges that signal,
exercises every mutating planner command, and proves the parent lease and graph
remain unchanged. Planner flags remain dark; no inference, mirror, rollout, or
push occurred.

Source pin is `f64124f7…`; loaded mirror remains `73bbd494…`. A future smoke
needs a fresh approved preflight and loaded-hash rebind.

## 2026-09-03 parent-owned planner mutation fence (repository-only)

The ownership audit continued past recovery and found that an unusually broad
child tool allowlist could still call model-facing planner mutations directly.
Every subagent now fails closed for `plan_write`, `plan_update`, `plan_expand`,
`plan_settle`, and `research_plan_start`, and mutating planner commands are
fenced too. `branch_plan` remains the one bounded child publication protocol.
The ordinary-child regression proves the calls and `/plan-cancel` cannot alter a
parent lease. Full offline verification remains green; planner flags are dark
and no inference, mirror, rollout, or push occurred.

Source pin is `63b1a952…`; loaded mirror remains `73bbd494…`. A future smoke
needs a fresh approved preflight and loaded-hash rebind.

## 2026-09-03 parent-only planner recovery (repository-only)

The broader child-process probe found that the earlier delegated-context fence
still left ordinary subagents eligible for parent stale-lease recovery. Any
subagent can share the project directory while the parent is dispatching a
research branch, so recovery is now explicitly parent-only for every non-zero
`PI_SUBAGENT_DEPTH`. A no-context child regression covers startup plus a late
capsule signal and proves the parent lease remains pending. Full offline tests
and verification remain green; planner flags are dark and no inference, mirror,
rollout, or push occurred.

Source pin is `b94c2e48…`; loaded mirror remains `73bbd494…`. A future smoke
needs a fresh approved preflight and loaded-hash rebind.

## 2026-09-03 delegated planner capsule-signal fence (repository-only)

The final child-lifecycle probe found one reload/embedding race beyond startup:
an older `plan-runner` signal subscriber could process the later capsule
identity event and reclaim the parent branch lease even after the delegated
child had correctly skipped startup rebinding. A shared delegated-process marker
now fences every subscriber in that process. The regression emits the capsule
signal after child startup and proves the parent branch remains pending with
its original lease. Full offline tests, typecheck, and the targeted source
identity checks are green; planner flags remain dark and no inference, mirror,
rollout, or push occurred.

Source pin is `94060815…`; loaded mirror remains `73bbd494…`. A future smoke
needs a fresh approved preflight and loaded-hash rebind.

## 2026-09-03 planner bottom-up audit: ownership and budget fences (repository-only)

The deep-research graph audit found four integrity gaps and closed them with
targeted red-green regressions. A branch result now requires the parent-issued
lease and dispatch epoch, so an unlaunched or late child cannot mutate an open
branch. Reopened branches receive only the authoritative unspent remainder;
invalid or missing reports conservatively consume uncertain discovery budget,
and repeated malformed coverage reports fail closed. Depth-two scout
allocations are checked against the branch remainder, and a report cannot drop
a scout after it has been dispatched (which would otherwise hide its usage and
permit envelope reuse). Finally, delegated planner/scout processes no longer
run parent stale-lease recovery when they share a project-storage directory,
and depth-one planner children retain the `branch_plan` protocol tool after
startup narrowing. Private branch-report directories are tightened to `0700`
before publication.

The offline planner suites and typecheck are green (58 targeted tests); the
planner remains dark and repository-only. Source pin is now `4d37bc8a…` while
the loaded mirror remains `73bbd494…`; no inference, mirror, rollout, or push
occurred. The next safe step is a fresh approved preflight and, only after a
human gate, a bounded complex-research screen.

## 2026-09-03 complete planner graph export (repository-only)

The graph presentation audit found that `/plan-export` wrote a root-only
ambient rendering to `.pi/TODO.md`; only the JSON sidecar contained child
nodes. Export now renders the complete graph with relative indentation, while
ordinary status remains compact and `/plan-status <node-id>` remains
progressively disclosed. The regression proves a merged child appears in the
text export. Full offline verification is green; planner flags stay dark, the
source branch is not mirrored, and no model run occurred.

## 2026-09-03 planner preflight rebind after retry hardening (repository-only)

The retry-budget change moved the source surface hash, so the planner
preflight's stale default correctly failed closed during full verification. Its
pin now matches `d333be72…`; the preflight selftest and no-inference dry path
pass against the existing loaded `73bbd494…` mirror with four admitted
fixtures. This is an identity repair only: planner flags remain dark, no
inference or mirror mutation occurred, and no model-quality claim follows.

## 2026-09-03 planner retry-budget conservation (repository-only)

The bottom-up deep-research audit found that an explicitly reopened terminal
branch could replay its original full-allocation `plan_context`; the graph then
overwrote `budget.used` with the latest attempt. That violated the single
3-search/5-read discovery envelope. Root dispatch now rebinds depth-one
contexts to the authoritative unspent remainder, rejects stale contexts, and
refuses dispatch when the remainder is exhausted. Branch merges add usage
cumulatively, so a retry cannot multiply budget or erase prior consumption.
The new integration regression covers stale-context rejection, remaining-budget
rebinding, and cumulative merge usage. This is repository-only: planner flags
remain dark, the source branch is not mirrored, and no model run occurred.

## 2026-09-03 planner preflight source rebinding (repository-only)

The dispatch changes moved the package source surface, so the frozen planner
preflight default was stale and `verify:optimizer` correctly failed closed.
The default source pin now matches `00d00ec0…`; the dry preflight passes against
the currently loaded `73bbd494…` mirror with four admitted fixtures and
`inference_started:false`. This is an identity/readiness repair, not planner
evidence: approval is still required, the source remains ahead of the mirror,
and no model run occurred.

## 2026-09-03 transactional planner root dispatch preparation (repository-only)

The lease audit reproduced two exception paths that were safe only by eventual
stale recovery: a later root lease acquisition could throw after earlier leases
were acquired, and a persisted retry-epoch read could throw after the lease
transaction but before the in-process dispatch guard was updated. Root dispatch
preparation is now transactional. It stages parent/owner/epoch changes, releases
every acquired lease on any exception, and returns the bounded
`lease_unavailable` failure without consuming the runtime guard. Two
fault-injection regressions were red before the fix and green afterward. This
is repository-only: planner flags stay dark, the branch is not mirrored, and
no model run occurred.

## 2026-09-03 planner recovery storage in the gate jail (repository-only)

The authoritative gate audit found a concrete integration gap before another
planner screen: recovery-mode plan state is written inside the private run
capsule at `~/.pi/agent/artifacts/run-capsules`, but both Seatbelt profiles
denied that subtree. The profiles now grant only that capsule subtree, and
`real_gate.sh` pre-creates its fixed parent before entering the jail; the
existing workdir, harness, mirror, and unrelated `~/.pi` write denials remain.
The profile regression was red before the fix and green afterward. The
managed environment cannot execute `sandbox-exec`, so the selftest statically
checks both templates and retains the actual mkdir/touch probe for a macOS
host with the primitive available. This is repository-only: planner flags stay
dark, the source branch is not mirrored, and no model run occurred.

## 2026-09-03 planner child-runner setup and redispatch closure (repository-only)

The lease audit found two same-process lifecycle gaps: a planned child
could throw before `runner.ts` returned a structured result while creating its
private prompt, fork snapshot, or branch-context artifact. The subagent wrapper
now turns that exception into the bounded child-failure result used by ordinary
process, timeout, and report failures. Parent branch-result handling therefore
blocks the branch and releases its durable lease for both single and parallel
delegation. An explicit reopen increments a durable branch dispatch epoch, so
the old in-process identity is cleared only after the user/model has reopened
the terminal branch; an active lease still blocks duplicates. The diagnostic
remains generic so private setup paths do not reach the model. Filesystem setup
and reopen regressions were red before the fixes and green afterward; planner
flags stay dark, and there was no model run or mirror mutation.

## 2026-09-03 durable deep-research dispatch leases (repository-only)

The planner audit found that reload-safe dispatch ledgers still disappeared on
a full parent-process restart. Root research branches now carry a durable,
parent-owned dispatch lease in the v5 graph. Acquisition happens before the
child process starts and is serialized with graph writes and a cross-process
plan-state lock; a second process sees
the lease and is rejected before launch. Validated branch results and explicit
terminal updates clear it. Recovery converts a stale lease into a bounded
`blocked` branch with an interruption evidence gap, so retry requires an
explicit plan update and late child reports cannot reopen the graph. Red-green
coverage includes restart persistence, result/terminal release, and stale-lease
recovery. Plan-state replacement is covered by the same lock, and state writes
fsync the file before rename plus the containing directory. Source hash is
recorded in the boundary row below; planner flags stay dark, with no inference
or mirror mutation.

## 2026-09-03 root research dispatch reload durability (repository-only)

The continuing planner audit found the same lifecycle failure one level higher:
the head planner's set of dispatched depth-one branches lived in the extension
closure, so an in-process reload could dispatch the same root branch again. Root
dispatch identity now lives in a run-keyed private `globalThis` ledger that
survives reload and resets only when the active research run changes. Root
contexts must also carry the deterministic owner reference derived from their
run and node, and must be present in the active graph's bounded root-context
set. A red reload regression, forged-owner check, and inactive-branch check now
pass, with rejection occurring before the child runner is launched. This remains
repository-only: planner flags stay dark, no model run or mirror mutation
occurred, and the source hash is recorded in the boundary row below.

## 2026-09-03 scout-dispatch reload durability (repository-only)

The planner audit found that the two-scout ceiling lived only in the
depth-one extension closure. An in-process Pi extension reload could therefore
reset the count and dispatch a third scout. Branch-local dispatch count,
parent IDs, and owner references now live in a bounded `globalThis` ledger keyed
by the full branch context; a changed branch identity resets it safely. A
reload regression was red before the fix and green afterward. This is
repository-only: flags remain dark, no model run or mirror mutation occurred,
and the fresh source hash is `012810e8…`.

## 2026-09-03 depth-two context binding (repository-only)

The follow-up planner audit found that a depth-two scout context was checked
for shape and depth but not bound to the depth-one branch that dispatched it.
Scout dispatch now requires the full parent branch context, the same run ID, a
different child node, and the deterministic owner reference minted from that
run and node. A foreign-run regression was red before the fix and green
afterward. This is repository-only: planner flags remain dark, no model run or
mirror mutation occurred, and the fresh source hash is `351dde3d…`.

## 2026-09-03 parent-only planner lease fence (repository-only)

The bottom-up lease audit found that `PI_SUBAGENT_ENV_ALLOW` could reintroduce
variables explicitly classified as parent-only, including the headless planner
lease, private branch artifact paths, and parent run identity. The allowlist is
now additive only: excluded keys remain filtered even when named explicitly.
A regression was red before the fix and green afterward. This closes the
child-boundary escape hatch without changing planner defaults; flags remain
dark, no model run occurred, and the live mirror was not changed.

## 2026-09-03 deep-research parent capability activation (repository-only)

The bottom-up planner audit found that the core-profile skill route could start
`research_plan_start` after enabling the planning family, but still had no
`web_search`, `web_read`, or `subagent` tools to execute the new graph. A
successful start now emits the existing `capability/need` signals for research
and delegation, so the parent receives those families while preserving explicit
tool selections and the one-attempt activation latch. The headless lease remains
parent-only. A red test reproduced the missing tools before the change; the
integration suite is green afterward. This is repository-only: planner flags and
defaults remain dark, no model run occurred, and the live mirror was not changed.

## 2026-09-03 planner branch merge and scout identity hardening (repository-only)

The planner audit found two fail-open paths. A delegated report whose child ID
collided with an unrelated graph node was silently ignored, and a report that
passed transport validation but violated graph invariants (for example, a
zero-allocation child) was swallowed by the merge promise; both left the
owning branch pending indefinitely. The merge now blocks that branch with a
bounded `merge_collision` or `merge_rejected` reason, admits no incoming child
claims, and emits the existing `branch-failed` lifecycle receipt. A depth-one
planner also tracks dispatched leaf IDs and owner references across sequential
calls, closing the gap where the same scout could be dispatched twice while
the count stayed below two.

The regressions were red before the fix and green afterward. The targeted
planner/branch suite passes 8/8 and typecheck is green. This is repository-only
planner hardening: `PLAN_GRAPH` and `DEEP_RESEARCH_PLANNING` remain dark, no
model/inference run occurred, and the live mirror was not changed.

## 2026-09-03 Pi consumer compatibility replay (partial)

The current source tarball passes the packaging-only consumer protocol for Pi
`0.80`: strict peer installation, tarball typecheck, all 30 extension entry
points, and both bundled skills load cleanly. The `0.81` replay stalled while
resolving its peer set in the managed environment; after several minutes it
was stopped, and the required network escalation endpoint returned an
infrastructure `404` on retry. Pi `0.82` and `0.83` were not run. Treat those
three ranges as pending for this source surface rather than borrowing the
older archived compatibility receipts. No Pi process, model, inference, or
live mirror was involved.

## 2026-09-03 optimizer V2 recovery hardening (repository-only)

`ae0c44e` fixes three bottom-up audit findings with red-green regressions:
patch-surface composition now materializes an accepted candidate DAG once with
shared-ancestor de-duplication; an unterminated final event is reported as a
recoverable EOF tail rather than poisoning the next append, with complete
records delimiter-repaired instead of discarded; and branch reports sync the
file and containing directory around atomic publication. The source surface is
now `8150c80d…`; the live mirror remains at `73bbd494…` because this
optimizer/recovery package was not rolled out. `npm run verify:optimizer`, the
full harness test suite (682/682), typecheck, package smoke, and peer checks are
green. `c5bd34b` additionally makes tail recovery own the campaign lock for the
entire repair/truncate and recovery-event transaction. No inference, campaign,
mirror, default, or adoption action occurred.

## 2026-09-03 Pi 0.84 consumer compatibility receipt

`npm run compat:consumer -- 0.84` completed successfully after the earlier
dependency-install stall: strict peer installation, tarball typecheck, loading
of all 30 extension entry points, and discovery of both skills passed. This is
packaging/compatibility evidence only; it does not change the model-visible
surface or authorize a live rollout.

## 2026-09-03 planner v8 repair smoke audit (current)

The v8 completion-shaped repair smoke was executed once against the pinned
Qwen 35B subject and the mirrored surface `73bbd494…`. The candidate hit the
350,000-byte output cap (exit 143, approximately 173 seconds, stderr 0) after
one graph start. Safe telemetry recorded two `missing_report` branch failures
and open/blocked graph state; no validated branch merge or parent settlement
occurred. The negative-control arm was not run because the candidate lifecycle
was already incomplete. The full audit is
[`optimizer/docs/screens/QWEN35B_PLANNER_COMPLETION_V8_AUDIT_2026-09-03.md`](optimizer/docs/screens/QWEN35B_PLANNER_COMPLETION_V8_AUDIT_2026-09-03.md).

This is incomplete mechanism evidence only. Planner flags remain dark, raw
streams remain private, and no quality, adoption, or default decision follows.

## 2026-09-03 planner v7 stopped and direct-completion repair (historical; superseded by V8 audit)

The prepared v7 screen was revalidated against source surface
`d1b17fd8…`, loaded surface `d83baa71…`, the pinned Qwen 35B subject, and the
four admitted fixtures. Two candidate sessions then ran in the fixed order.
Session one reached the 350,000-byte output cap after a graph start with two
pending branches. Session two reached the 180-second wall while its three
`research-planner` children were still in their branch-expansion sequence; two
were classified `child_failed`, leaving blocked branches and no merge or parent
settlement. The v7 hard guard forbids any candidate branch failure, so the
remaining ten sessions were correctly not run. These are incomplete lifecycle
observations only and remain quarantined outside the repository.

The root cause was a model-visible contract mismatch: the profile permits a
depth-one branch to split once, but `harness/agents/research-planner.md`
required every branch to create scouts. `97629b5` makes expansion conditional:
single bounded gaps can be researched directly and closed with one terminal
`branch_plan` report; only genuinely independent gaps create scouts. The new
contract test was red before the edit and green afterward. A fresh v8 repair
smoke was then prepared in
`optimizer/docs/screens/PREREG_QWEN35B_PLANNER_COMPLETION_V8_2026-09-03.md`, bound to
source `324aa214…`. Its subsequent candidate-only execution is recorded in
the current V8 audit above. Planner flags remain dark; no quality, efficacy, or
adoption claim follows.

The source was subsequently pushed and mirrored cleanly at loaded hash
`73bbd494…` (122/122 first-party artifacts, zero drift). The V8 preflight and
preregistration then bound that loaded identity. The later V8 candidate run is
recorded in the current audit section above.

## 2026-09-03 planner screen order binding (documentation-only)

The v7 preregistration now records the deterministic seed
`planner-v7-2026-09-03` and the exact eight candidate plus four control fixture
order generated from it. This closes an auditability gap in the phrase
“randomized order”: a future approved run can be replayed and checked for order
effects without regenerating a different sequence. No source, launcher, mirror,
model, or default changed.

## 2026-09-03 fixture-bound planner launcher (repository-only)

The planner screen launcher no longer relies on an operator copying prompt text
from a manifest. `e8afded` adds a checked-in admission path: pass
`--fixture-manifest` and its canonical `--expected-fixture-sha256` to derive the
primary prompt, or add `--negative-control` to derive the embedded lightweight
fact lookup. The launcher rejects digest drift, symlink/out-of-slate manifests,
and prompt-file mismatches, and reports only fixture ID, role, and digest in its
safe summary. Legacy `--prompt-file` use remains available for older diagnostics.

The targeted fixture-binding tests were red before the helper/CLI existed and
are green afterward; Optimizer V2 offline verification passes (44 Python tests
in the v2 suite). This is optimizer tooling only: source surface remains
`d1b17fd8…`, loaded mirror remains `d83baa71…`, planner flags remain dark, and
no provider or Pi session ran. The v7 preregistration now has a reproducible
manifest-bound command for all four candidates and all four controls.

## 2026-09-03 planner completion-shaped fixture (preparation snapshot)

The next useful planner step was prepared at this point and later exercised
once as V8; see the current audit section above. The
research-fixture slate now contains a fourth admitted manifest,
`compare-json-yaml-config`, designed to finish within the shared three-search /
five-read envelope: one bounded branch for JSON, one for YAML, one cited claim
and limitation per branch, then a conditional synthesis. The stale
`preflight.py` exact-three assertion was red when this manifest was added and
is now green with a four-fixture self-test that still requires the comparative,
contested, and multi-part kinds.

The fresh execution envelope is
`optimizer/docs/PREREG_QWEN35B_PLANNER_COMPLETION_V7_2026-09-03.md`. It binds
source `d1b17fd8…`, loaded mirror `d83baa71…`, the unchanged candidate/control
configuration hashes, and all four manifest/admission digests. It proposes eight
candidate sessions (two per fixture) plus four randomized fact-lookup controls,
but authorizes no model run by itself. Planner flags remain dark; v5/v6
observations stay quarantined and cannot pool with v7. No mirror or source
surface changed for this optimizer-only preparation.

## 2026-09-03 opt-in Jina Reader formatter (repository-only)

`b8e1ab2` adds an opt-in `JINA_READER=on` mode to `web_read`. The harness still
uses Ketch for transport, public-URL preflight, timeout/output bounds, research
budgets, and ledger semantics; the only additional step is a deterministic
`https://r.jina.ai/<validated-url>` wrapper for pages that native reading cannot
render usefully. Results map back to the original URL so citations and
`research_note` continue to use the source identity rather than the formatter
URL. The Reader output is untrusted page text and does not grant authority.

This is deliberately no-key and public-URL-only: the harness passes no cookies,
credentials, or Jina API key, and Jina fetches the page server-side. The separate
Jina search endpoint is not wired in; Ketch remains the search provider. The
feature is dark by default, has a child-environment propagation test, and does
not change any active default or evidence interpretation. Source hash for this
boundary is `d1b17fd8…`; it is now mirrored at loaded hash `d83baa71…`
(122/122, zero drift). A pinned Qwen 35B load smoke exited 0 with zero stderr,
one session, 70 telemetry rows, and exact hash binding; Jina stayed off, so this
is a provenance receipt rather than formatter-quality evidence. Any
research-quality measurement remains pending. If enabled for a future screen, use a fresh preregistration and
record the Jina service/rate-limit conditions separately from Ketch-native rows.

## 2026-09-03 planner delegated-role contract repair (mirrored + smoked)

The v6 structural trace identified a model-facing mismatch: `research_plan_start`
and its active-tool guidance told the model to pass `plan_context` to a
“researcher” subagent, while the validator correctly requires the depth-one
`research-planner` role. Qwen therefore made a valid-looking call that was
blocked before child execution. `0ea5bcf` changes both strings and adds a
red-green integration test; the full offline suite remains green at 676/676.

This is a new model-visible source boundary. The current source surface is
`8993f671b417ab2b85a8b051b9c68311a085e6fc80c53730211571b40f7de9e0`, mirrored
cleanly at loaded hash `8976ab90262b99a9be314ae045f3fe08a7bdf69d8bf635d590e6d3d1e5de9e90`.
The short pinned Qwen 35B smoke exited 0 with zero stderr, one session, and 70
authenticated rows carrying that exact hash; no unsafe telemetry keys were
present. This is a loading/provenance receipt only, not planner measurement.
Planner flags remain dark, and the v6 diagnostic remains incomplete operability
evidence only. Any planner rerun requires a fresh preregistration bound to this
loaded hash; prior v5/v6 runs cannot be pooled.

After this boundary was mirrored, the first optimizer verification correctly
caught the stale planner preflight identity. `fd722d2` rebinds its no-inference
defaults to source `8993f671…` and loaded `8976ab90…`; the stale check was red
before the update and `verify:optimizer` is green afterward.

## 2026-09-03 delegated failure provenance repair

The v6 planner diagnostic exposed one more harness-side defect: a failed
subagent could return a nested `{isError:true}` result while Pi’s outer
`tool_execution_end` event carried `isError:false`. The run kernel then wrote a
successful receipt for a failed child. A targeted red-green test now covers
that boundary, and `cde0c84` promotes the nested flag into the effective error
classification and receipt. The full suite passes 676/676; no planner default
or model-facing route changed.

The new source surface is
`8e4c6d21e6e336f4d4c11f534f952e0767a999e1b41725dc231ff8857c29f582`.
The repair is mirrored at loaded hash
`9495e42754557772333e59a9336790c54bb9205c18ab5eef8cbcce99c6829b84` (122/122,
zero drift). A short pinned Qwen 35B smoke exited 0 with zero stderr and one
session of 70 hash-bound telemetry rows; no raw payload keys were present.
This is observability/provenance evidence only and does not qualify the
planner.

The first post-smoke optimizer verification also caught the expected stale
preflight pin. `preflight.py` now binds source `8e4c6d21…` and loaded
`9495e427…`; its selftest is green. This is optimizer provenance maintenance,
not a new model-facing behavior or inference result.

## 2026-09-03 planner budget guidance diagnostic

The v6 preregistered diagnostic ran after the source fix was pushed and
mirrored. It used Qwen 35B, candidate-arm config
`0d01aab9292db845b5f228174e2a1a4c10328883daebd482dcd9c9c9f5f5fd1e`, source
hash `0d3c7871…`, and loaded hash `12fbe4cd…`. The bounded launcher exited at
the 350,000-byte cap after 60.514 seconds (143), with zero stderr and 113
authenticated payload-free telemetry rows. Qwen emitted one `research-start`
and nine receipts; the graph stayed open with no merge or parent settlement.
The new three-search/five-read guidance appeared four times and the old vague
error zero times. This is incomplete operability evidence only; see
`optimizer/docs/QWEN35B_PLANNER_MECHANISM_V6_AUDIT_2026-09-03.md`.

The planner flags remain dark. V5 is still the failed six-candidate/three-
control mechanism screen; v6 does not qualify a rerun or a quality study. The
next useful step is a fresh preregistration with a completion-shaped fixture if
the planner remains a priority, followed by a separately approved multi-session
screen. No default, adoption, or source-tree change follows from this receipt.

The first post-receipt `verify:optimizer` correctly caught a stale
`preflight.py` source/loaded default. Those pins are now rebound to
`0d3c7871…` / `12fbe4cd…`; the preflight selftest and full optimizer
verification pass. This is an optimizer-only provenance correction, not a new
model-visible surface or inference result.

## 2026-09-03 planner budget guidance repair

The v5 screen’s structural traces showed repeated invalid
`research_plan_start` calls because the rejection said only that root budgets
exceeded the envelope; it did not expose the three-search/five-read limit that
the skill guidance already advertised. A targeted red-green test now requires
the actionable limit, and `cc74517` adds it while keeping the global budget and
graph semantics unchanged. The source surface is
`0d3c7871a22d210ba52cf2f3117a5da9cef087fb4caee4e6c46c3601224a88e6`.

The v6 preregistration is prepared at
`optimizer/docs/PREREG_QWEN35B_PLANNER_MECHANISM_V6_2026-09-03.md`. It requires
the mirror to be rebound to a newly observed loaded hash, then authorizes one
bounded Qwen diagnostic to check whether corrected budget calls can reach a
graph start. It does not authorize a new multi-session screen, quality claim,
default change, or adoption. The v5 six-candidate/three-control result remains
incomplete and is not pooled.

## 2026-09-03 first Qwen planner-screen receipt

The repaired parent-only lease was then exercised once in a separate bounded
diagnostic against the exact loaded hash `a4856f91…` (Qwen 35B, comparative
prompt, 180-second wall, 350,000-byte cap). The parent activated all ten leased
planner/research tools and obeyed the shared three-search/five-read wall; the
run exited at the output cap (143) after 95.478 seconds with 101 safe,
payload-free telemetry rows. It still emitted no `research-start`, branch
merge, or graph settlement, so it is not screen evidence and cannot pool with
the pre-lease receipt. The lease is reachable; the remaining reachability
question is why the model chooses the direct research path despite the graph
entrypoint being available. The v3 preregistration now records this diagnostic
explicitly.

The router was recovered from a stale listener and is now verified healthy on
`127.0.0.1:8080` with no backend loaded. The first comparative planner-screen
fixture was attempted in the default sandbox, where Pi could not reach the
router; that attempt is excluded. An identical host-network rerun reached
Qwen 35B and completed in 70.669 seconds with zero stderr, the expected loaded
surface `9629b4db…`, 98 payload-free authenticated telemetry rows, and no
identity drift. It observed protocol parity and three successful tool
receipts, but no research-plan activation, branch merge, or graph settlement;
the core session settled without a graph. This is an incomplete mechanism
observation only. The raw transcript and telemetry remain in a private
temporary directory, and the planner flags remain dark. The remaining five
candidate sessions plus three fact-lookup controls require separate approval.

## 2026-09-03 planner routing repair

A sharper diagnostic then used an explicit planner-first instruction against
the same loaded hash. Qwen called `research_plan_start` twice: its first
three-branch request allocated six reads and failed validation, then it
corrected to the five-read envelope, successfully started the graph, and began
one subagent. The run hit the 350,000-byte cap after 84.961 seconds (exit 143),
with one `research-start`, no branch merge or settlement, and payload-free
telemetry. This proves the lease and graph entrypoint are reachable, but it is
not screen evidence. The model-visible deep-research skill description now
advertises the planner-first route for complex work. Source commit `db3e5cd`
has source hash `c52d1af7…`; the mirror was clean at loaded hash
`8d7d210f…` (122/122), and v4 was bound to that earlier boundary. The
ordinary comparative diagnostic still bypassed the graph, so commit `4f014ad`
adds a parent-only `before_agent_start` planner-first route hint. The current
source hash is `a31ef6d4…`, the mirror is clean at loaded hash `ff5c7ce7…`
(122/122), and v5 is the current preregistration. No qualifying screen has
started under v5. A bounded v5 diagnostic against the frozen comparative
fixture then reached one `research-start` with five receipts, but hit the
350,000-byte cap at 83.884 seconds (exit 143), leaving one item open and no
branch merge or parent settlement. It produced 97 authenticated,
payload-free rows (stdout digest `a7380025…`, telemetry digest
`0b51c85b…`, private raw streams only). This is an incomplete operability
receipt; the six-session mechanism screen plus three controls remains the next
human-gated action.

The planner launcher now has explicit `--arm candidate` and `--arm control`
paths. It verifies the matching config digest, clears inherited planner flags,
and reports the arm identity in its safe summary; both dry paths pass against
loaded hash `ff5c7ce7…`. This is optimizer-only plumbing and does not change
the model-visible surface. The v5 screen has now run six candidate sessions and
three controls: starts 3/6, merges 0/6, parent settlements 0/6, and zero graph
events in all controls. It is an incomplete mechanism result; see
`optimizer/docs/QWEN35B_PLANNER_MECHANISM_V5_AUDIT_2026-09-03.md`. Planner
defaults remain dark, and any rerun requires diagnosis plus a fresh explicit
approval.

## 2026-09-02 planner research-fixture admission

The hierarchical planner screen now has three structurally admitted research
fixtures under `optimizer/research-fixtures/`: comparative
(`compare-http-api-styles`), contested (`password-expiration-guidance`), and
multi-part (`sqlite-postgres-selection`). `admission.py --selftest` and
`verify:optimizer` validate their prompt hashes, HTTPS source leads,
evidence-family/claim coverage, negative controls, bounded local oracle, and
provenance without network or inference. These receipts are explicitly
`structural_pass` from automation, not Albert's human review. The exact manifest and admission
receipt hashes are frozen in
`optimizer/docs/PREREG_QWEN35B_PLANNER_MECHANISM_V2_2026-09-02.md`.

This is instrument admission plus one incomplete mechanism observation: sources
have not been fetched for an answer judgment, no planner flag changed, and the
sandbox attempt was excluded. The next action is human review of the receipt
and a separately approved continuation against the current loaded surface
`9629b4dbd3d871703a82edbf12db76db813863a4c369b6d45edf2e3cb0671970`, then an
explicitly approved six-session mechanism screen plus three fact-lookup
controls. Any timeout, branch failure, or missing parent evidence remains
incomplete rather than a quality result.

The preflight's frozen source identity is now kept current by a selftest
freshness assertion. After the budget-control source change it was red against
the stale `5b84241c…` default; the repaired planner preregistration and default
are bound to source `70c202d4…` at the new planner activation snapshot
`db61e8e` (the model-visible surface last changed in `db61e8e`; later commits are
optimizer/preflight and documentation changes). The loaded mirror is now
`a4856f91…`, and no planner session has started under the new boundary.

The first receipt exposed a startup reachability gap: `research_plan_start`,
graph mutations, web tools, and delegation were all deferred even with the
candidate flags enabled. Source commit `db61e8e` adds the explicit
parent-only `PI_MUNCHKIN_HEADLESS_PLAN=on` lease to the planner launcher and
excludes it from child environments. The targeted activation test is red→green
and the full offline suite is green. See
`optimizer/docs/PREREG_QWEN35B_PLANNER_MECHANISM_V3_2026-09-03.md`; mirror and
loaded-hash rebinding remain the next gated steps. The old receipt cannot pool
with a fresh lease-enabled screen.

## 2026-09-02 research-ledger Run 4 preparation

The fresh ledger comparison is preregistered in
`optimizer/docs/PREREG_QWEN35B_RESEARCH_LEDGER_RUN4_2026-09-02.md`. It is
bound to source `62b1e565…`, loaded surface `9629b4db…`, and Qwen 35B. It uses
five existing research questions, randomized A/B order, a complete-baseline
requirement, an independent judge gate, and the same three-search/five-read
allowance for both arms. No Run 4 session has started; `RESEARCH_LEDGER`
remains dark. The next safe action is human review and explicit approval of the
two-arm command, not an automatic run.

The preflight is now codified as
`python3 optimizer/research-fixtures/preflight.py --dry --agent-dir
/Users/Albert.Wessels/.pi/agent`. It has been run successfully at the current
tip and reports the source hash, loaded hash, model, both threshold maps, and
three fixture IDs with `execution:false` and `inference_started:false`. It is a
readiness check, not human approval; use the hash-verifying planner launcher
only after the exact command and six-session envelope are explicitly approved.

The control arm now sets `RESEARCH_LEDGER=off` and `RESEARCH_BUDGET=on`.
`RESEARCH_BUDGET` is an opt-in accounting wall only: it shares the three-search
/five-read limit but registers no ledger tools, notes, cache, state, footer, or
wrap-up steering. Treatment keeps `RESEARCH_LEDGER=on`, which implies the same
wall and adds the verified-citation surface. The frozen source/config snapshot
is `98df5ed`, with source hash `62b1e565…` (the model-visible implementation
commit is `62b9bfb`); the mirror is now at loaded hash `9629b4db…`. Run 4 remains
inference-pending and requires the human review and explicit run approval
specified by its preregistration.

The optimizer config schema now also accepts `RESEARCH_BUDGET` and the config
selftest exercises `config_env({thresholds: {RESEARCH_BUDGET: "on"}})`.
Before this fix the runtime flag existed but a real-gate config rejected it as
unknown; commit `e5e2461` closes that pre-launch contract gap. No model-visible
surface or default changed.

## 2026-09-02 research-ledger budget wall

Run 3 exposed that the ledger footer was only informational outside a plan
graph: ledger-enabled sessions reached as high as 28 searches and 17 reads
despite the documented 3/5 envelope. The policy decision is now explicit:
`RESEARCH_LEDGER=on` applies a hard session-level wall of three search units and
five distinct source-read units when no graph allocation exists. Planned child
and parent-validation budgets remain governed by their existing allocations;
the ledger-off legacy path is unchanged.

Commit `073eb21` adds the red-green regression and the enforcement. The skill,
README, and candidate notes now describe exhaustion as an evidence gap rather
than a retry instruction. This is a model-visible boundary only when the dark
ledger flag is enabled; no default changed and no live inference ran for this
repair. Repeat the ledger comparison with a complete baseline and judge only
after a fresh preregistration bound to the new loaded surface.

## 2026-09-02 terminal invalid branch-report handling

The fresh zero-budget nested probe did not expose another report-validation
loop: its depth-one child timed out while the nested scout was running, and
the parent correctly stopped after one `child_failed` result. A separate
contract hole remained, however. A depth-one child that exits cleanly while
leaving no report (or an invalid report) was returned as an ordinary successful
tool result, even though the parent graph had no authoritative branch outcome.

The new `isTerminalPlannedFailureResult` policy and wrapper path close that
hole. Missing or invalid reports now emit the existing blocked branch signal
and a bounded terminal stop instruction; only ordinary and depth-two failures
retain retryable error semantics. The targeted policy test was red before the
change and green afterward. Source commit `dab25d4` is mirrored cleanly at
loaded hash `1e111c416843ba3998092b91a2bd2137c8944c442dceef564487abd8ef3542a`
(122/122, no unmanaged files).

A fresh disposable Qwen 35B probe asked a depth-one child to exit without a
branch report. The child hit the bounded 30-second child timeout, and the
parent stopped on one terminal `child_failed` result; the graph contains one
blocked branch, no evidence, and no settlement. This is lifecycle evidence
only, not a planner-quality or adoption result. Keep both planner flags dark.

## 2026-09-02 terminal-child coverage guidance

The zero-budget nested probe reached a fully completed child, but its final
`blocked` branch report omitted the required child coverage receipt. The
parent-facing result was therefore `invalid_report`, even though the child
returned a useful summary. Source commit `d2fa491` now identifies the exact
terminal child missing coverage and lists the required receipt fields; the
existing one-retry/circuit-breaker policy remains fail-closed. The source
surface is `9e8460655992c7879bd41e33ab35a400a0081b99741bf88fd7a60a7138e67cfd`.

This source boundary is pushed but not yet mirrored. The next smoke must use a
fresh loaded hash and include child coverage in the blocked report; only then
can the branch-merge path be assessed. The earlier zero-budget run is
quarantined as an invalid-report diagnostic. Keep planner flags dark.

## 2026-09-02 terminal planned-branch failure handling

The hash-pinned Qwen probe on the circuit-breaker surface still timed out after
its nested scout failed: the parent-facing `subagent` result was marked as an
ordinary error, so Qwen retried the same depth-one branch 27 times. The parent
graph was already blocked, but the model had no terminal protocol signal.

Commit `87a0cde` makes depth-one planned child failures terminal at the wrapper:
the existing branch-result signal records the branch as blocked, and the model
receives a bounded stop instruction without `isError`. Ordinary and depth-two
subagent failures remain retryable errors. The source surface is
`03f1c9de7489333cd361253ca1d957370eb79763fa4e7553294ccf7d3200edc9`.

This is a new model-visible boundary. It is pushed but not yet mirrored. The
previous circuit-breaker run was a bounded lifecycle diagnostic only and remains
quarantined. Mirror this source, rerun the approved one-branch Qwen smoke at the
new loaded hash, and inspect whether the parent exits after the blocked branch;
do not treat it as planner quality or adoption evidence.

The rerun against loaded hash `ef4305289114abed9c19da99663addaf7dc0de81be7db901a3ad5aa097c78807`
completed in 131.331 seconds with exit 0, 268,385 bounded stdout bytes, and
zero stderr. Safe inspection found one `research-start`, one `branch-failed`
(`child_failed`), one `ended-open`, and a single blocked depth-one branch. The
parent returned its one-sentence diagnostic after the terminal branch result;
there was no repeated parent delegation, output cap, or wall timeout. This is a
successful lifecycle/operability receipt for the new guard, not a graph
settlement, research-quality, or adoption result: the smoke deliberately stops
after the blocked branch and leaves the graph executing/blocked.

## 2026-09-02 planner malformed-report circuit breaker

The nested Qwen planner probe showed that explicit coverage guidance alone did
not stop a model from repeating the same invalid `complete:false` report. The
branch tool now allows one corrective retry, then writes a terminal `blocked`
`branch_report` with zero accepted evidence, usage, and child claims. This is a
branch-local protocol failure, not a quality judgment. Commit `21e2d10` adds the
counterfactual integration test and the fail-closed circuit breaker; the new
source surface is `ca573070b0ba40959ccb1dfeda13f97a71a358db79a85a5d20a5c25e7da719a4`.

The source is pushed but not yet mirrored. The prior loaded surface
`2f6976b4309cefa30344a9ca45d75b8b81f385452611ada5b1ab44552834dc73` still
produced an output-capped one-branch diagnostic after the guidance-only repair;
that run is quarantined. Mirror this new boundary, then rerun the approved
bounded Qwen smoke with a fresh hash binding. Keep both planner flags dark and
count the result only as lifecycle/operability evidence.

## 2026-09-02 planner branch-context transport repair

The second bounded Qwen planner smoke reached delegation but recorded
`child_failed`: the child wrapper correctly rejected a scout call that lacked
its required `plan_context`. The root cause was in the parent-facing transport:
`branch_plan` persisted the exact depth-two contexts in private tool details but
did not include them in the model-visible result text, even though the result
instructed the planner to copy them unchanged. Source commit `10b3faa` now
includes those contexts in bounded result text, with a targeted red-green
integration test. The new source surface hash is
`043f35a8f6358616a9cd9eec65fafbc734b127b2f410a9034435b366ad950dfd`.

This is a transport/lifecycle repair, not planner quality evidence. The live
mirror is now clean at 122/122 with loaded hash
`dc692af100770c84f50959c3c261c76eace603637da1d1b52de136d0560bad2a`.

The first exact-hash rerun then hit the launcher’s 180-second wall with zero
stderr, one `research-start`, one `child_failed`, three `ended-open` notices,
and no branch report, merge, or parent settlement. The graph remained open
(`pending`/`blocked`), so this is an incomplete operability receipt rather than
planner evidence; raw output and telemetry remain private. The previous runs
and this rerun cannot be pooled into a quality decision. Keep
`PLAN_GRAPH` and `DEEP_RESEARCH_PLANNING` dark, and prepare a fresh bounded
screen against this loaded hash before attempting any longer evaluation.

The launcher is now more reproducible as well: `69c77d3` adds a validated
`--thinking` option to `optimizer/v2/planner_smoke.py`. A private
role-authentic child probe using `--thinking minimal` completed the repaired
transport sequence: the branch planner received the returned depth-two context,
forwarded it unchanged to a scout, and produced a bounded blocked report with
an explicit no-retrieval gap. This is operability evidence only; it is not a
planner quality result and does not change any live default.

The follow-up one-branch exact-hash probe used the new `--thinking minimal` pin
and reached the complete nested dispatch path: the depth-one planner created a
scout leaf and forwarded its exact depth-two `plan_context` to
`research-scout`. The nested child did not settle before the 180-second wall;
the launcher returned `wall_timeout` (exit 143, 237,729 stdout bytes, zero
stderr), and the graph ended with one blocked `child_failed` branch, three
`ended-open` notices, and no branch merge or parent settlement. This narrows
the remaining blocker to child completion/lifecycle behavior. It is still an
operability receipt only; raw transcript and telemetry remain private, the
flags remain dark, and no quality evidence is implied.

## 2026-09-02 semantic-loop shutdown retest — lifecycle blocker retired

The current loaded surface (`251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`)
was tested with two candidate-only Qwen 35B sessions under a 30-second active-tail
bound. Both sessions received the external abort and emitted exactly one
authenticated `failure-episode/settled` summary before gate cleanup; rows were
complete, authoritative, provenance-bound, serving-stable, and passed the
infrastructure/low-timeout validity checks. The Pi output ended with
`Request was aborted`, so this exercised shutdown rather than normal completion.

This retires the missing-settlement portion of the semantic-loop blocker and
confirms the `telemetry-flush` shutdown-abort repair is live. It is not semantic
exposure or efficacy evidence: no intervention was counted by design. The
semantic candidate remains dark until a fresh, completion-bounded mechanism
screen demonstrates a delivered `winner_reason=semantic_tier` arbiter decision.
The full boundary and receipt are in
[`optimizer/docs/PREREG_QWEN35B_SEMANTIC_LOOP_SHUTDOWN_RETEST_2026-09-02.md`](optimizer/docs/PREREG_QWEN35B_SEMANTIC_LOOP_SHUTDOWN_RETEST_2026-09-02.md).

## 2026-09-02 semantic-loop delivery probe — retired for near-term Qwen queue

The fresh delivery preregistration then ran its first fixture (`sweep-c`) with
`LOOP_EPISODE_MODE=enforce` and a 180-second bound. Qwen reached 31 turns, 36
tool calls, six tool errors, and six opened failure episodes, but emitted zero
semantic interventions and no authenticated settlement before the bound. Trial
validity voided the row as incomplete; the second fixture was not started. With
the earlier three-fixture mechanism screen showing the same non-delivery
pattern, semantic-loop enforcement is explicitly retired from the near-term
Qwen adoption queue. This is subject/fixture operability evidence, not a claim
of mechanism ineffectiveness. Keep `LOOP_EPISODE_MODE=shadow` and do not pool
these rows. The boundary is in
[`optimizer/docs/PREREG_QWEN35B_SEMANTIC_LOOP_DELIVERY_2026-09-02.md`](optimizer/docs/PREREG_QWEN35B_SEMANTIC_LOOP_DELIVERY_2026-09-02.md).

The hierarchical planner/deep-research graph is now the next dark-candidate
screen: it still requires fresh fixture admission, current-hash preregistration,
and a mechanism-only run before any quality comparison or default change.

The first narrow Qwen planner smoke on 2026-09-02 is **invalid/incomplete**.
An explicit `--tools` launch correctly kept the planning family unavailable;
the corrected ambient launch did emit `research-start` and persist two schema-v5
branches, but it entered an unbounded tool-call stream without branch merge or
parent settlement. Its disposable agent copy resolved to surface hash
`4f5516aa…`, not the frozen mirror hash `251708fed…`, so those events are only a
diagnostic activation lead. Keep `PLAN_GRAPH` and `DEEP_RESEARCH_PLANNING`
dark. The next screen must use an exact mirrored surface, a hard outer stream
bound, admitted research fixtures, and fact-lookup negative controls. Details
and the frozen identity are recorded in
[`optimizer/docs/PREREG_QWEN35B_PLANNER_MECHANISM_SMOKE_2026-09-02.md`](optimizer/docs/PREREG_QWEN35B_PLANNER_MECHANISM_SMOKE_2026-09-02.md).

A subsequent disposable copy made directly from the live mirror matched the
frozen loaded hash but still stopped with two pending branches and no merge or
settlement. It is incomplete and cannot count as exposure. Commit `07f555a`
adds the offline-tested `optimizer/v2/planner_smoke.py` launcher, so the next
attempt can enforce the hash, a shared output ceiling, and a process-group wall
without retaining raw model output in the result summary.

The first run through that launcher used the exact frozen mirror and stopped
cleanly at the 350,000-byte cap after 52.7 seconds. It produced one
`research-start`, two pending branches, and no branch merge or parent settlement;
the result is a bounded lifecycle receipt, not planner mechanism or quality
evidence. Keep both planner flags dark. The detailed receipt is in
[`optimizer/docs/PREREG_QWEN35B_PLANNER_MECHANISM_SMOKE_2026-09-02.md`](optimizer/docs/PREREG_QWEN35B_PLANNER_MECHANISM_SMOKE_2026-09-02.md).

A stricter second run activated the research and delegation families and started
one child, but the child failed before producing a mergeable report; the parent
remained open and hit the same 350,000-byte cap after 131.3 seconds. This is a
bounded child-failure diagnostic, not planner exposure or quality evidence, and
the flags remain dark.

## 2026-09-02 bash-output-guard paired receipt

The preregistered Qwen 35B paired mechanism screen is clean. Four fresh RPC
sessions (B-noisy, A-ordinary, B-ordinary, A-noisy) all exited 0 with zero
stderr and the same loaded surface hash
`251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`. The
guard withheld exactly one 12,000-character noisy result at the 8,000-character
cap, returned a bounded error-shaped diagnostic, and made no second oversized
call. It did not withhold the ordinary treatment result, and neither control
withheld anything. This proves reachability and specificity only; it supplies
no quality or adoption evidence. Keep `BASH_OUTPUT_GUARD` dark pending a
representative value screen. The full audit is in
[`optimizer/docs/QWEN35B_BASH_OUTPUT_GUARD_PAIRED_AUDIT_2026-09-02.md`](optimizer/docs/QWEN35B_BASH_OUTPUT_GUARD_PAIRED_AUDIT_2026-09-02.md).

## 2026-09-02 research-ledger Run 3 — deterministic receipt

The post-fix Qwen 35B research-ledger comparison is complete as a
mechanism/fidelity study. Nine of ten fresh sessions exited 0 with zero
stderr; the legacy arm for Q9 reached its 15-minute bound without an answer
and is incomplete. All ten telemetry files carry one run identity and the
loaded surface hash
`251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`, with no
raw payload fields retained. The ledger arm recorded 22 notes and rejected 24
attempts across 52 searches and 48 reads; no `corrected` attribution event
occurred, and no independent judge was available, so synthesis is
**UNAVAILABLE**. The nominal search/read envelope was exceeded outside plan
context (up to 28 searches and 17 reads), which is a separate instrumentation
finding rather than an adoption signal. The full sanitized audit is in
[`optimizer/docs/QWEN35B_RESEARCH_LEDGER_RUN3_AUDIT_2026-09-02.md`](optimizer/docs/QWEN35B_RESEARCH_LEDGER_RUN3_AUDIT_2026-09-02.md).
`RESEARCH_LEDGER` remains dark; decide and test non-graph budget enforcement
before any judge-backed repeat.

## 2026-09-02 committed handoff outcome — clean Qwen mechanism receipt

The first mirrored smoke showed that Pi can commit the handoff compaction and
then report `Nothing to compact` from a later callback/racing lifecycle path.
That left a false `ok:false` outcome and no continuation even though the
context had already been rewritten. Commit `accdf89` records the durable
`session_compact` event while the model-handoff lease is active, treats that
event as authoritative if a later callback errors, and blocks a duplicate
handoff in the same epoch. The new regression was red before the repair and
the 14-test context suite plus typecheck are green afterward; the source
surface is `b929b6b2239f364be90a9bb012881d291260caf11bb38b10c2c22afc79a07917`.

The approved mirror refresh is complete: `mirror:apply` wrote 122 first-party
artifacts and `mirror:check` reports 122/122 with no unmanaged extensions or
orphans. The loaded surface hash is
`251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`, and the
v4 preregistration is bound to it. The fresh two-turn screen is a clean
mechanism receipt: one `model-handoff` compaction, one `ok:true` runtime
outcome, one cancelled oversized request, and one successful post-compaction
response, with 58 hash-stamped safe rows and zero stderr. The audit is in
[`optimizer/docs/QWEN35B_CONTEXT_HANDOFF_THRESHOLD_V4_AUDIT_2026-09-02.md`](optimizer/docs/QWEN35B_CONTEXT_HANDOFF_THRESHOLD_V4_AUDIT_2026-09-02.md).

The prior v5/v6/v7 diagnostics remain quarantined. The no-goal rearm,
active-goal preservation, and same-router model-switch screens are now complete;
none of those receipts supplies capacity, quality, or adoption evidence. A
different-provider or differing-window switch remains a future safety study.

The no-goal rearm screen was preregistered in
[`optimizer/docs/PREREG_QWEN35B_CONTEXT_HANDOFF_REARM_2026-09-02.md`](optimizer/docs/PREREG_QWEN35B_CONTEXT_HANDOFF_REARM_2026-09-02.md),
bound to source `accdf89` and loaded hash
`251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89` and is
closed by the clean receipt below.

That rearm screen is complete and clean: 96 unique hash-stamped rows, two
`ok:true` handoffs, two cancelled oversized requests, three successful
provider responses, two `model-handoff` compactions, and zero native
compactions. The audit is in
[`optimizer/docs/QWEN35B_CONTEXT_HANDOFF_REARM_AUDIT_2026-09-02.md`](optimizer/docs/QWEN35B_CONTEXT_HANDOFF_REARM_AUDIT_2026-09-02.md).
This receipt does not imply active-goal or cross-epoch safety; those are
recorded separately below.

The active-goal screen was preregistered in
[`optimizer/docs/PREREG_QWEN35B_CONTEXT_HANDOFF_ACTIVE_GOAL_2026-09-02.md`](optimizer/docs/PREREG_QWEN35B_CONTEXT_HANDOFF_ACTIVE_GOAL_2026-09-02.md),
bound to runtime source `accdf89` and the loaded hash above. A first attempt
was discarded before inference because the router was not serving; it produced
no authoritative provider or handoff evidence. The later host-reachable run is
clean: one fresh session, one `ok=true` model-handoff outcome, one recovery
brief, and the same non-null active `current_goal_id` before and after
compaction. The full audit is in
[`optimizer/docs/QWEN35B_CONTEXT_HANDOFF_ACTIVE_GOAL_AUDIT_2026-09-02.md`](optimizer/docs/QWEN35B_CONTEXT_HANDOFF_ACTIVE_GOAL_AUDIT_2026-09-02.md).
This closes only the active-goal preservation mechanism gate; the separate
same-router model-switch screen is recorded below.

The model-switch context-epoch screen is now also complete. Its preregistration
and audit are in
[`optimizer/docs/PREREG_QWEN35B_CONTEXT_EPOCH_SWITCH_2026-09-02.md`](optimizer/docs/PREREG_QWEN35B_CONTEXT_EPOCH_SWITCH_2026-09-02.md)
and
[`optimizer/docs/QWEN35B_CONTEXT_EPOCH_SWITCH_AUDIT_2026-09-02.md`](optimizer/docs/QWEN35B_CONTEXT_EPOCH_SWITCH_AUDIT_2026-09-02.md).
The clean receipt used one fresh session, two successful provider turns, and
exactly epoch 0 (Qwen) then epoch 1 (Ling) profiles, each with separate hashed
serving identity and discovery facts. Handoff was disabled to isolate epoch
rebinding. This does not cover different providers/windows or cross-epoch
handoff safety.

The Qwen bash-output guard trigger screen is complete as a mechanism receipt.
Its preregistration and audit are in
[`optimizer/docs/PREREG_QWEN35B_BASH_OUTPUT_GUARD_2026-09-02.md`](optimizer/docs/PREREG_QWEN35B_BASH_OUTPUT_GUARD_2026-09-02.md)
and
[`optimizer/docs/QWEN35B_BASH_OUTPUT_GUARD_AUDIT_2026-09-02.md`](optimizer/docs/QWEN35B_BASH_OUTPUT_GUARD_AUDIT_2026-09-02.md).
One 12,000-character bash result was withheld at the 8,000-character limit in
one fresh session; the process settled cleanly and retained no raw command or
output. The candidate remains dark pending paired noisy/ordinary false-positive
and recovery-cost evidence.

## 2026-09-02 pre-request handoff abort ordering — mirrored, Qwen smoke pending

The settled-turn repair exposed one final race in the real Pi lifecycle:
`ctx.compact()` is fire-and-forget and Pi's session compactor waits for an
abort internally. At the final `before_provider_request` boundary, that could
leave the active oversized request alive while compaction started, so the
stale payload could still reach the provider. Commit `392fcdc` now invokes
the synchronous abort hook before launching the compactor. The new assertion
was red before the change and the complete 13-test context suite plus
typecheck are green afterward; the source surface is
`c73d86a5c704253293d7458823e591e4e30424ce626a95bb91e397c3d0cf37c0`.

The approved mirror refresh is complete: `mirror:apply` wrote 122 first-party
artifacts and `mirror:check` reports 122/122 with no unmanaged extensions or
orphans. The loaded surface hash is
`f5cdd5b6cf94e7d5687ff2cda1d1e87af6c535b96ed9456481b194af2c55dddb`, and the
v4 preregistration is now bound to it. The clean two-turn Qwen screen is the
next model action; no Qwen inference, capacity, quality, or adoption claim is
attached to this repair yet.

## 2026-09-02 goal grammar boundary — mirrored and smoked

The goal-schema compatibility fix is now pushed (`b225d20`, with boundary
documentation `daaab6f`/`342451e`), mirrored into `/Users/Albert.Wessels/.pi/agent`,
and verified at 122/122 with no unmanaged extensions or orphans. The loaded
surface hash is `7624ee447fb6a9a77f96e4abf5ee9b01580ddd478f3ae67b329f858761e07ca7`.

The pinned Qwen 35B live mechanism smoke exited 0 with zero stderr. Its private
`pi.goal-ledger/v2` record has one goal at `complete`, one met criterion, and
`current_goal_id: null`; 128 safe telemetry rows include one each of
`goal-runner/started`, `goal-runner/updated`, and `goal-runner/settled`, with
five goal-surface activations and four deactivations. Every summarized row
carries the loaded hash and no sensitive payload key appears. This is a
protocol/lifecycle receipt only, not gate, quality, or adoption evidence.

The preregistration and receipt are in
[`optimizer/docs/PREREG_QWEN35B_GOAL_GRAMMAR_2026-09-02.md`](optimizer/docs/PREREG_QWEN35B_GOAL_GRAMMAR_2026-09-02.md).
The old graceful-shutdown preregistration is stale against this source and must
not be reused. A fresh hash-bound screen is now prepared at
[`optimizer/docs/PREREG_QWEN35B_GRACEFUL_SHUTDOWN_2026-09-02.md`](optimizer/docs/PREREG_QWEN35B_GRACEFUL_SHUTDOWN_2026-09-02.md),
bound to the same source and loaded hashes. Its no-inference dry preflight
passed. The three-row execution then reached `gate=1` for each fixture but was
voided by trial validity because no authenticated settlement summary arrived;
the audit is in
[`optimizer/docs/QWEN35B_GRACEFUL_SHUTDOWN_AUDIT_2026-09-02.md`](optimizer/docs/QWEN35B_GRACEFUL_SHUTDOWN_AUDIT_2026-09-02.md).
Do not resume or pool those rows. The next source work is a deterministic
active-tool cancellation fixture; a fresh preregistration is required after any
fix.

The timeout-side root cause is now isolated and fixed in gate commit `6ef1464`:
GNU `timeout` was forwarding duplicate `SIGTERM` through the Seatbelt wrapper.
The wrapper now uses `--foreground` and leaves descendant cleanup to the gate's
existing process-group sweep. A fresh pinned Qwen fixture emitted exactly one
`session_shutdown` followed by one `agent_settled` before the expected timeout
status `124`. This is an infrastructure mechanism receipt, not a gate row; the
new preregistration and audit are in
[`optimizer/docs/PREREG_QWEN35B_GRACEFUL_SHUTDOWN_FOREGROUND_2026-09-02.md`](optimizer/docs/PREREG_QWEN35B_GRACEFUL_SHUTDOWN_FOREGROUND_2026-09-02.md)
and
[`optimizer/docs/QWEN35B_GRACEFUL_SHUTDOWN_FOREGROUND_AUDIT_2026-09-02.md`](optimizer/docs/QWEN35B_GRACEFUL_SHUTDOWN_FOREGROUND_AUDIT_2026-09-02.md).
Before collecting real gate rows, prepare a new full preregistration bound to
the current gate commit and run its dry preflight. The earlier invalid rows
remain quarantined.

That fresh full screen is now recorded in
[`optimizer/docs/QWEN35B_GRACEFUL_SHUTDOWN_V2_AUDIT_2026-09-02.md`](optimizer/docs/QWEN35B_GRACEFUL_SHUTDOWN_V2_AUDIT_2026-09-02.md): all three fixture gates passed, but `parens` and `bigdata` were still actively mutating at the 480-second bound and failed infrastructure validity; only `equil` completed with one authoritative settlement. Keep the two voids isolated. This confirms the foreground signal fix is active, while the remaining issue is an unfinished model/tool loop rather than duplicate shutdown signalling.

The current Qwen semantic-loop mechanism screen is also complete and failed
closed: `sweep-b` settled at 344/480 seconds but had no valid delivered semantic
intervention, while `sweep-c` and `ling-exact-gate-recovery` remained active at
the bound and were voided. The preregistration and audit are in
[`optimizer/docs/PREREG_QWEN35B_SEMANTIC_LOOP_MECHANISM_2026-09-02.md`](optimizer/docs/PREREG_QWEN35B_SEMANTIC_LOOP_MECHANISM_2026-09-02.md)
and
[`optimizer/docs/QWEN35B_SEMANTIC_LOOP_MECHANISM_AUDIT_2026-09-02.md`](optimizer/docs/QWEN35B_SEMANTIC_LOOP_MECHANISM_AUDIT_2026-09-02.md).
Keep `LOOP_EPISODE_MODE=shadow`; the planner graph remains blocked until the
active-tool tail and semantic-delivery boundary are characterized.

The earlier independent dynamic-context epoch smoke was preregistered in
[`optimizer/docs/PREREG_QWEN35B_CONTEXT_EPOCHS_2026-09-02.md`](optimizer/docs/PREREG_QWEN35B_CONTEXT_EPOCHS_2026-09-02.md).
It is a single no-tool, no-goal reachability run with local serving discovery
and one-token calibration enabled, while automatic handoff stays off to keep
the first receipt interpretable. It cannot establish handoff safety, capacity,
rearming, or model-switch behavior.

That smoke has now completed on the bound surface: Pi exited 0 with empty
stderr; 72 safe rows included the model profile, local serving truth
(`65536/61440`, verdict `ok`), the post-probe budget update, and a successful
reachability calibration labelled `observed`. The audit is in
[`optimizer/docs/QWEN35B_CONTEXT_EPOCHS_AUDIT_2026-09-02.md`](optimizer/docs/QWEN35B_CONTEXT_EPOCHS_AUDIT_2026-09-02.md).
It is wiring evidence only. The subsequent threshold, rearm, active-goal, and
same-router model-switch receipts are recorded above; no conclusion about
different-provider/window safety is drawn from them.

The first threshold probe then exposed a real lifecycle gap. A read-only usage
probe saw the assembled context above the safe budget in `before_provider_request`
(89.55%) but below it by `turn_end` (75.08%), and no handoff outcome was emitted.
The runtime was checking too late, after the response had already reduced the
measured usage. The targeted test was red against the old source and green
after `aad8e84`, which checks the existing single-flight handoff at the final
pre-request boundary. The diagnostic receipt is in
[`optimizer/docs/QWEN35B_CONTEXT_HANDOFF_THRESHOLD_AUDIT_2026-09-02.md`](optimizer/docs/QWEN35B_CONTEXT_HANDOFF_THRESHOLD_AUDIT_2026-09-02.md);
the repaired source hash is `704ca820…`, while the live mirror remains on the
earlier loaded hash. A new hash-bound screen is prepared in
[`optimizer/docs/PREREG_QWEN35B_CONTEXT_HANDOFF_THRESHOLD_V2_2026-09-02.md`](optimizer/docs/PREREG_QWEN35B_CONTEXT_HANDOFF_THRESHOLD_V2_2026-09-02.md)
and requires a separately approved mirror before any model run. No handoff
safety or adoption claim is valid yet.

The approved mirror rollout has now been applied: `mirror:apply` and
`mirror:check` report 122/122 first-party files with no unmanaged extensions or
orphans. The loaded surface hash is
`2c3449b84ab1ca3ca8cb5b88bfe2dfa79399def57301e20406d5be969dae11f6`, and the
v2 preregistration is updated to bind it. The router is currently serving
`defiant-9b`, not the Qwen subject, so no inference was started during this
rollout. The next model action is the explicitly approved Qwen threshold screen
under the new preregistration; until then, the source-only diagnostic and the
loaded rollout receipt remain separate from model evidence.

That threshold screen was then run against the loaded Qwen surface and failed
closed for a useful edge case: the synthetic input was an oversized *initial*
prompt, so there was no prior provider turn to compact. The runtime emitted a
bounded `budget_threshold` handoff failure and paused without accepting a
response; the audit is in
[`optimizer/docs/QWEN35B_CONTEXT_HANDOFF_THRESHOLD_V2_AUDIT_2026-09-02.md`](optimizer/docs/QWEN35B_CONTEXT_HANDOFF_THRESHOLD_V2_AUDIT_2026-09-02.md).
A counterfactual test was red without the new guard and all 12 targeted tests
are green with it. Source commit `8f5d475` now requires a prior provider turn
before automatic handoff, with repaired source hash
`18d9b372b936bd9d00ae1ebcc9fee504ab4771fe110ef6c0e792fa170f769e27`. The
hash-bound two-turn follow-up screen is prepared in
[`optimizer/docs/PREREG_QWEN35B_CONTEXT_HANDOFF_THRESHOLD_V3_2026-09-02.md`](optimizer/docs/PREREG_QWEN35B_CONTEXT_HANDOFF_THRESHOLD_V3_2026-09-02.md);
it requires a fresh mirror before execution. No handoff-safety, capacity,
quality, or adoption claim is valid yet.

The v3 two-turn probe then exposed the follow-on edge inside that guard: the
first successful turn was removed from `completed` during `agent_settled`, so
the second request was misclassified as another initial prompt. Safe hook
telemetry confirmed that the second request had 53,716 tokens (87.4%), a
working `compact()` API, and no active coordinator lease. The targeted test
was red before the repair and green after commit `715f6d8`; the new source
surface is `8822a6ffeb61be2ae0ec4f563b71c6787de4ef919a969cd747a3b82cddaa5fb2`.
The updated v4 preregistration is prepared, but the current mirror still
contains the earlier `59d7c389…` surface and must be refreshed before another
model run. No handoff-safety, capacity, quality, or adoption claim is valid.

## 2026-09-02 pre-fix dark-candidate DD mechanism probes

The router was reachable and Qwen 35B completed a bounded transport smoke.
Isolated exploratory probes then exercised the dark-candidate wiring: bash
output withholding, semantic-loop enforcement, working-memory upsert/list,
minimal-surface file mutation, context-epoch discovery, and a single-source
research-ledger read/note all emitted their expected safe signals. The original
goal probes failed before inference because Qwen rejected nested goal-schema
limits at the llama.cpp grammar boundary. A red-green source fix now caps the
model-visible goal strings at 1,999 while retaining the runtime 2,000-byte
ledger bound; a source-wired Qwen smoke then exited 0, created/read the ledger,
and completed a goal. The live mirror still has the old surface, so this is
mechanism evidence only until an approved rollout. A research-shaped run did
start a schema-v5 graph but left its branch pending at the 240-second bound.
These remain pre-fix mechanism observations only, not efficacy or adoption
evidence. The later goal fix and rollout are recorded above; no dark defaults,
gate rows, or candidate adoption changed. Full classifications and the longer-
run gates are in
[`optimizer/docs/DARK_CANDIDATE_DD_MINI_SCREEN_2026-09-02.md`](optimizer/docs/DARK_CANDIDATE_DD_MINI_SCREEN_2026-09-02.md).

At the time of those pre-fix probes, the goal schema source change was
uncommitted and unmirrored. It is now committed and loaded at the hash recorded
in the goal receipt above; the targeted schema test was red before the fix and
green after it, and the full offline verification is green (663/663 tests; all
six `npm run verify` stages). Do not pool the historical source-wired smoke
with live or gate evidence.

## 2026-09-02 dark-candidate DD mini-screen

The DD endpoint was unavailable, so no model run was attempted. Candidate
contract suites passed 118/118 and the offline optimizer verification passed.
The per-candidate evidence status and minimum useful run lengths are recorded
in [`optimizer/docs/DARK_CANDIDATE_DD_MINI_SCREEN_2026-09-02.md`](optimizer/docs/DARK_CANDIDATE_DD_MINI_SCREEN_2026-09-02.md).
The prepared Qwen35B graceful-shutdown smoke remains the next human-gated
action; no dark flag, default, mirror, or adoption decision changed.

On the next continuation, the host-network check returned `/health = OK` and
reported `qwen36-35b-iq3s` loaded. The attempted transport smoke was correctly
refused because that message authorized a health check, not model inference.
The source/live-mirror boundary is unchanged: `mirror:check` still reports
1/122 differing (`telemetry-flush.ts`).

## 2026-09-01 graceful gate shutdown settlement — source-only

The gate's hard timeout was not the only lifecycle boundary: Pi print mode handles
`SIGTERM` by emitting `session_shutdown` and disposing the runtime, while an active
agent may still be streaming. `telemetry-flush` now requests an abort during that
boundary, waits for the actual `agent_settled` callback (bounded at 25 seconds under
the existing 30-second kill grace), then flushes telemetry. A targeted regression was
red before the fix and green after it; the full harness suite is 662/662 and typecheck
passes. This is a source-only model-visible boundary (`f5b3a00d…`), pending human
rollout and a new loaded-surface smoke. It changes no defaults and supplies no Qwen
quality evidence; do not rerun or pool a gate until the new surface is explicitly
approved and bound.

The next safe action is prepared in
[`optimizer/docs/PREREG_QWEN35B_GRACEFUL_SHUTDOWN_2026-09-01.md`](optimizer/docs/PREREG_QWEN35B_GRACEFUL_SHUTDOWN_2026-09-01.md).
It binds source hash `f5b3a00d…`, requires a newly mirrored/recorded loaded
hash, and keeps the prior 480-second timeout so only the settlement lifecycle
changes. The dry preflight is offline; the three-row Qwen command remains
human-approval-only. Do not use the old `63671544…` loaded receipt or pool the
earlier timeout-retry rows.

## 2026-09-01 Qwen35B baseline screen — lifecycle cutoff, evidence voided

The current-surface Qwen35B base-only screen was run under invocation `96faf8`
(`parens`, `equil`, `bigdata`, one replicate each). All three local fixture
gates passed, and all three rows carried matching authenticated model,
provider, registry, config, and loaded-surface identities. The trial-validity
sidecar nevertheless voided all three rows: each session hit or approached the
240-second bound before `agent_settled`, leaving no authenticated
failure-episode settlement summary. This is incomplete infrastructure evidence,
not a Qwen quality result. See
[`optimizer/docs/QWEN35B_BASELINE_AUDIT_2026-09-01.md`](optimizer/docs/QWEN35B_BASELINE_AUDIT_2026-09-01.md).

Do not resume or pool this run. The next model run requires a fresh
preregistration with a longer but still bounded wall-clock policy (or a
characterized graceful-stop path). No candidate, semantic-loop, planner, or
deep-research screen is authorized by this result.

## 2026-09-01 Qwen35B timeout retry — one valid row, two lifecycle voids

The explicitly approved replacement used the same model, provider, fixtures,
arm, configuration, registry, loaded surface, and provenance protocol, changing
only `PI_TIMEOUT` from 240 to 480 seconds. `equil` reached one authoritative
settlement at about 451 seconds. `parens` and `bigdata` still ended in tool-loop
tails without `agent_settled`, so the sidecar voided them for `infra_valid` even
though their fixture gates passed. See
[`optimizer/docs/QWEN35B_BASELINE_TIMEOUT_RETRY_AUDIT_2026-09-01.md`](optimizer/docs/QWEN35B_BASELINE_TIMEOUT_RETRY_AUDIT_2026-09-01.md).

This establishes that the original timeout was too short but that a larger
bound alone is not a reliable protocol. Do not pool or resume the retry and do
not start another Qwen screen until a graceful-stop/telemetry-settlement path
has been characterized and separately preregistered. No semantic-loop,
planner/deep-research graph, optimizer, or adoption work is authorized by
these rows.

## 2026-08-27 persistent goals + dynamic context (source-only)

The current source branch adds private project/worktree goal state with
skill-proposed/user-accepted activation and evidence-backed `complete` or
`accepted_80_20` settlement, plus model-fingerprinted context epochs and
automatic bounded handoff compaction on model switches/turn-budget crossings.
See [`docs/GOAL_MODE_AND_DYNAMIC_CONTEXT_2026-08.md`](docs/GOAL_MODE_AND_DYNAMIC_CONTEXT_2026-08.md).
The changes are not mirrored into `~/.pi/agent`; calibration remains opt-in via
`CONTEXT_DISCOVERY=on`, and no powered model run has been performed. Source
surface hash for this unmirrored boundary: `5e89ef8150fb8d3a4c39f3e2145988acddfc1b2c7aa350a8c26438f1462e35cc`.

Read `optimizer/docs/MEASUREMENT_METHODOLOGY_2026-07.md` before interpreting any historical
experiment. A 2026-07-27 audit established that most A/B results were unsupported: rounds at
n=3–9/arm lacked useful power, pass/fail did not measure the efficiency target, and 40 of 45
candidates could not prove their mechanism fired. Every earlier `NEUTRAL` is currently
**UNTESTED**, not rejected.

The robust measured constraint is repeat-call spiraling. Across 1,505 sessions, median context was
about 4.9k tokens, while the longest 10% of sessions carried 43% of wasted tool calls. Judge new
work against that failure class.

## Repositories and authority

| Location | Role | Rule |
|---|---|---|
| `~/pi_munchkin` | public source of truth | review, secret-scan, verify, then push |
| `~/.pi/agent` | live harness mirror | never push; mirror only after human rollout approval |
| `~/LLM` | model serving | at most one gate round per serving box |

The source and live harness are intentionally not auto-synchronized. Model-visible defaults,
adoption, deletion, live mirroring, and gate rounds are human-gated. Never touch files matching
`context-pressure*`.

## 2026-08-25 semantic-loop screen prepared (design-only; no inference ran)

`PREREG_SEMANTIC_LOOP_SCREEN_2026-08.md` pre-registers the calibration + mechanism screen for
`LOOP_EPISODE_MODE=enforce` — subject `qwopus35-4b` (Albert-chosen; the restart-condition-#1
argument is in the prereg and the mothball addendum), slate `sweep-b`, `sweep-c`,
`ling-exact-gate-recovery`, `ling-partial-order-release`, `audit-sweep`. It supersedes the
never-approved `PREREG_FAILURE_EPISODE_BASELINE_2026-08.md` and declares five verified
measurement hazards, the two load-bearing ones being: the adopted `VERIFICATION_PLATEAU=enforce`
default contends at the same arbiter priority (600) as semantic tier-1/2 steers with the loser
dropped, and `failure-episode/intervention` records **proposal**, not delivery (delivery is
`control-arbiter/decision` with `winner_reason="semantic_tier"`). Two artifacts ship with it:
`optimizer/prompt-lab/make_episode_manifest.py` (builds the private study manifest; computes
all six identity hashes; refuses in-repo writes; round-trips through `load_manifest`; its dry
run reproduced loaded `acd18a54…` exactly) and a fix in `context_telemetry.py` — the
`episode_id` validators required 64-hex while the harness emits 16-hex ids, so
`failures_after_second`/`recovered_episodes`/`recovery_calls_*` were silently always 0 on real
rows (counterfactually proven; `semantic_failure_overrun` was never affected). All
optimizer-side: the model-visible surface did NOT move (source hash re-verified `522fd127…`).
**Every stage — preflight, calibrate (30 sessions), the added n=6 candidate-arm mechanism
screen, power, primary, replication — remains a separate Albert-started action; the mothball
stands until he starts preflight.**

## 2026-08-26 integration batches 0-2 — mirrored, smoke outstanding

The deferred list below is being worked as **five classes**, not fifteen fixes. Batches 0-2 are
committed on `main` (`824301c`..`ab00faa`), verify 6/6, 609 tests, source `c6e588dc…`, **mirrored
2026-08-26** — `mirror:check` 118/118, loaded `bdc18ba8…`.

**Smoked 2026-08-26** on the new router entry `ling3-tiny-fast` (resident, no swap): exit 0 in 17 s,
zero stderr, 64 rows on a single `si`, all stamped `f9f728b3…`, zero error/reject rows, core spine
9 active / 42 deferred of 55. Both settled rows present for the one agent run — live confirmation of
the batch-1 latch re-arm. The smoke also confirmed the batch-3 defect is still live and untouched:
**`model` and `provider` are null on every row.**

The thesis, and the reason the batches are ordered this way: **the suite systematically exercised
the configuration nobody ships.** One extension per FakePi, never manifest order. The planner suite
pinned to `PLAN_STORAGE=project`, the rollback. Producer tests installed with no arbiter, so every
delivery assertion ran the legacy path while the shipped default is `CONTROL_ARBITER=enforce`.
Batch 0 fixed that first; the rest only became findable afterwards.

**Two tools you will want to reuse**, both added this round:
- `emitRivalProposal(fp, boundary, {terminal})` in `harness/tests/integration-harness.ts` — makes a
  producer lose to a REAL arbiter. `terminal: true` also suppresses the merge rescues, which is the
  only way a loser is genuinely dropped rather than delivered as a suffix.
- `harness/tests/manifest-boot.test.ts` — the full-manifest boot, now including a faithful reload
  (the fake bus survives it, as Pi's does). Add to it before writing a targeted interaction test.

**Remaining in Batch 2**, in the risk order the audit established:
- **ketch** wrap-steer — structurally trivial, but at priority 100 with no merge rescue it loses most
  contested boundaries, so deferring the charge turns "fires once, maybe unseen" into a retry spiral.
  Needs an attempt cap alongside the migration.
- **loop-breaker outcome** — `outcomeFired` is a per-fingerprint counter the NEXT turn reads, so a
  deferred charge leaves it stale for one boundary and can re-propose. Needs a per-fingerprint
  in-flight guard, not the single-slot helper.
- **loop-breaker exact T1/T2** — `ep.steered` charges ALL lower tiers at once, so "undo on loss" is
  not one decrement; `ep.lastSteerTurn` additionally feeds the progress-after-steer metric.
- **loop-breaker semantic/session tiers** — hardest. Those latches gate *observation* telemetry
  (`tier-observed`) as well as the message, several frames before the proposal. Splitting "observed
  this tier" from "spent this tier's message" is a prerequisite, not an afterthought.
- **verify-gate wrap nag and the state lens** — now unblocked by `decision.delivered`.
- **`session-blackboard` under-counts**: `steer-injected` is recorded inside the `legacyActed`
  branch, so under the shipped enforce default the lens is merged and genuinely delivered while
  **zero rows are written**. Lens exposure currently reads 0 in any analysis.
- **Do NOT defer** loop-breaker's T3 abort/shutdown latches. `abortArmed` is a safety wall consumed
  by the synchronous `tool_call` handler, independent of the arbiter, and a `safe_abort` at priority
  700 with terminal rank essentially always wins anyway.

**Batch 3 (measurement identity) is smaller than it looks.** `config.sha256` already exists — the
gate computes it at `real_gate.sh:1033`, validates it, and consumes it in `failure_episode_trial.py`.
It simply never crosses into the child env. And Pi itself sets none of `PI_RUN_ID` / `PI_MODEL_ID` /
`PI_MODEL_PROVIDER` (verified against the installed package), so those names are free to define.
Two constraints found: children **cannot** sign telemetry as things stand — the HMAC key arrives on
fd 3 and `runner.ts` spawns with exactly three pipes, so the fd does not exist in the child — and the
exposure error is **asymmetric**: a lost child row reads `"unexposed"` in telemetry mode but
`"targeted"` in suppression mode, i.e. a false confirmation that suppression worked.

**Batches 4-5** (one vocabulary / one constant; flag and doc truth) are unstarted and independent of
the above.

## 2026-08-26 four-scale deep review — what shipped, and what did NOT

Solar (whole system) / planetary (30 extensions) / atomic (functions) / quark (bytes), plus a
model's-eye and a measurement pass. Seventeen findings fixed and counterfactually proven.
**Rolled out 2026-08-26**: source `55302ace…`, loaded `9c1bc17c…`, mirror 116/116, 35B smoke clean
(exit 0, zero stderr, 64 rows on one `si`, zero error rows). See the 2026-08-26 row in
`docs/SURFACE_BOUNDARIES.md` — it is a **HASH EPOCH CHANGE**, so nothing pools across it.

The seventeenth was found *during* the rollout, by checking the live hash instead of trusting it:
widening the hash to cover `AGENTS.md` made macOS match both `AGENTS.md` and `AGENTS.MD` for the
same file and hash its bytes twice, while Linux would match one — the same tree, two digests by
platform, in the very artifact that exists to prevent cross-machine divergence. Both hashers now
mirror `loadContextFileFromDir`: first match wins per group. Interim source `92afd0fe…` was never
mirrored. **Verify the receipt, not the change.**

The load-bearing deliverable is `harness/tests/manifest-boot.test.ts`: the first test that boots the
whole declared manifest in order and asserts the end state, including after a `/reload`. Every
interaction defect this harness has shipped was an unverified assumption about a neighbour, and the
suite could not see any of them because it instantiates one extension per FakePi. Add to that file
before adding a targeted one. Its sibling `plan-surface-handoff.test.ts` exists because
`plan-runner.integration.test.ts` sets `PLAN_STORAGE=project` at module scope — the entire planner
suite runs in the ROLLBACK configuration, never the shipped default.

**Deliberately deferred, with evidence. Not dropped.** These are additions to the list below, and
the same rule applies: fix before relying on the affected mechanism in a measurement.

- **Gate subagent telemetry lands in the live interactive corpus.** `optimizer/real_gate.sh:660`
  never sets `TELEMETRY_FILE`, so a delegating gate's child sessions fall back to
  `~/.pi/agent/telemetry/events.jsonl` tagged `source: "gate"` — child rows never reach fd 8 *and*
  they contaminate the archive. `run-tests.mjs:41-51` has a leak detector for this exact class, for
  `test` but not `gate`. **Decide the direction before fixing**: `context_telemetry.py:33` treats an
  unsigned row as fatal, so simply propagating the file converts a silent drop into a hard
  extraction failure. Related: `context_telemetry` joins on `sk` (a cwd basename a subagent
  inherits) while `shadow_report` correctly uses `si`/`sp`.
- **`PI_RUN_ID`, `PI_MODEL_ID`, `PI_MODEL_PROVIDER`, `HARNESS_CONFIG_SHA256` are set by nothing.**
  So `model`/`provider` are null on every telemetry row, `run_id` degrades to the cwd basename, and
  `config_sha256` — the one field that would bind the flag posture the surface hash deliberately
  excludes — is null 100% of the time. The gate uses different names (`real_gate.sh:40-41`). This is
  gate-side wiring, which is why it stayed out of a model-visible batch.
- **Bus subscriptions leak on every `/reload`.** Eight extensions subscribe to
  `HARNESS_SIGNAL_CHANNEL`; none keeps the unsubscribe, and the bus is constructed once
  (`resource-loader.js:120`) and reused. One reload passes Node's 10-listener warning cap and
  double-delivers every signal to a live closure and a dead one.
- **Arbiter losers have already spent their one-shot latch.** Only `tool-call-rescue` defers its
  budget until the decision arrives; loop-breaker's tier/outcome/session latches, verify-gate's
  `fires`/`nagAwaitingEvidence`, and ketch's wrap latch all charge at proposal. Generalises the
  known B6, and note the merge rescue in `control-arbiter.ts:53-57` covers `verification_required`
  but not `verification_plateau` from the same file.
- **`agent_settled` one-shots never re-arm.** `verify-gate.ts` (`frontierSettled`) and
  `working-memory.ts` (`settled`) reset only at `session_start`, so only the first agent run per
  session is measured. `run-kernel.ts:382` is the correct in-repo pattern.
- **Inert rollbacks.** `MUNCHKIN_TOOL_ACTIVATION=ambient` is unreachable under the `core` default
  (`tool-activation.ts` returns before the branch) yet silently flips the system prompt through
  `active-tool-prompts.ts:10`; `phase` is entirely unimplemented and its surface
  (`PHASE_CAPABILITY_TOOLS`, `phaseDeferredTools`) has no caller. `PLAN_GATE_DIAGNOSTICS=legacy` is
  advertised as a rollback in the boundary ledger and read by no code.
- **hashline writes user source files non-atomically** (`writeFile` in a loop, no tmp+rename, no
  fsync) while the harness gives its own state both. Also: one stray CRLF rewrites every line
  ending in the file, and a filename containing `#` is readable but permanently un-editable.
- **ketch budget TOCTOU** (read-modify-write across an `await` on the plan-context read) and the
  `noteCount` race; the consecutive-refusal cutoff is off by one and reports a cumulative counter.
- **`package-smoke`'s 70% reduction gate re-declares `CORE_NAMES` as a literal** and omits
  `plan_write`/`plan_update` — the two largest schemas — so the reduction figure overstates.
- **Unbounded session growth**: `blackboard.state.attempts` (the restore path caps at 200; the live
  path does not), the `span-tools` file cache (`hashline.ts` does LRU for the same problem), and
  loop-breaker's session-cumulative maps.
- **`TELEMETRY_MAX_BYTES` is parsed two incompatible ways** — `"5MB"` rotates at 5 bytes in the sync
  writer and 1024 in the async one. `ketch.ts:48-55` already solves this and documents the footgun.
- **Async telemetry has no process-exit path** — no `SIGINT`/`SIGTERM`/`beforeExit` handler anywhere,
  and loop-breaker's `abort` row is the last thing queued before `ctx.abort()`.
- **Doc drift**: `HANDOVER.md:75` still states loaded `acd18a54…`, six rollouts stale, with no
  supersession banner in a document that banners its other stale section; `/runtime-status` is
  documented and does not exist (the behaviour belongs to `/munchkin-doctor`); README lists
  "observational memory" as a shipped extension and none exists; a dozen model-visible flags
  (`LB_*` thresholds, `LB_HARD_STOP`, `MUNCHKIN_TOOL_SURFACE`, `CTX_GUARD_RISKY*`,
  `VERIFY_GATE_MAX_FIRES`, `TELEMETRY_STRICT`) are absent from README's defaults table.
- **Query-string redaction makes distinct sources verification-equivalent** — `?title=A` and
  `?title=B` collapse to one display URL, so parent-verifying one satisfies `plan_settle` for both.
- **`VERIFY_GATE_MAX_FIRES=0` cannot disable the gate** (`"0"` parses to 0, fails `> 0`, falls back
  to the default 3), and `TELEMETRY_STRICT=1` throws out of `record()` against the module's stated
  fail-open contract, propagating into subagents.

## 2026-08-25 planner-limit raise + regression sweep — deferred follow-ups

The note-limit raise (300→900) and audit fixes A1–A6/B1/B3–B5 are merged and rolled out (see
the 2026-08-25 rows in `docs/SURFACE_BOUNDARIES.md`). The audit's REMAINING findings are
deferred deliberately, not dropped: **B6** verify-gate charges `fires`/`nagAwaitingEvidence` at
proposal time, so an arbiter-losing nag is counted as delivered (tool-call-rescue's
charge-on-decision pattern is the fix); **C1/C1b** drift-scanner sends a follow-up at
`agent_settled` (always triggers a turn when idle) and has no `session_start` reset, so a stale
review can deliver into the next session; **C2** `LB_SESSION_REPEAT` can fire once on a
text-only wrap-up turn; **C3** tool-call-rescue matches tool-call syntax quoted in prose;
**D** the closed CORE_NAMES/familyTools rosters give MCP or new builtin tools no activation
route and `capability(status)` cannot report the deferred list; the `FORCE_PLAN_WRITE=on`
rollback is inert under the core profile; dark-path branch-merge failures are swallowed without
telemetry. Fix these before relying on the affected mechanisms in measurements.

## 2026-08-24 shotgun recovery adoption

> **STALE OPERATIONAL NUMBERS — superseded six times since.** The loaded hash below
> (`acd18a54…`) was authoritative on 2026-08-24 only; the chain since is `12e1896b…` →
> `a9461aee…` → `3cbb10ed…` → `39fb2c3f…` → `73d491c2…` → `f01af261…` (current live), with
> `92afd0fe…` prepared and not yet rolled out. Mirror is 116/116, not 112/112. Bind measurements
> to the last row of `docs/SURFACE_BOUNDARIES.md`, never to a hash quoted in prose here. The
> posture and rationale in this section still hold; only the numbers are stale.


Branch `codex/shotgun-recovery` replaces the AlbertWork failure path without changing the live
harness. It adds call-bound pre-execution prevention evidence and argument-free `verify_project`,
replaces the dependency/gate-heavy planner with a 24-item stable-ID plan plus small deltas, prepares
the dark `MUNCHKIN_TOOL_PROFILE=core` surface and its one `capability` switch, and removes `/reflect`
while retaining observational memory and run capsules. The exact/outcome loop protections and
semantic shadow posture are unchanged.

The approved defaults are `MUNCHKIN_TOOL_PROFILE=core` and
`FORCE_PLAN_WRITE_DEFAULT=off`. Independent rollbacks remain `MUNCHKIN_TOOL_PROFILE=ambient` and
`FORCE_PLAN_WRITE=on`. Commits `dbf90f4` and `41ab87b` are merged and pushed on `main`. The live
mirror matches all 112 first-party artifacts, Pi 0.84.2 completed a non-inference load smoke, and
the authoritative loaded hash is `acd18a54415b58bf66e1fb2722a2ac8cd3b9d985a1ac61cf56c93c09dbf39d0b`.
No calibration, gate round, or efficacy claim follows from this rollout.
Counterfactual test names and non-secret outcomes are recorded in
`docs/SHOTGUN_RECOVERY_QA_2026-08.md`. The final working diff passes `npm run verify` (550 tests,
typecheck, health, 151-file deterministic package smoke with 30 extensions and two skills,
optimizer integrity/jails, and secret scan), peer-boundary checks, and isolated packed consumers
for Pi 0.80–0.84. The approved live rollout preserved local settings, model configuration, and
browser artifacts; pruned six obsolete managed orphan/staging files; and reports no unmanaged
loadable extension or duplicate tool.

## 2026-08-24 deep-inspection close-out

> **SUPERSEDED same day by the shotgun recovery adoption above**, whose rollout replaced this
> section's operational numbers: mirror 118/118 → **112/112** (six managed orphans pruned),
> loaded surface `e68f1543…` → **`acd18a54…`**, 648 tests / 31 extensions → **550 tests /
> 30 extensions** (the planner/reflect retirement removed suites with their code). The F-01/F-02
> fixes and posture described here remain in force; only the "current snapshot" claim is stale.

This section was the operational snapshot when written, superseding earlier “prepared”, “dark”,
or “pending mirror” wording below when it describes the same surface. The inspected baseline was
clean `main`/`origin/main` at `baa72ea`. The release fixes are now implemented: the measured-inert
`provider-patience` extension and all active configuration/telemetry/package references are
retired; normal unbounded `read` intake is reduced from 64 KiB to 32 KiB; files above the normal
or 8 KiB risky threshold require pages of at most 200 lines or the existing span/search tools.
Both defects have observed counterfactual failures recorded in
`docs/QA_WORKING_MEMORY_PLATEAU_2026-08.md`.

`npm run verify` is green: 648 tests, typecheck, health, deterministic package smoke (156 packed
files; 31 extension entry points; 2 skills), optimizer integrity/self-tests, and the non-echoing
secret scan. The fix commit is `8c1878f` on pushed `main`. The live mirror contains 118/118
first-party artifacts with no unmanaged extensions or orphans; the one retired
`provider-patience` orphan was pruned. The authoritative loaded live surface is
`e68f1543383ddc64e238142d687c40d8e2d321976078a07eaa0a8d0dc794a23a`. Pi 0.84.2 loaded the
ordered live extension surface successfully in a non-inference `--help` smoke.

The adopted model-visible posture is `ACTIVE_TOOL_PROMPTS=derived`, `CONTROL_ARBITER=enforce`,
`MUNCHKIN_TOOL_ACTIVATION=dynamic`, `CONTEXT_SURFACE_MODE=summary`, `STATE_LENS=steer`,
`VERIFICATION_PLATEAU=enforce`, and `RUN_CAPSULE=recovery`. `LOOP_EPISODE_MODE=shadow`,
`WORKING_MEMORY=off`, and `RESEARCH_LEDGER=off` remain unchanged. `httpIdleTimeoutMs=1800000`
is the live Pi setting that removes the observed 300-second provider wall; there is no longer a
parallel runtime shim. No calibration, powered trial, or gate round was started.

The dense-text overflow is addressed at both measured seams: bounded read intake in source, and
an 8,192-token registry-to-server headroom for both live Ornith models (`contextWindow=57344`
against served `n_ctx=65536`). A timestamped pre-change `models.json` backup remains beside the
live registry. No model inference, calibration, or gate round was started. If the optimizer is ever
deliberately restarted, widen the judge corpus before labeling because `calib4b` cannot vary the
relevant dimensions. Historical optimizer data remains preserved and unsupported; no old neutral
is a rejection. Browser automation is already supplied
by the live `browser-goblin` package (backed by `agent-browser`); neither `pi-agent-browser` nor
`pi-agent-browser-native` is installed or part of the first-party surface.

The next agent must read this file, `optimizer/docs/MEASUREMENT_METHODOLOGY_2026-07.md`,
`docs/SURFACE_BOUNDARIES.md`, and `docs/HARNESS_CALL_GRAPH.md`; verify the current hash and mirror
before touching runtime code; never modify `context-pressure*`; never echo credentials or raw
diagnostics; and stop for explicit approval before any default flip, deletion, live mirror, or
measurement round.

## 2026-08-17 prepared working-memory and plateau series

> Historical snapshot. The 2026-08-24 adoption and inspection sections above are authoritative
> for current defaults and rollout state.

The frozen measurement generation remains the first dependency: judge labeling, Phase 6 smoke,
and any gate execution are still human-owned and have not been started by this series. The
exact-gate frontier and call-variant terminology repairs are pushed on sequential `codex/`
branches. A private structured notebook is prepared dark behind `WORKING_MEMORY=on`; off means
zero tool or prompt exposure. Strict plateau tracking is prepared at the default shadow posture;
`VERIFICATION_PLATEAU=enforce` remains dark and never aborts. Mirror-mini fixtures remain later
stacked work. Nothing in this series has been merged, mirrored live, adopted, or measured.

## 2026-08-21 grader-integrity round three (source branch; live mirror PENDING)

> **Both scoring paths were forgeable; both are closed, and the pattern is the finding.**
> Three inspection rounds have now shown the same shape: *every layer added to protect the
> graded score was defeated by attacking the layer below it.*
>
> - **C-1 — the session read its own answer key.** The 2026-08-20 jail read-denied the pin to
>   the graded RE-RUN, but the pin was still written to `<workdir>.row-context.json`, a sibling
>   of the model's own workdir, and `gate.sb` is `(allow default)`. Measured on the real
>   `parens` fixture with the real jail and seal: honest 0/3 became a sealed, unblocked
>   **3/3**, `blocked=None`. Reps share `$RUNS`, so rep 1's file was readable by rep 2;
>   `requirement_scoring` leaked the same names for v3. **Fixed by deleting the secret, not
>   fencing it**: `eval_fixture.grading_secrets` derives the four grading fields in the
>   row-builder process from the admission-hashed manifest under the read-denied `__HARNESS__`.
>   Nothing writes them to disk. Second layer added: `grade_provenance_reporter.mjs` runs in
>   the `node --test` runner PARENT and records each graded test's CALL SITE, so re-registering
>   the admitted names from `src/` is refused (`foreign_registration`) even if a pin leaks
>   another way. Honest limit: a `vm.runInThisContext` filename spoof that also lands in the
>   grader's line range is not detected.
> - **C-2 — the binary bit was never jailed.** Everything above protected `subscores`. `score`
>   — what `fleet_report.decide()` adopts on — came from an un-jailed, un-preloaded
>   `node --test`, so the four-line `node:assert` neuter still forged it: measured on `parens`,
>   honest 3/6 became a gate-passing **6/6**. All scoring runs now share one jail (new
>   `real-gate-fixtures/binary.sb`), the assertion preload, `env -i` with `NODE_OPTIONS` and
>   every telemetry/credential variable scrubbed, and fds 8/4/3/5 closed — the subshell had
>   been inheriting the unlinked read-write telemetry file into a process running model code.
>   Fail-closed on the `SANDBOX=off` precedent: never "unjailed but authoritative".
> - **Analysis chain.** `trial_validity.row_key` collided across model/split/variant, which
>   made `run()` raise, which left NO sidecar, which made every reporter call the round
>   "unevaluated" — silently, because `real_gate.sh` did not check the exit code. `find_workdir`
>   voided exactly the canonical rows whenever a perturbation ran. A resolved-but-empty workdir
>   left tamper screening off while the row still counted. `rft_harvest` could turn a
>   `reward_hacking` FAIL into a fine-tuning exemplar. `fleet_verdict` and `munchkin` read rows
>   raw; both now screen. Verdicts are bound to the row bytes they were computed from.
>   `effort_report.graded_rate` — the capability outcome — lacked the bounds guard its two
>   siblings have. `calibrate.py`'s 20-85% band was a third, unpreregistered admission rule; it
>   is retired to descriptive output in favour of `admission_rule.py`.
> - **Harness.** A model-controlled RELATIVE path forged a second `[harness summary]` block in
>   the model-visible state lens claiming the gate was green (reproduced). The verification
>   frontier only recognized the `tap` reporter's `#` marker, so it — and the entire plateau
>   feature above it — was inert against the default `node --test` that agents actually run.
>   `VERIFICATION_PLATEAU=enforce` reported `injected_chars` for corrections the arbiter had
>   dropped. `tool-call-rescue` spent its session budget on messages the arbiter never
>   delivered. Working-memory private-path redaction was defeated by any adjacent punctuation
>   (7 of 8 shapes leaked). `bash-output-guard` loaded AFTER loop-breaker, so loop-breaker
>   classified the original oversized blob while the model received the withheld error.
> - **Guards.** The secret-scan stage printed "clean" in CI having inspected ZERO lines (a
>   shallow checkout resolves no baseline); it now fails closed and CI checks out with
>   `fetch-depth: 0`. `GATE_MIRROR_DENY` defaulted to `$REPO_ROOT`, making the `__MIRROR__`
>   deny — which closed an OBSERVED escape (r6-c21) — a verbatim duplicate of `__HARNESS__`;
>   it is now derived from the git common dir. `verify-optimizer.sh`'s completeness guard
>   required `--selftest` in the file text, so a selftest invoked from `__main__` was invisible
>   to the very guard written to catch "exists but never runs".
> - **My own two regressions from the previous round, fixed first.** The L3 change made
>   `is_hidden()` match t1-t6, which made `install_tests()` unreachable and silently changed
>   what t3/t5/t6 show the model; and `HANDOVER.md` carried a false claim about
>   `qs-error-swallow` / `path-near-miss` (both ARE approved and authoritative — corrected in
>   place above).
>
> Every behavioural fix carries a both-polarity test proven by reverting the fix.
> `npm run verify`: all 6 stages green. 24/24 approved fixtures authoritative with zero
> artifact drift; no manifest, approval, or expiry clock was touched. Control groups: calib4b
> 12 rows, 12 distinct row keys, 473 tool calls, ZERO reward_hacking false positives;
> calibling3 12 rows, 12 distinct row keys, zero voided (its transcripts are not retained in
> either checkout, so the transcript detector could not be re-run against it — stated, not
> assumed). No gate round was run; the evidence base is still empty by design.
>
> **MIRRORED LIVE 2026-08-21** (human decision: "apply, but skip the smoke"). `mirror:apply`
> wrote 117 artifacts with zero drift; `mirror:check` 117/117, no unmanaged extensions or
> orphans; loaded hash `e7190767…` supersedes `9b8eaaad…`. **Live-load smoke CONFIRMED** (skipped
> at first, then run on request): pi 0.84.2, `pi -p --model local-llamacpp/qwen36-35b-iq3s
> < /dev/null` from a scratch cwd — exit 0, zero stderr, 24 telemetry rows, ONE `si`, every row
> carrying `e7190767…` including the `surface-receipt` row, zero error rows. Serving probe
> `served_n_ctx=65536, registry_ctx=61440, verdict=ok`. `run-capsule` checkpointed, which only
> happens under a correctly ordered manifest — evidence the `bash-output-guard` move is sound.
> **Future gate rounds bind `3d361874…`** — the CMD_POS comment recovery (`ddd712b`) is a
> source-comment-only delta but the surface hash covers contents, so it was re-mirrored the
> same day and re-smoked (exit 0, zero stderr, one `si`, surface-receipt confirms). It
> supersedes `e7190767…`; no model-visible behaviour changed between them.
>
> **2026-08-24 (later): THE 300s WALL WAS PI'S OWN SETTING; provider-patience measured INERT in
> pi sessions.** A live AlbertWork run on the final surface (`5427eea5`, patience applied:true)
> still died headerless at exactly 300.5s. Root cause: pi's `configureHttpDispatcher` sets
> `headersTimeout`/`bodyTimeout` = `httpIdleTimeoutMs` (default 300,000ms) on its OWN dispatcher
> and installs npm-undici's fetch — the extension's node-registry swap never reaches pi's request
> path. FIXED with pi's supported knob: `httpIdleTimeoutMs: 1800000` in the live settings.json
> (backup `settings.json.bak-20260824-idle`; verified with a live 4B session). PENDING DECISION:
> retire provider-patience (inert in every pi context; harmless; removal is a surface change).
> The same run surfaced an OPEN finding — a context-overflow loop: request 65,597 tokens vs
> ornith's 65,536 serving window (registry ctx 61,440), reactive compaction, then ONE turn
> re-read ~90KB (two large `read`s: 40KB dashboard + 50KB wiki index, under every current read
> cap), landing at 69,501 → 400 again. pi's client-side token accounting undercounts dense text
> (CSV/markdown) vs the server tokenizer, so compaction fires too late. Mitigation options (all
> model-visible, Albert-gated): lower ornith's registry ctx for headroom, raise serving ctx, or
> tighten read caps. Recorded, not changed.
>
> **AVO ADOPTION BATCH 2026-08-24 (Albert-approved).** The Aug 20-22 pi session is archived at
> `~/Desktop/pi-session-2026-08-20_harness-improvements/` (complete log, raw transcript, both
> design artifacts, ANALYSIS.md). Its artifacts were verified claim-by-claim; dispositions:
> ADOPTED — plateau supervisor (`VERIFICATION_PLATEAU` default now enforce), resume-from-state
> (`RUN_CAPSULE` default now recovery), compaction->resume contract (documented, was already
> built), subagent 600s->1800s. REJECTED with verified reasons — memory-store merge (merges three
> trust domains three inspection rounds separated), recovery fold (collapses per-mechanism kill
> switches), `WORKING_MEMORY=on` (adds a tool where the measured failure mode IS tool operation).
> VOID — symbolect removal (zero refs in harness/, retired 2026-07-12), double-steer fix (arbiter
> one-winner-per-boundary already does it). Ops: `loaded_alias()` and the warm-up 404 fixed in
> `real_gate.sh` (mothball trap list updated); `~/LLM/llama-swap.yaml` big-model `ttl` raised
> 1800->7200 (backup `llama-swap.yaml.bak-20260824`, router restarted clean). Rollbacks:
> `VERIFICATION_PLATEAU=shadow`, `RUN_CAPSULE=shadow`, `PI_SUBAGENT_TIMEOUT_MS`, the yaml backup.
>
> **OPTIMIZER MOTHBALLED AGAIN 2026-08-21 — see
> [`optimizer/docs/MOTHBALLED_2026-08-21.md`](optimizer/docs/MOTHBALLED_2026-08-21.md).** The
> instrument work is DONE and validated: the Phase-6 n=1 smoke passed every pre-declared
> criterion, including `validate_powered_row(require_complete=True)` — the settlement-authority
> tightening that had never been exercised — and confirmed C-1, the `binary.sb` write-fence and
> the `gate.sb` read-deny on a live run rather than a selftest. The programme stops for the
> OPPOSITE reason to 2026-08-03: the instrument works, and the subject cannot drive the harness.
> Measured on `ling3-tiny-experimental`: `audit-sweep` 0/8 with 57/82 tool calls failing; a
> 7-fixture round stopped after 2 rows showing 1/4 at 199 turns and ~95% tool-call failure. Box
> time buys no information at that error rate. No further rounds, candidate trials, or box time
> until the restart conditions in the mothball doc are met. Everything below is preserved and
> green.
>
> **OPEN ITEMS CLOSED OUT 2026-08-21.**
>
> - **The two unpinned fixtures were a CODE DEFECT, not a fixture decision** (`63bb765`).
>   `build_fixture_catalog.gold_case_names` built the gold state by re-running the in-code
>   `mutate()` generator, while `fixture_admission.run_state` applies the committed
>   `patches.gold` artifact — two sources of truth that had drifted, with every exception
>   swallowed into `None`. For `path-near-miss` the generator no longer creates
>   `src/index.js` at all (FileNotFoundError); for `qs-error-swallow` it yields a gold that
>   fails its own fail-to-pass suite 0/2. That is also the origin of the retracted claim
>   "its gold does not satisfy its own hidden suite" — true of the GENERATOR's gold, false
>   of the fixture: `fixture_admission.py verify` reports PASS for both. Derivation now
>   applies the patch and prints the cause instead of hiding it. Verified across all 41
>   fixtures: **36 existing pins derive byte-identical, 0 changed**; `path-near-miss` (3
>   cases) and `qs-error-swallow` (2) now derive; 3 stay correctly unpinned because their
>   graders are not `node --test` suites. **Remaining human step:** writing the two pins
>   into their approved manifests changes admission-hashed content, so it needs approval —
>   but it is one command now, not an open question. [DONE same day, `adc72c7`: both pins
>   written surgically and re-approved with `--expires-at` preserving the original review
>   clocks (2026-10-21 / 2026-10-23); 24/24 authoritative, 38 case-pinned. Not an open item.]
> - **Judge labeling: skeleton committed** at `optimizer/prompt-lab/judge_labels_calib4b.json`
>   — 12 sessions x 4 dimensions, anchors and the declared thresholds inline, 48 nulls.
>   The scores must be ALBERT's: a label written by anyone else calibrates the judge against
>   the wrong ground truth, which is the one thing the calibration gate exists to prevent.
>   Then `./agentic_judge.py --calibrate judge_labels_calib4b.json`.
> - **`WORKING_MEMORY_MAX_RECORDS = 32` — recommendation: leave the 8 KiB cap.** It is
>   unreachable at full note size (the file cap refuses at ~10-16), but the constant is now
>   documented as an upper bound and pinned by a test, `WORKING_MEMORY=off` by default, and
>   both limits raise the same `capacity` error so nothing is silently lost. A 4x increase in
>   a persisted private artifact's budget buys a nominal number, not a capability anyone has
>   asked for. Revisit if a real session ever hits it.
> - **Branches retired.** 40 local -> 3 (`main` plus the two held by worktrees). Only
>   `fix/manifest-approval-pin` carried anything not in `main`: the CMD_POS false-negative
>   rationale, which did not travel when CMD_POS moved into `harness/lib/command-policy.ts`,
>   leaving the surviving test pointing at a comment that did not exist. Recovered in
>   `ddd712b`; the branch is tagged `retired/fix-manifest-approval-pin` so it stays
>   recoverable. The 28 remote branches are all fully merged; they were left in place because
>   deleting them is a public-content change and they record which session did what.

## 2026-08-20 measurement-integrity follow-up (source branch, live mirror intentionally unchanged)

> **F2/F3 + test-hermeticity fixes prepared for merge/push.** `9aeea4e` makes the
> `surface-receipt` no-env test own `HARNESS_SURFACE_SHA256`, so `npm run verify`
> remains hermetic inside a live stamped session; the unfixed test failed with the
> inherited hash and the fixed suite passes with it set. `8938bad` separately
> sandboxes the graded hidden-suite re-run: the case pin is read-denied, evidence is
> hidden in a private `<workdir>.grade-evidence/` directory behind a gate-opened fd,
> detached children inherit the write fence, and grading refuses when the jail is
> unavailable. `6b99a21` seals the TAP immediately after production and verifies the
> bytes in the separate row-builder process (`seal_missing`/`seal_mismatch` refuse).
> `grade_jail_selftest.py` covers the golden path, F2 pin theft, F3 detached rewrite,
> workdir mutation, renderer failure, and post-production tampering; removing the
> jail fails the F3 assertion. `trial_validity` bundles the new evidence directory.
>
> The plan-gate `VG_STEER_NO_GATE` seen while operating from `~` is expected: gate
> arming is cwd-scoped, and no project gate exists in the home directory. The repo
> gate was run from its worktree (`npm run verify`, all six stages green). No live
> mirror, default change, adoption, gate/calibration round, or model-inference run
> is implied; the deferred source/live surface boundary remains the human rollout
> decision, and `context-pressure*` files were untouched.

## 2026-08 hardening series

> **2026-08-18 SECOND DEEP-INSPECTION ROUND — on `main` (`f4af650`), NOT yet mirrored.**
> Five adversarial reviewers over: my own first-round fixes, the F-01..F-12 hardening's
> completeness, the model-visible harness, the measurement statistics (cross-checked against
> scipy), and whole-repo provenance/secrets. Core verdict: the statistics are correct, the
> HMAC/serving-fingerprint provenance is forgery-resistant, the enforce-arbiter /
> failure-episode / session-identity logic is sound, F-06/F-09/F-12 are complete, and all 412
> commits + 2626 blobs are secret-clean. Sixteen findings fixed:
> - **The graded-score forgery is properly closed.** [CORRECTED 2026-08-21: it was not.
>   The pin below was WRITTEN to `<workdir>.row-context.json`, a sibling of the model's own
>   workdir that `gate.sb` let the SESSION read — measured on `parens`, honest 0/3 became a
>   sealed, unblocked 3/3. And the binary `score` came from an un-jailed, un-preloaded
>   `node --test`, so the assert-neuter still forged it 3/6 -> 6/6. Both are closed now, by
>   removing the pin from disk (`eval_fixture.grading_secrets`) and by jailing every scoring
>   run (`real-gate-fixtures/binary.sb`); see SECURITY_BOUNDARY.md. The pin itself is real and
>   the 36-fixture count below is correct.] My first-round collapse-shape guard only
>   caught an IMPORT-TIME `process.exit`; after a hidden suite yields (e.g. `await import`), a
>   mid-run exit truncates TAP to its passing prefix with a self-consistent plan, which scored
>   at face value. Now every reporter-graded fixture carries an **admitted case pin**
>   (`tests.fail_to_pass.expected_cases`, derived from a real gold TAP run, hashed into the
>   approved manifest); `grade_reporter` refuses any differing observed set — truncation,
>   rename, skip, or injected test. 36 fixtures pinned. This generalises the v3 `coverage_map`
>   contract to the whole corpus.
> - **`verification_plateau` enum drift** (latent until `VERIFICATION_PLATEAU=enforce` ships):
>   the reason was absent from `run-kernel-state`'s validator, so a plateau decision would have
>   silently stopped capsule persistence and voided the round. Fixed + a parity test proven by
>   counterfactual.
> - **The secret scanner is now a `verify` stage** (it was manual-only, in neither verify nor
>   CI, on a public repo). Plus tamper-detector gaps (`-t` destinations, header-driven `patch`),
>   `shadow_report` shares that could exceed 1.0, `effort_report` non-pooling, the
>   over-broad edit-header regex, F-05 `O_NONBLOCK`, F-04 rotated-file mode, F-03 private
>   mkdir, the admission bool guard, the v4 schema root, `.gitignore`, and doc drift.
>
> **Approval bookkeeping:** 24 approved before, 24 after — none lost, none gained, and every
> review clock PRESERVED (`approve --expires-at`) rather than reset by a mechanical
> re-approval. `qs-error-swallow` and `path-near-miss` were restored to HEAD rather than
> shipped changed — both need separate attention.
>
> **CORRECTION (2026-08-21).** The parenthetical this entry originally carried for those two
> fixtures — "`qs-error-swallow` (never approved; its gold does not satisfy its own hidden
> suite)" and "`path-near-miss` (regenerated shortcut breaks the visible suite)" — was false.
> Both manifests are `admission.approved: true` (reviewer Albert), `automated.passed: true`
> with `gold_fail_to_pass` and `gold_pass_to_pass` green and the shortcut mutant correctly
> failing fail-to-pass while passing pass-to-pass, `artifact_drift == []`, and
> `eval_fixture.py state` reports **authoritative** for both. What I actually observed was
> drift in patches I had regenerated locally, since reverted. The real, checkable defect is
> narrower: they are the only approved hidden-graded fixtures carrying neither
> `tests.fail_to_pass.expected_cases` nor a `grade_artifact` (`context-pressure`, the
> held-out, is the third), so the row builder records `subscores_blocked="unpinned_grader"`
> and they contribute a binary bit only, never a graded rate. Pinning them is a fixture
> decision, not a code fix.
>
> **PENDING:** the harness libs changed, so the model-visible surface moved to source
> `56993e93…`; the LIVE MIRROR + boundary row + live smoke are deferred (a `pi` was running on
> ttys006). Run `npm run mirror:apply && npm run mirror:check`, record the loaded hash in
> `docs/SURFACE_BOUNDARIES.md`, then smoke. `npm run verify`: all 6 stages green.


> **2026-08-15 MEASUREMENT REBOOT — MERGED to `main` (`5746195`), MIRRORED LIVE.** The
> optimizer is unmothballed: charter `optimizer/docs/UNMOTHBALL_2026-08.md`, ONE
> preregistered admission rule (`PREREG_FIXTURE_ADMISSION_2026-08.md` + `admission_rule.py`),
> graded-by-default TAP reporter grading (`grade_reporter.py`), per-trial validity rubric
> with voiding (`trial_validity.py`), judge activation tooling (`judge_render.py`,
> `--score-gen`, `JUDGE_LABELING_2026-08.md` — the 12 calib4b transcripts are a sufficient
> first labeling set), ling cohort repaired to behaviour-only + pi.fixture/v2, and sweep-a
> (capability) / sweep-b (episode-variance) / sweep-c (process-traps) multi-defect fixtures,
> all passing the admission battery.
>
> **DONE:** codex ling branch merged, whole reboot merged to main + pushed; **Phase 1
> coherence adoption APPLIED + mirrored live** (`ACTIVE_TOOL_PROMPTS=derived`,
> `CONTROL_ARBITER=enforce`; mirror:apply 110/110 zero drift, mirror:check 110/110, 35B
> live-load smoke clean, boundary row 2026-08-15 loaded hash `358c1f7c…`). A 2.75-day wedged
> bare `pi` on ttys004 (stdin-wedge orphan) was cleared before the mirror. **SUPERSEDED
> 2026-08-17 by the deep-hardening rollout — the live surface is now `2991c42b…` (see the
> 2026-08-17 row in `docs/SURFACE_BOUNDARIES.md`); future gate rounds bind `2991c42b…`, not
> `358c1f7c…`.**
>
> **GATES DONE 2026-08-15:** all seven cohort fixtures APPROVED (`reviewer albert`, expiry
> 2026-11-15, all `authoritative()==True`); charter + prereg accepted. **STILL PENDING (Albert):**
> label ≥10 judge transcripts (`JUDGE_LABELING_2026-08.md`; 12 calib4b transcripts ready to render). Then
> the first BOX round is Phase 6 — audit-sweep graded, base arm, local 4B, n≥9, preceded by
> one n=1 smoke row (the first end-to-end exercise of the v3 settlement-authority
> tightening). audit-sweep is deliberately NOT re-manifested — it grades the model's audit
> report via the retained pinned-artifact path, which the behaviour-graded reporter cannot
> express, and re-manifesting would clear its live approval. NO round has run; the evidence
> base is empty by design.


> **2026-08-14 CONFORMANCE-REPORT FOLLOW-UP — ROLLED OUT to `main` (`99e9235`) and mirrored live.**
> Four field-observed harness fixes from an independent pi dogfood session (report on Albert's
> Desktop; corrections addendum beside it — the report's date header, SHARING.md reading, "dormant
> candidate" framing, root `tests/` and secret severity were wrong). Five commits
> (`63d90cb..d620e16` + boundary `99e9235`), each `npm run verify`-green with counterfactually-proven
> both-polarity tests. Loaded live hash at rollout `a519d123…` (mirror:check 110/110 after pruning
> 3 retired orphans; 35B live-load smoke clean). See the `2026-08-14` row in
> `docs/SURFACE_BOUNDARIES.md`.
> - **verify-gate** (model-visible): arming scoped to cwd (out-of-cwd edits no longer arm); a
>   no-detected-gate session emits one honest `VG_STEER_NO_GATE` (PI_MSG-overridable, capped once)
>   instead of looping a false "exact gate" claim. Rollback: `git revert`. Gate fixtures unaffected.
> - **plan-mode classifier** (model-visible in plan mode): `awk` recon and `for`/`select` loops no
>   longer false-block; `awk -i inplace`/`system(` and mutating loop bodies still trip; `case` fail-closed.
> - **plan_write gate guidance** (model-visible): schema description matches the validator.
> - **pi-subagent**: `PI_SUBAGENT_MAX_SUMMARY_CHARS` (default 12000) tunes the cap; parallel header
>   counts `!isResultError` so it agrees with the per-child labels.
> - **mirror hygiene**: `findLiveMirrorOrphans` — `mirror:check` fails on in-package orphans a
>   retirement left behind; `mirror:apply --prune` deletes them (human-gated). The 3 that existed
>   (micro-gate.ts, payload-audit.ts, micro-gate-policy.ts) were pruned during rollout.
>
> **Same-day live-dir follow-up (Cerebras removal + root-tree reconciliation) — NOT a source change.**
> - **Cerebras REMOVED completely** (user: "not using it"). Provider + `csk-…` key deleted from the
>   live `models.json`; `cerebras` cache block deleted from `models-store.json`. Both now untracked +
>   gitignored (SHARING.md private); `artifacts/` (private ledgers) + `*.bak-*` also gitignored. The
>   key was **purged from all 197 commits of `~/.pi/agent`'s local snapshot repo** (`git filter-branch`
>   + reflog-expire + gc); verified 0 `csk-` across working tree, full history, dangling objects,
>   `auth.json`. The public repo was already clean (verified). No remote on the live repo — never push it.
> - **Root-tree reconciliation done.** Root `lib/` (16 diverged) + `vendor/` (6 diverged) refreshed to
>   source (root == package == source); kept genuinely root-only files (`chaos-policy.ts`,
>   `telemetry-event-catalog.json`); added nothing; restored no extensions to root (that would re-break
>   the load-order topology). Because `chaos.ts`'s loaded closure (`chaos.ts → lib/chaos-policy.ts` +
>   `lib/telemetry.ts → telemetry-catalog/agent-dir/telemetry-writer`) is in the surface hash and two of
>   those root copies were stale, refreshing them changed the **live loaded hash `a519d123…` → `c9176d81…`**
>   (35B live-load smoke re-confirmed clean, new hash emitted, no cerebras). This is a live-dir hygiene
>   change with NO source or model-visible delta — the shift is inert gauntlet-path telemetry brought in
>   sync. Future gate rounds must bind `c9176d81…`, not the `a519d123…` in the boundary row above it.
> - **Known fossil (left as-is):** the live root `tests/` are topology-INCOMPATIBLE (218/273 pass; 48
>   fail on root `extensions/*.ts` that moved into the package, plus stale test files expecting removed
>   APIs). The canonical suite is `harness/tests/` in this repo (592 passing). Retiring the live root
>   `tests/`/non-closure `lib/`/`vendor/` is a future human call, not done here.

> **2026-08-13 SPIRAL-CONTROL SERIES ROLLED OUT (PR 1–4; authored 2026-08-12) — model-visible default change, read first.**
> Approved by human decision and merged to `main` + mirrored live. This is NOT a shadow-safe
> rollout: deployed DEFAULTS changed, so no measurement pools across this boundary.
> - **Verification is stricter by default** (`VERIFY_EXECUTION_ORDER` now defaults to `execution`,
>   was `legacy`): a green verifier is refused after a *failed* or *in-flight* mutation, or when a
>   mutation call has no observed completion. `PLAN_GATE_DIAGNOSTICS=safe` (default) returns a
>   redacted ≤500-byte `UNTRUSTED_GATE_DIAGNOSTIC` instead of raw gate output. Rollbacks:
>   `VERIFY_EXECUTION_ORDER=legacy`, `PLAN_GATE_DIAGNOSTICS=legacy`.
> - **Loop steering changed**: failing-edit loops that were masked as "progress" now escalate;
>   at most one loop-breaker steer per turn (pure `loop-action` reducer); the 120s verify-gate
>   nag-suppression window is gone (deconflict moved to the typed control arbiter). Steer *texts*
>   are byte-identical; which/when/how-many changed. Gate command shown in steers is redacted.
> - **Retired from the live harness** (archived non-loadable under
>   `optimizer/archive/runtime-candidates/`): micro-gate/slop, payload-audit, the redundancy
>   nudge, the per-call state-lens `view|both` modes, and the mandatory subagent-only mutation
>   branch — plus their flags, telemetry, control vocabulary, and manifest entries. Manifest is
>   now 30 extensions + 2 skills. The `CONTROL_ARBITER` default stays `shadow`, so the lens+steer
>   one-voice dedup only applies under `enforce` (still your adoption gate); the losing-abort
>   drop is fixed regardless (terminal proposals outrank message proposals).
> - Loaded live hash and live-smoke result are in `docs/SURFACE_BOUNDARIES.md` (spiral-control
>   rows). Rollback for the whole series is `git revert` on `main` + re-mirror, or the per-flag
>   `legacy`/`off` switches above.

> **2026-08-12 LIVE TOPOLOGY ROLLED OUT — read before touching the live agent.**
> `~/.pi/agent/extensions/` no longer holds loose first-party files. Everything now lives in
> `extensions/pi-munchkin/` (extensions + lib + vendor) with a GENERATED `package.json` whose
> `pi.extensions` declares the load ORDER; `mirror:apply` writes it and `mirror:check` verifies
> it as part of the same plan. `chaos.ts` (local-only) and `pi-rtk-optimizer` are untouched at
> the root. Loaded hash `aa00172c…` (v2 descriptor: hashes loader order, project-local
> extensions, import closure, prompts/skills, pinned npm identity — **v1 hashes never pool with
> v2**). mirror:check 111/111; live smoke on the 35B exits 0 with zero stderr, one `si`, one
> surface hash, and run-capsule checkpoints that alphabetical order had been preventing.
>
> **One live-config change was required and is NOT in git:** `settings.json` listed
> `vendor/pi-subagent` as a configured package. Configured paths load AFTER
> `agentDir/extensions`, so that entry (a) double-registered against the ordered package —
> a hard `Tool "subagent" conflicts` load failure — and (b) had ALWAYS caused the vendored
> subagent to load after `tool-activation`, violating its documented complete-registry
> contract. The entry was removed; backup at `~/.pi/agent/settings.json.bak-20260812T124443Z`.
> If you ever revert to a flat mirror, restore that entry or the subagent tool disappears.
>
> Both new model-visible behaviors stay DARK: `ACTIVE_TOOL_PROMPTS` (ambient) and
> `CONTROL_ARBITER` (shadow). Adoption is the two-line diff in
> `docs/TRUTH_COHERENCE_ADOPTION_2026-08.md`, with a rollback table. Still your gates:
> that adoption, and any calibration or efficacy round.


> **2026-08-11 THIRD INSPECTION — SOURCE ONLY, NOT MIRRORED. Two decisions are yours.**
> Eight findings verified with runnable reproductions (plus one nobody reported). Fixed and
> pushed: plan-gate events were **silently dropped by the run-event validator**, so gate
> identity and order-independent verification were INERT in production while their
> reducer-level tests passed — a structural guard now parses the union from source and
> requires every member to be admitted and to accept a real payload, and the plan-gate path
> has an end-to-end test through the real dispatcher; empty arrays no longer destroy whole
> telemetry rows (12 rows already lost); blackboard restore fails closed; bash is classified
> by COMMAND for first-mutation (discard pre-fix rows — the one-shot latch means they were
> never written); the ledger writer fails closed to http(s); `context-surface` now loads after
> `run-capsule` so receipts measure what the provider actually receives; `/run-new` gives an
> explicit run boundary; and the execute prompt no longer names `subagent` when the tool is
> inactive.
>
> **DECISION 1 — `ACTIVE_TOOL_PROMPTS`.** At deployed defaults `MUNCHKIN_TOOL_ACTIVATION=dynamic`
> removes `subagent` and `compact_context` at session start, while the ambient prompt keeps
> telling the model to call both. For the commonest small-model session (one request, ≤1-item
> plan, context under 60%) the contradiction lasts the WHOLE session. The fix already exists
> and is dark: `ACTIVE_TOOL_PROMPTS=active` (built 2026-08-10, six days after the tool-surface
> default shipped — nothing tied them together). Structurally better than flipping it: have
> `active-tool-prompts.ts` enable whenever the activation mode is not `ambient`, so the two
> defaults cannot disagree under any env combination. Verified delta: ~797 ambient bytes leave
> the system prompt, per-tool guidance appears only when the tool is present. Needs its own
> boundary row; every A/B against the old prompt stops pooling.
> **Not reachable-adjacent:** `harness/vendor/pi-subagent/index.ts:432-470` injects a full
> "how to call the subagent tool" manual with JSON examples, gated only inside the
> `ACTIVE_TOOL_PROMPTS` branch — so at defaults it ships unconditionally for an absent tool.
> That is a stronger pull toward a pseudo-call than the four APPEND_SYSTEM lines.
>
> **DECISION 2 — one model-facing voice.** At defaults (`STATE_LENS=steer`,
> `CONTROL_ARBITER=shadow`) a single detected loop produces TWO user-level messages: the lens
> sends its own, then loop-breaker sends the steer. Worse than "two nearby messages": pi's
> default `steeringMode: one-at-a-time` drains one per turn, so turn N+1 receives the bare
> state block with NO instruction and the actual correction arrives a full turn later. The
> lens should supplement the winning correction (`${lens}\n\n${steer}`) instead of being a
> second producer. Model-visible; needs a boundary row and ideally a before/after measurement.


> **2026-08-11 EVENING CLOSE-OUT (newest first).** Albert's nine findings are ALL fixed,
> committed (`fc2d4af..5e75469`), pushed, and mirrored (108/108, loaded hash in
> `docs/SURFACE_BOUNDARIES.md`): watchdog privacy (0700/0600 + report redaction), pi 0.84
> peer range, session-identity rework (episode exposure is **UNKNOWN**: the 29% read was a
> cwd-collapse artifact AND its 0% replacement was computed on an incoherent population —
> telemetry now emits a per-session `si` id, `shadow_report.py` binds one surface hash and
> refuses to number a mixed population; the "loop-intervention powerable" read stays
> retracted), non-vacuous judge calibration, `gate_sha256` identity on run-kernel verification,
> abandoned-episode terminal state, awaited adaptive rebind, `plan_go` off-surface during
> review, transactional `mirror:apply`. The serving-truth probe is live-verified on the 35B
> (`served 65536 / registry 61440 / ok`); smokes against the DEFAULT model prove nothing —
> pi's cloud path never fires `after_provider_response`, so always pass
> `--model local-llamacpp/...`. The day-long startup-wedge mystery is CLOSED: fd-0 stdin
> (non-TTY stdin that never EOFs; `pi -p` waits to append it to the prompt). Non-interactive
> callers: redirect `< /dev/null`. Albert's hold ("no calibration, dark mechanisms, or
> measurement-readiness claims until the five high findings are resolved") is satisfied;
> his gates remain fixture approval, then the preregistered n=6 calibration.
>
> **2026-08-12 attribution repair:** `session-bootstrap.ts` is now the first manifest
> extension and the sole owner of `si`, surface provenance, and the immutable initial tool
> registry. Lineage is transitive; conflicts and cycles are excluded; raw gate JSONL is
> explicitly UNKNOWN because its ephemeral HMAC key is gone. Every shadow summary made with
> split identity, one-hop lineage, or the pre-v2 ordered-layout hash is retracted. No efficacy
> or exposure estimate survives this boundary.
>
> **2026-08-11 PLAN-EXECUTION STATUS (read this first).** Phases 0-3 of the harness plan are
> built; phase 4 (candidate trials) is blocked only on human approval of the new fixtures.
> Done: the startup wedge is instrumented (`harness/scripts/pi-watchdog.sh` captures a Node
> diagnostic report — 55 instrumented loads, 0 wedges, downgraded to rare/non-blocking);
> the `plan_go` self-approval gap is closed; a 13-agent adversarial audit of the research
> pipeline and run-kernel produced 5 confirmed findings, all fixed with counterfactual tests,
> and refuted 7 more; `verify` is concurrent (~13s); `mirror:apply` exists; `mirror:check` sees
> unmanaged extensions; `optimizer/prompt-lab/agentic_judge.py` provides an anchored rubric with
> a calibration gate (a judge may not be cited until it agrees with Albert's labels);
> `optimizer/prompt-lab/shadow_report.py` answers the three shadow-evidence questions with
> declared thresholds. The FOUR band fixtures were APPROVED by Albert (chat, 2026-08-11,
> recorded in the manifests) and the preregistered n=6 calibration RAN the same evening:
> **verdict NOT READY** — `misleading-symptom` and `documented-escape` saturated 6/6,
> `ordered-steps` floored 0/6 (diagnosed genuine: all six end states pass visible/fail hidden,
> the first in-the-wild shortcut-mutant observation), `second-test-guard` model-specific
> (admitted for the 4B only, 0.33). Fewer than two in band → no candidate trial; next
> authoring targets sit between `second-test-guard` and `ordered-steps` difficulty, plus a
> ling3-tier instrument. Full results appended to
> `optimizer/docs/PREREG_FIXTURE_BAND_2026-08-11.md`; design record in
> `real-gate-fixtures/BAND_FIXTURES_2026-08-11.md`.
>
> **2026-08-11 SHADOW-SAFE BATCH ROLLOUT (supersedes the per-PR rollout-status notes below):**
> the full PR 2–7 series was mirrored live at `461b1e9` with every new mechanism at its
> conservative default (`RUN_KERNEL=shadow`, `LOOP_EPISODE_MODE=shadow`, `RUN_CAPSULE=shadow`
> with no model injection, `PLAN_MODE=forced`, `MUNCHKIN_TOOL_ACTIVATION=dynamic`,
> `CONTROL_ARBITER=shadow`). Five QA fixes followed the same day (`5392181..5722464`, mirrored):
> lens steers skip abort/shutdown proposals; subagents inherit the harness configuration env so
> explicit `=off` suppression survives into children; `skills/**/*.md` + `APPEND_SYSTEM.md`
> joined BOTH surface hashers (**hash epoch change** — hashes across 2026-08-11 do not pool);
> token-scoped `PROVIDER_TOKEN` suppression; secret scan covers the unpushed commit range.
> Loaded hashes and a first-load startup anomaly (1 of 8, unreproduced, kill switches verified)
> are recorded in `docs/SURFACE_BOUNDARIES.md`. Next per Albert's staged roadmap: shadow
> evidence from real sessions, then ONE candidate at a time (semantic loop intervention →
> capsule recovery → adaptive planning → phase activation), each n=6 calibration → prereg →
> powered A/B ≥40/arm → second-fixture replication before any default flip.

> **2026-08-10 run-kernel PR 1** (`286a48d`, merged and rolled out): a typed,
> behavior-neutral state reducer now consumes canonical execution receipts after all existing
> middleware. `RUN_KERNEL=shadow` is observational; `off` registers nothing. It adds no prompt,
> tool, command, steering, activation, blocking, persistence, or gate run. The
> lifecycle `idle` state is deliberately independent of semantic `complete`, and prompt text,
> commands, arguments, outputs, paths, URLs, and errors never enter RunState. See
> `docs/RUN_KERNEL_ARCHITECTURE_2026-08.md` and the counterfactual QA ledger before review.

> **2026-08-10 run-kernel PR 2** (`fb4b89a`, merged; not rolled out):
> execution-order verification, per-file hashline mutation queues, and active-only tool prompt
> truth are implemented behind explicit opt-in flags. Current live defaults remain unchanged
> pending the separate adoption checkpoint. See `docs/RUN_KERNEL_PR2_CORRECTNESS_2026-08.md`.

> **2026-08-10 run-kernel PR 3** (`0878777`, merged; not rolled out): one
> turn-end control arbiter, typed domain signals replacing telemetry taps, and a bounded optional
> async interactive telemetry writer. `CONTROL_ARBITER=shadow` and `TELEMETRY_WRITER=sync` retain
> deployed behavior pending separate adoption. See `docs/RUN_KERNEL_PR3_CONTROL_2026-08.md`.

> **2026-08-10 run-kernel PR 4** (`codex/run-kernel-pr4-capsule`, dark source work): private
> per-run structured checkpoints, a bounded untrusted Markdown projection, custom-entry/private
> restore, semantic settlement, and `/run-status`. `RUN_CAPSULE=shadow` persists audit state but
> never injects it into ordinary model context. No live mirror or recovery adoption has occurred.
> See `docs/RUN_KERNEL_PR4_CAPSULE_2026-08.md`.

> **2026-08-11 run-kernel PR 5** (`codex/run-kernel-pr5-recovery`, dark source work): a
> deterministic bounded recovery brief, post-compaction/provider-retry delivery, and explicit
> `/run-resume` compatibility path. `RUN_CAPSULE=recovery` is opt-in; shadow/off behavior remains
> unchanged and no automatic provider request is started by resume. See
> `docs/RUN_KERNEL_PR5_RECOVERY_2026-08.md`.

> **2026-08-11 run-kernel PR 6** (dark source work): phase-aware capability
> activation is available only through `MUNCHKIN_TOOL_ACTIVATION=phase`. It
> preserves explicit selections, defers optional plan/span/subagent/compact/
> post-search web-read tools, and activates them only from typed evidence
> signals. The deployed `dynamic` path and model-visible defaults are unchanged.
> See `docs/RUN_KERNEL_PR6_CAPABILITY_2026-08.md` and its QA ledger.

> **2026-08-11 run-kernel PR 7** (dark source work): `PLAN_MODE=adaptive`
> adds private run-capsule plan storage, stable-ID `plan_update` deltas, an
> explicit bounded `/plan-direct` path, and `/plan-export`. `forced` remains
> the deployed whole-plan behavior; no adaptive default, live mirror, or
> adoption occurred. See `docs/RUN_KERNEL_PR7_PLANNING_2026-08.md` and its QA
> ledger.

> **2026-08-05 settlement/episode series** (`0c44b09..5013e85`, merged to main and **ROLLED OUT
> 2026-08-05** on Albert's instruction): semantic failure-episode shadow instrument
> (`LOOP_EPISODE_MODE`, `/loop-status`, `/loop-resume`), `runtime-truth` provider timings +
> `/munchkin-doctor`, drift/blackboard on `agent_settled`. Deep-QA'd 2026-08-05 (ledger): clean;
> shadow-non-intervention counterfactually pinned. Loaded hash in `docs/SURFACE_BOUNDARIES.md`.

Four sequential, independently revertible branches implement the audit response:

1. `codex/01-gates-loop-correctness` — `36b3f80`
   - sole three-state verification classifier; exact project-gate enforcement;
   - ordered mutation/verification evidence and structured one-shot plan receipts;
   - execution-start/end repeat evidence, including rejected plan writes;
   - counterfactual regressions for the silent-disarm and ordering defects.
2. `codex/02-security-bounded-io` — `e3dfc0b`
   - private asynchronous cockpits and redacted blackboard v2 migration;
   - canonical fail-closed public URL/DNS checks and bounded subagent environment;
   - preflight hashline caps, bounded trace tails, and bounded asynchronous path suggestions.
3. `codex/03-dynamic-surface-performance` — `5c0d2bc`, adoption `cbbc8fa`
   - additive evidence-triggered tool activation, context summary/full/off modes;
   - event-driven state lens and abortable post-session drift review;
   - dynamic activation and `STATE_LENS=steer` defaults were explicitly approved before adoption.
4. `codex/04-package-operations-docs` — in progress in this handover
   - Pi 0.80.6–0.83 compatibility, offline package smoke, isolated networked CI matrix;
   - manifest-aware live mirror check and non-echoing diff secret scan;
   - public narrative correction and optimizer archive banner.

Each model-visible commit is a surface boundary. Never pool measurements across these commits or
across a live-mirror rollout. Record the loaded `HARNESS_SURFACE_SHA256` with every future row.

## Current adopted defaults

## 2026-08-26 model-neutral qualification package

The next step is recorded in
[`optimizer/docs/NEXT_STEP_MODEL_QUALIFICATION_2026-08.md`](optimizer/docs/NEXT_STEP_MODEL_QUALIFICATION_2026-08.md).
The harness contract is model-neutral: Ling is qualification-only, and
`local-llamacpp/qwen36-35b-iq3s` is the first real evaluation/adoption cohort.
The package binds per-session gate provenance, contains delegated child
telemetry so it cannot fall back into the interactive ledger, and keeps
`pi.tool-contract/v1` records out of fleet adoption. No inference, mirror,
planner/default flip, candidate, or rollout is implied; follow the note's
explicit human-started sequence.

2026-08-27: the explicit Ling and Qwen 35B `pi.tool-contract/v1` screens each
completed 10/10 cases with independent local persistence/verification oracles.
This qualifies the harness protocol only; the next gate is a fresh Qwen-35B
preregistration and bounded baseline/shadow screen. See the dated accepted-run
sections in the linked qualification note.

2026-08-27 follow-up: the preregistered Qwen base screen was stopped after four
non-authoritative rows exposed a live identity-shape/provider mismatch and an
unbounded ~1.1 MB response. Source-side canonical invocation transport and
identity precedence are fixed and tested, but the human-gated live mirror was
not changed because this checkout is not pushed. Do not pool or resume that
partial screen; push, deliberately mirror, record the new loaded surface hash,
and create a replacement short-duration preregistration first.

2026-08-27 follow-up (completed): the provenance-fix branch
`codex/qwen35b-provenance` was pushed and human-approved for live rollout.
`mirror:apply` wrote 120 first-party artifacts to `~/.pi/agent`, and
`mirror:check` reports 120/120 with no unmanaged extensions or orphans. The
loaded surface hash is `fe73b29328b0630817422401ea10633b34c33ba936c2cffd6a0b11bf89cf3322`.
The replacement preregistration is
`optimizer/docs/PREREG_QWEN35B_BASELINE_REPLACEMENT_2026-08-27.md`; its dry
preflight passed (`N=1`, base-only, `PI_TIMEOUT=240`) and no model inference
has been run on this surface. The prior partial result remains retracted.
Next human gate: explicitly run that three-row base provenance screen, then
inspect its safe provenance audit before any semantic candidate or planner /
deep-research graph screen. Context-budget risk remains separate.

Verification after the rollout is green: `npm test` 625/625, TypeScript
typecheck passed, `npm run verify:optimizer` passed (all optimizer self-tests,
15 Python tests, integrity/seatbelt/grade-jail checks, and gate dry-run), and
the live mirror remains 120/120 with loaded hash
`fe73b29328b0630817422401ea10633b34c33ba936c2cffd6a0b11bf89cf3322`.
The initial restricted-sandbox optimizer failure was isolated to the nested
macOS scoring jail (`sandbox_apply: Operation not permitted`) and passed when
rerun in the approved elevated test environment. Do not infer or start the
model run from these checks; use the replacement preregistration's explicit
command and record only its safe provenance aggregates.

- `ACTIVE_TOOL_PROMPTS=derived`: inactive tools contribute no ambient schemas, manuals, examples,
  snippets, or agent lists; `ambient` restores the legacy broad prompt surface.
- `CONTROL_ARBITER=enforce`: one highest-priority corrective message is delivered per boundary;
  `shadow` restores legacy producer delivery while retaining observational decisions.
- `MUNCHKIN_TOOL_ACTIVATION=dynamic`: defer `subagent` and `compact_context` only on a complete
  default Pi registry; preserve narrowed explicit `--tools` selections. Subagent activates on
  multi-item execution, second plan-gate failure, or loop tier two. Compact activates at 60%.
  `ambient` is the rollback.
- `MUNCHKIN_TOOL_SURFACE=default`: the DeepSeek-inspired `minimal` surface is source-only and
  opt-in; it keeps only `read`, `bash`, `edit`, and `write`, never overrides a narrowed explicit
  selection, and never auto-activates deferred tools. `/munchkin-doctor` also reports redacted
  protocol-parity facts; both features are observational/candidate surfaces and are not mirrored.
- `CONTEXT_SURFACE_MODE=summary`: no transcript hashing or duplicate analysis on the default path.
  `full` restores receipts; `off` disables. Gate sessions force full.
- `STATE_LENS=steer`: only loop-breaker events inject state, under cooldown. `off` is the kill
  switch; the per-call `view|both` modes are retired in the PR 4 draft.
- Teach hints and did-you-mean remain default-on, reversible, and mechanism-observed. No powered
  trial has established their benefit.
- 2026-08-07 (human-gated, judgment): nine more defaults — `FORCE_PLAN_WRITE` (with an in-code
  gemma-family skip and a block message naming `plan_write` → `plan_go`), `PLAN_UNCERTAINTY`,
  `PLAN_ITEM_GUIDANCE_V2`, `PLAN_TOOL_GO`, `SPAWN_DELEGATION`, `TOOL_CALL_RESCUE`,
  `CONTEXT_BRIEF`, `READ_DEDUP`, `SPAN_TOOLS`. Each `X=off` is the kill switch. None passed a
  powered trial; grounds and honesty box in `DARK_CANDIDATE_VERDICTS_2026-08-03.md`'s addendum.
  Gate rounds carry `plan_go,search_spans,read_span` in `GATE_BASE_TOOLS` (ADR-0001).
- Drift review starts only after the run settles (`agent_settled`), aborts on a new
  run/shutdown, and drops stale advice.
- Cockpits live under `${PI_CODING_AGENT_DIR}/artifacts/session-cockpits/`, never in a project.
- Text read/edit preflight defaults are 16 MiB (`HASHLINE_MAX_READ_BYTES`,
  `HASHLINE_MAX_EDIT_BYTES`); images above 4 MiB are refused before allocation.
- `PI_SUBAGENT_ENV_ALLOW` accepts validated extra environment names. The fixed list includes
  `LLAMA_API_KEY`; values are copied without logging.
- 2026-08-11: subagents also inherit the harness configuration keys (`HARNESS_CONFIG_KEYS` in
  `harness/vendor/pi-subagent/runner-env.js`), so a parent's explicit `=off` holds in children.
  Any new `process.env` read in harness code must be classified there — a coverage test fails
  otherwise. `CHAOS`, telemetry fds, and per-process run identity deliberately do not cross.
- 2026-08-11: both surface hashers include `skills/**/*.md` and `APPEND_SYSTEM.md`. Skill or
  governor text edits now move the hash; hashes computed before/after this change never pool.
- 2026-08-26: both surface hashers additionally include the agent-dir prompt inputs Pi actually
  reads — `SYSTEM.md` (which REPLACES the base system prompt) and `AGENTS.md`/`CLAUDE.md` (folded
  into every session's context). A live `~/.pi/agent/AGENTS.md` had been model-visible and unhashed
  since before 2026-08-11, so an edit to it could pool measurements across a real prompt change.
  Same epoch rule: hashes computed before/after this change never pool, even for identical code.

Full option, trigger, rollback, and security documentation is in `README.md`.

## Release and rollout checklist

For every source PR:

```sh
git diff --check
npm run secret-scan:diff
npm run verify
```

Then inspect staged paths for unrelated user work. The diff scanner reports only file, line, and
pattern ID and must never be changed to echo matched content. The canonical suite discovers its
tests dynamically; command output, not a hard-coded count, is authoritative.

After separate human approval to roll out a PR:

1. Mirror the first-party `harness/`, examples, and skills surface into `~/.pi/agent`.
2. Run `npm run mirror:check -- ~/.pi/agent`; extra documented local-only files are ignored.
3. Load the live harness through the current supported Pi release and confirm every declared
   extension and skill; the compatibility matrix separately covers Pi 0.80.6 through 0.84.x.
4. Record the new loaded surface hash. Do not pool old and new measurements.
5. Never commit or push from `~/.pi/agent`.

No live mirror or gate round is implied by approval of source implementation. Ask explicitly at
the rollout checkpoint. One gate round per box; never start one automatically.

## Security and operational constraints

- Never echo credentials. Do not place credentials, private endpoints, or machine-specific
  settings in diffs, tests, telemetry, notifications, or documentation.
- The repository is public. Secret-scan every diff before pushing.
- Preserve unrelated user changes in dirty worktrees.
- Use counterfactual regression checks: temporarily remove/revert the fix and prove its targeted
  test fails before accepting a new audit regression.
- Editing a running gate script can corrupt its byte-offset execution; stop the run first.
- Configuration-mode exposure proves only that configuration was applied. It does not prove the
  mechanism fired.
- Commit trailer: `Co-Authored-By: <the working Claude model> <noreply@anthropic.com>`
  (e.g. `Claude Opus 5` or `Claude Fable 5`).

## Optimizer — rebooted (2026-08-15)

The optimizer is **unmothballed** under `optimizer/docs/UNMOTHBALL_2026-08.md` (charter) and
`optimizer/docs/PREREG_FIXTURE_ADMISSION_2026-08.md` (the single admission rule; supersedes the
2026-08-11 band rule and the unpreregistered rule in `failure_episode_trial.calibration()`).
Primary outcomes: graded_rate (capability) and semantic_failure_overrun (loop interventions).
Keep the 2026-08-03→15 archive-era code, raw results, and preregs intact for audit.

Standing discipline unchanged: pass/fail guards harm; positive decisions need continuous
metrics, exposure evidence, adequate power, and an ADMITTED fixture; every round re-baselines on
the current model-visible surface, is started by Albert, one per box, never automatically.
