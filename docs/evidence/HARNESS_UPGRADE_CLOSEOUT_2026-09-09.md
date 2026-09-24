# Harness upgrade closeout — 2026-09-09

This closes the current implementation pass, not the approved five-package specification. New research behavior remains dark; no inference, calibration, mirroring, deployment, or default change was performed. Unrelated working-tree edits were preserved.

## Once-over corrections

Restored the original branch depth in the aggregate-preparation failure regression. An accidental depth override bypassed the real dispatch context. The isolated planner wrapper still passes all 69 inner tests with the original context.

Removed “atomically” from the model-facing research_finish snippet. Its current ledger-then-graph implementation is not a single transaction and does not establish exactly-once answer delivery.

The earlier foundation receipt's 818/818 total was not a directly observed full-suite count; additional tests inside the isolated wrapper do not each increase the outer runner's count. Use the measured closeout result rather than that inferred total. Earlier optimizer and secret-scan statements are scoped to their earlier snapshots, not evidence of a clean current tree.

## Remaining release gates

Context accounting still needs production request-count integration and epoch/compaction observation qualification. Research still needs an aggregate-only reducer baseline and serialization across graph and ledger changes: using authoritative opposite-side snapshots does not prevent stale same-side reducers or concurrent projections. Compatibility views must become rebuildable outputs rather than independent mutation authority. Existing plan and ledger locks are separate, not a shared cross-file transaction.

The parent workflow still needs provider-hung ten-minute cancellation/progress, complete extension and goal-continuation qualification, branch-specific coverage proof, and recoverable terminal delivery identity. Optimizer baseline execution and fresh-process uncertain-operation recovery qualification remain outstanding. These are release blockers, not invitations to start another unbounded refactor during closeout.

After those gates, the frozen-corpus Ling qualification and matched Qwen screen require separate explicit execution approval. Do not promote this checkpoint merely because offline tests pass.

## Current verification limitations

Measured full harness run: **816 tests, 815 pass, 1 fail**, 109.5 seconds. The failure is G01-E real AgentSession compaction: two continuation receipts were observed where the current test requires one. That test and its helper already had unrelated uncommitted edits; neither was changed in this pass. This is an unresolved lifecycle qualification failure, not a green suite. Investigate the receipt ordering and ownership before release; do not relax the assertion merely to pass.

An immediate isolated rerun of the G01 file passed 11/11. The full-suite failure is therefore intermittent or dependent on execution conditions; the isolated pass does not clear it.

Typecheck, package smoke (185 files, 31 extension entrypoints, two skills), and whitespace checks pass. Optimizer verification stops on the separate untracked c51 grep/find candidate's unsupported exposure mode, `activation`; that candidate was not modified here. The default secret diff scan reports six pre-existing PRIVATE_ENDPOINT findings in Optimizer V2 files; matched content is intentionally not reproduced. A HEAD-scoped scan alone would not clear those findings for publication. No push is claimed.

Source surface after the wording correction: `e06b76000ac1a6b140e69b452379262e886612413c0d24d20bb38ccc8288819b`. This is not a loaded/live receipt.

Mirror comparison reports 16 of 130 first-party files different. This is expected source/live drift, not a passed parity check; no sync was attempted. The commit containing this closeout is the rollback point for the test-context and snippet corrections only.

## Phase 3B closure update — 2026-09-22

The research release blockers listed above are now implemented and verified at
source commit `317707f`: aggregate-only parent mutation, shared graph/ledger
serialization, rebuildable compatibility views, provider-hung ten-minute
cancellation, extension behavior, branch coverage/lease enforcement,
recoverable terminal delivery, and fresh-process uncertain-operation recovery.
The full offline gate passed 935/935 tests and all six verification stages.

Phase 3B is therefore implementation-complete and ready for its separately
approved live qualification. It is not yet live: the parent workflow remains
opt-in, no mirror or inference was run, and no default was changed. The frozen
qualification and rollback contract is
`optimizer/docs/screens/PREREG_PARENT_RESEARCH_PHASE3B_PROMOTION_2026-09-22.md`.

## Current Phase 3A–5 status — 2026-09-24

