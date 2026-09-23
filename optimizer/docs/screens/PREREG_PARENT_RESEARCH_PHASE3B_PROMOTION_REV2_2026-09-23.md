# Phase 3B promotion screen revision 2 — implementation pin

Status: **ATTEMPTED — INCOMPLETE; NO PROMOTION**. This addendum supersedes only the
implementation pin in `PREREG_PARENT_RESEARCH_PHASE3B_PROMOTION_2026-09-22.md`.
Its ten frozen cases, fail rules, and no-pooling rule remain unchanged. The
optimizer remains mothballed; only its retained offline verification ran.

- Source implementation commit: `ae289e0`.
- Package-source SHA-256: `fd23bb28d6b811c8b09fe61b28d51f8310152d460af995b63b65c9bb84ae691c`.
- Verification: `npm run verify`, six stages passed in 121.1s; 936/936
  harness tests; typecheck, health, package smoke, offline optimizer check,
  and secret scan passed.
- New regression coverage: terminal cancellation charges and closes one child
  reservation in one revision; fresh-process recovery retains paused phase and
  charges once; late results are inert; a missing reservation rejects the graph
  transition; pre-dispatch release refunds.
- Candidate overlay: `extensions/ketch.ts`, `extensions/plan-runner.ts`,
  `lib/plan-graph.ts`, `lib/research-aggregate.ts`, `lib/research-round.ts`,
  and `vendor/pi-subagent/index.ts` from this implementation, layered over
  the currently installed package. Exact source/loaded file hashes and the
  Qwen Q2 serving fingerprint must be captured with the execution receipt.

The first isolated Qwen Q2 candidate run stopped before any research tool with
`upstream command exited prematurely`. A separate eight-token direct chat
request to the same router route returned HTTP 500, while router health was OK
and the model returned to `unloaded`. Case 1 is INCOMPLETE; cases 2–10 were
not run after the serving failure. No Phase 3B acceptance case is marked PASS
solely from the offline suite. The installed live package was not changed.
