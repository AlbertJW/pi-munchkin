# Run Kernel PR 2: concurrency correctness and truthful tool surface

Status: dark implementation. Source hash `01990f1cfc2018f203fab0f7eae8d63a1f6e096aed9736d2599104c8183f91f3`.
No default flip, live mirror, or model round is implied by this document.

## Execution-order verification

`VerificationOrderClock` consumes Pi `tool_execution_start` and
`tool_execution_end` boundaries. Every source-mutation start immediately
invalidates earlier green evidence, and its end advances the boundary whether
the call succeeded or failed. A successful verifier is current only when it
starts after that boundary and no mutation remains pending. Missing starts,
missing ends, overlaps, and duplicate ends provide no green evidence;
transcript-only mutations remain pending fail-closed. Aggregate `plan_write`
and `plan_update` gates use their enclosing call boundary and consume only the
receipt carrying that call ID.

This mechanism now defaults to `VERIFY_EXECUTION_ORDER=execution`.
`VERIFY_EXECUTION_ORDER=legacy` is the temporary transcript-order rollback.

## File mutation queue

Hashline no longer declares a global sequential execution mode. It acquires
Pi's canonical `withFileMutationQueue` locks for every target, in sorted order,
around the complete stat/read/relocate/validate/write/rollback transaction.
Patches sharing any target serialize. Disjoint targets remain parallel.
Multi-file all-or-nothing and rollback behavior is unchanged.

## Active-only prompt truth

`ACTIVE_TOOL_PROMPTS=active` removes the historical ambient plan, delegation,
span, and compaction block and attaches bounded guidance to the owning tool
definitions. Pi therefore includes schema, snippet, description, and guidance
only for active tools. The subagent's discovered-agent list is likewise added
only while `subagent` is active. Manual disable removes it again.

Unset preserves the currently deployed ambient prompt byte surface. This dark
mode is a mechanism implementation, not an adoption or benefit claim.

## Invariants

- `command-policy.ts` remains the sole command classifier.
- A mutating verifier cannot verify itself.
- Exact detected project gates retain precedence over generic suites.
- Pi 0.80–0.83 receive discovered subagent data through the same selected-tool
  check; no version-specific registry refresh is required.
- No prompt text, command, arguments, output, path, or error enters RunState.
- `context-pressure*` files remain untouched.