The preceding dated sections preserve what was known at those checkpoints; the
Phase 3B paragraph above is historical and is superseded by the 2026-09-23
promotion receipt. Current source review confirms the qualified Phase 3A and
Phase 3B selected runtime files have not changed from their respective
qualified candidate commits. The current source-surface SHA-256 is
`121bd19bf1203f89493c782635b3275bb02e75d4d310d059dabd17c6f827086c`, equal to
the Phase 3A revision-3 source surface. Phase 3B used its separately recorded
candidate surface `8a9e5e7d…`; its six selected file contents remain unchanged
in current source.

- **Phase 3A:** all eleven Occamy safety/recovery cases, all six verification
  stages, and enabled/disabled post-install smokes passed. Four-file overlay
  installed. `CONTEXT_ADMISSION` stays off by default. This is safety
  qualification, not benefit evidence. See
  `optimizer/docs/screens/PHASE3A_OCCAMY_SCREEN_2026-09-23.md` and
  `docs/evidence/PHASE3A_LIVE_INVENTORY_2026-09-23.json`.
- **Phase 3B:** all ten Occamy acceptance cases, all six verification stages,
  and parent-mode/legacy-isolation checks passed. Six-file overlay installed.
  Its flags remain opt-in. This is bounded operability evidence, not a general
  research-quality result. See
  `optimizer/docs/screens/PHASE3B_OCCAMY_SCREEN_2026-09-23.md` and
  `docs/evidence/PHASE3B_OCCAMY_PROMOTION_2026-09-23.json`.
- **Jina Reader:** installed in source and opt-in. The existing registry row
  is refreshed; its 2026-09-10 fixed-source screen remains mechanism evidence
  only. The first 2026-09-24 draft is superseded before execution because its
  both-arms-enabled setup allowed automatic fallback in the nominal direct
  control. Successor revision 2 compares the full flag-off versus flag-on
  feature and includes schema/guidance and fallback as treatment. It is a
  protocol draft, not execution-ready; task fixtures, numeric rubric/margin,
  runner, model, and independent judge remain unbound.
- **Research ledger:** implemented and opt-in. Run 3 remains incomplete; Run 4
  is explicitly superseded, unexecuted, and not evidence. A current-source
  isolated ledger-versus-budget-only protocol is prepared, not execution-ready.
  It explicitly selects non-graph mode and uses equal 3/5 research allowances;
  prompts/fixtures, numeric quality rule, runner, model, and independent judge
  remain unbound. Phase 3B does not isolate ledger value.
- **Hierarchical planner:** implementation exists and flags remain off.
  Historical 0/3 settlement and G04 inconclusive findings remain intact and
  are not resolved by Phase 3B. A separate mechanism protocol is prepared but
  not execution-ready; fixture/oracle files, enforced deadline runner, model,
  and serving identity remain unbound.
- **Vision:** observation, cache, geometry, and SAM adapter implementation
  already exist; model-specific evidence remains mixed and limited. A static
  applicability audit is recorded; no capability rebuild or new screen ran.
  Existing five-case vision preregistration dimensions remain useful, but its
  old source/runner/SAM identity is not a current execution manifest.
- **Phase 4–5 closeout:** the consolidated acceptance runbook is
  `docs/evidence/PHASE4_5_ACCEPTANCE_RUNBOOK_2026-09-24.md`. It distinguishes
  installed, default state, qualification scope, and benefit evidence for each
  feature, with prerequisites, measures, approval gates, promotion, and
  rollback conditions.

This is the original handover's feature-acceptance/release closeout, not the
old upgrade plan's optimizer Packages 4–5. Optimizer campaigns, baseline
execution, and optimizer release qualification remain mothballed. No
qualification, inference, benchmark, mirror, install, default change, SoL-Pi
installation, Hashline 2.0 implementation, or push occurred in this closeout.
The next proposed approval is **non-inference Jina study-readiness work**:
freeze five prompt/source/oracle fixtures, settle the numeric rubric and
non-inferiority policy, define a runner receipt that binds requested/effective
reader and fallback cost, and arrange model/judge identity at zero-session
preflight. This does not authorize a model session. Session execution, result
review, and any promotion need separate approvals.

Jina appears in the experimental-candidate register but not in
`optimizer/prompt-lab/configs/schema.json`. The proposed comparison uses
isolated Pi sessions with the runtime environment flag and does not require
optimizer-schema support. No schema change or optimizer invocation is planned;
campaign support would require a separate optimizer restart decision, which is
outside this closeout.

Queued Hashline 2.0 work remains an independent track. No study, qualification,
or future experimental-execution step in this closeout depends on or advances
that separate work.
