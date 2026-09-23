# Phase 3B Occamy promotion screen — 2026-09-23

Status: **10/10 PASS; ALL SIX VERIFICATION STAGES PASS — READY FOR LIVE
OVERLAY, NOT YET INSTALLED**. This is a
separate model qualification selected by the user. It does not convert the
earlier Qwen Q2 `INCOMPLETE` result into a pass, and it does not change the
frozen acceptance cases in
`PREREG_PARENT_RESEARCH_PHASE3B_PROMOTION_2026-09-22.md`.

## Frozen candidate and serving identity

- Implementation commit: `0ae16e71c4e6e676f2bad92661f5c34571a58695`
- Source surface SHA-256: `8a9e5e7d2989c17a74ea0393d90ae4a93bec17f177423af0525e77b3ef148c89`
- Candidate-loaded surface SHA-256: `774564f96cf6597e6a1d1fb62ec4f1ef327d5cb4ece01dc885a29a774b52af9d`
- Router model ID: `occamy`; artifact: `occamy-1.0.Q3_K_M.gguf`
- Artifact SHA-256: `e1c4179e1ae3b8545a6e8d7858009e499e1fa58136b2e4b0d08a1e620fbe7be5`
- Serving configuration: text-only, context 131072, reasoning enabled with
  budget 4096, output cap 8192, one active backend.
- Candidate package: `/Users/Albert.Wessels/LLM/phase3b-candidate-20260923/extensions/pi-munchkin`
- Live baseline and rollback inventory: 119 files; every live file matches the
  preserved rollback receipt before installation.

## Case results

1. **PASS — Direct parent run.** Fresh isolated Pi run
   `/private/tmp/phase3b-occamy-screen-final-20260923/pi-events.jsonl`; run ID
   `research-plan-2026-09-23T13-08-44-677Z`. Occamy created one parent branch,
   searched once, read two distinct IANA sources completely, recorded two
   parent-validated notes under `example-domain`, recorded round
   `iana-example-domain` as ready, and completed `research_finish` with
   `isError=false`. The authoritative aggregate settled at revision 8; its
   graph and evidence ledger matched the compatibility projection at revision
   8. The final answer cited both sources.
2. **PASS — Exact accounting.** Tests passed: `read authorization reserves the
   complete batch before dispatch`; `duplicate queries, URLs, and reports
   cannot buy another allowance`; `A: a malformed aggregate authority refuses
   the search before the adapter is invoked`; and `replaying the same
   completion through the production accounting function cannot duplicate
   receipts or charges`.
3. **PASS — Atomic failure.** Tests passed: `nested graph and ledger changes
   roll back together when final validation fails`; `a caught nested failure
   restores its transaction savepoint`; and `a post-commit compatibility
   publication failure keeps the aggregate committed`.
4. **PASS — Concurrency.** Tests passed: `concurrent distinct parent ledger
   operations retain both updates and charges`; `a duplicate parent ledger
   operation is idempotent (no double charge)`; `concurrent parent research
   rounds serialize without losing a record`; and `concurrent aggregate
   transitions serialize without lost revisions`.
5. **PASS — Deadline and extension.** Tests passed: `parent research hard
   deadline pauses discovery before another provider call`; `the ten-minute
   watchdog aborts a hung turn and durably pauses the run`; and `deadline
   expiry is fake-clock deterministic and stale timers cannot pause an
   extension`.
6. **PASS — Fresh-process recovery.** Tests passed: `authorization from an
   exited real process is recovered from its durable state`; `dead dispatcher
   recovery charges its reserved batch once`; and `fresh process closes a
   stale lease once and preserves a paused parent`.
7. **PASS — Optional child.** Tests passed: `validated child result merges;
   settlement waits for parent evidence`; `unleased branch results cannot
   mutate an open research branch`; `terminal parent update charges and closes
   a leased child atomically`; and `parent branch merge performs one
   aggregate transition`.
8. **PASS — Terminal delivery.** `parent finish operation settles the ledger
   and graph in one call` verified replay returns the identical committed
   answer without another aggregate revision.
9. **PASS — Compatibility rebuild.** Tests passed: `an interrupted
   compatibility-ledger publication must not let a stale ledger drive the
   next round`; `a malformed compatibility ledger cannot replace valid
   aggregate authority (parent)`; and `parent retrieval commits receipts when
   the compatibility ledger is missing`.
10. **PASS — Legacy isolation.** With `RESEARCH_WORKFLOW` explicitly unset,
    `hierarchical planner integration passes in an isolated flag-on process`
    passed (1/1).

Deterministic test logs:

- `/private/tmp/phase3b-case-screen-deterministic-20260923.log` — 50/50 pass.
- Focused Ketch, late-receipt, ledger-transaction, deadline-transaction,
  research-round, and graph-integration run — 72/72 pass.
- Explicit legacy-isolation run with `RESEARCH_WORKFLOW` unset — 1/1 pass.

The initial under-specified Occamy diagnostic run is preserved at
`/private/tmp/phase3b-occamy-screen-host-20260923/pi-events.jsonl`; it omitted
the required claim obligation and did not settle. It is not pooled into this
screen. The successful case above is a new, complete, isolated run with the
claim obligation and expected operation sequence stated explicitly.

## Decision

The ten acceptance cases pass for the Occamy model arm. Proceed with the
six-file Phase 3B overlay only after `npm run verify` passes all six stages and
the pre-install live/rollback inventory is rechecked. Do not change defaults,
enable optimizer execution, or push. Run fresh parent-mode and
`RESEARCH_WORKFLOW`-unset Pi sessions after installation; restore the captured
live package if either smoke test fails.

Final verification passed on this candidate: `npm run verify` completed all
six stages in 128.4 seconds (937/937 harness tests; typecheck, health,
pack:smoke, optimizer mothball check, and secret scan all PASS). Log:
`/private/tmp/phase3b-occamy-verify-20260923.log`.
