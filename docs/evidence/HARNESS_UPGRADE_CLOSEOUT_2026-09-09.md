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
