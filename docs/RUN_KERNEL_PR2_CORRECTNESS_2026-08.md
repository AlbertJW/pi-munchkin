# Run Kernel PR 2: concurrency correctness and truthful tool surface

Status: dark implementation. Source hash `01990f1cfc2018f203fab0f7eae8d63a1f6e096aed9736d2599104c8183f91f3`.
No default flip, live mirror, or model round is implied by this document.

## Execution-order verification

`VerificationOrderClock` consumes Pi `tool_execution_start` and
`tool_execution_end` boundaries. A successful verifier is current only when
its start sequence is strictly later than the latest successful source
mutation end sequence. Missing starts and duplicate ends provide no evidence;
transcript-only mutations still arm the boundary fail-closed. Aggregate plan
gates use the enclosing `plan_write` start boundary.

The mechanism is dark under `VERIFY_EXECUTION_ORDER=execution`. Unset retains
the current transcript-order authority until the separately approved cutover;
`legacy` is an explicit compatibility spelling.

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
