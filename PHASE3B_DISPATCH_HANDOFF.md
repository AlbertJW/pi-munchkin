# Phase 3B — dispatch authorization handoff

Invariant (single): **In parent research mode, no external retrieval may
dispatch unless durable authorization has committed successfully for that
operation.**

Scope: complete this invariant only. Do not attempt the rest of Phase 3B.
Base HEAD: `2d90df5`. Uncommitted work in `ketch.ts`, `research-round.ts`,
`research-late-receipt.test.ts` is preserved and continued (not reverted).

## Frozen acceptance cases

- **A. Authorization failure prevents dispatch.** Missing / mismatched /
  malformed aggregate authority, and failed authorization persistence →
  adapter invoked 0×, explicit refusal, no fabricated receipt/charge.
- **B. Authorization checks current locked state.** Phase or deadline change
  after caller preflight but before the aggregate lock → ineligible op
  refused, adapter 0×, no authorization/reservation committed. Search
  respects discovery closure; reads respect the read deadline.
- **C. Authorization reserves budget atomically.** Capacity for one op →
  two concurrent distinct authorizations cannot both succeed. Count consumed
  + reserved. No process-local counters.
- **D. Authorization has a stable identity.** Bound to original run,
  operation identity (tool_call_id), kind, canonical request. Identical
  replay → no second reservation/revision. Same operation identity +
  different request → refused.
- **E. Read request identity preserves URL semantics.** No lowercasing of
  case-sensitive path/query. Use `canonicalResearchUrl` + unambiguous
  structured encoding. Test an uppercase path + query value.
- **F. Successful authorization is durable before dispatch.** Through
  registered web_search/web_read, the fake adapter inspects persisted state
  when invoked and observes the matching committed authorization/reservation.

## Current test evidence

- Latest full `npm run verify` passed (all six stages) on the uncommitted
  work — but that does NOT prove this invariant.
- The uncommitted `authorizeResearchOperation` (research-round.ts:1268)
  returns `null` for missing/mismatched/malformed aggregate state; ketch.ts
  callers ignore that null and proceed to dispatch (search ~648, read ~795).
- It checks phase under the lock (`["active"]`) but does not recheck the
  deadline (`rejectExpired` unset) and does not reserve budget.
- `authorizeOperation` (research-round.ts:661) lowercases the request, which
  breaks case-sensitive read URLs; the read dispatch joins URLs with `","`
  (ambiguous).
- Existing `research-late-receipt.test.ts` covers late/replay/wrong-run
  receipts, not dispatch-time authorization.

## Next action

Write and run the first failing regression for **case A**: a production-path
web_search where the aggregate's `evidence_round` is not a valid ledger
(preflight passes, `authorizeResearchOperation` returns null) → assert the
adapter is invoked 0× and the tool refuses. Observe RED before fixing.

Then fix `authorizeResearchOperation` to fail closed (throw, not null) and
work B→F in order, one case at a time, small patches, refreshing the span
before each edit.

## Progress log

- (init) State confirmed: HEAD 2d90df5, 3 modified files, invariant gaps
  located. Handoff record created.
- **A DONE (GREEN).** `authorizeResearchOperation` now throws (fail-closed)
  on missing/mismatched/malformed authority instead of returning null.
  Regression: malformed `evidence_round` → adapter 0×, explicit refusal, no
  receipt/charge. RED observed first (adapter was invoked 1×).
- **Next:** case B — recheck deadline under the lock (search: discovery
  closure; read: read deadline) and refuse ineligible ops after a
  post-preflight phase/deadline change.
- **B DONE (GREEN).** `mutateParentResearchRoundLedger` gains `requireDiscovery`;
  `authorizeResearchOperation` passes `rejectExpired: true` +
  `requireDiscovery: kind === "search"`. Under-lock recheck refuses
  search-after-discovery-closure, expired search/read; a validation-phase
  read stays eligible (no blanket rule). RED observed first.
- **Next:** case C — reserve budget atomically in `authorizeOperation`
  (count consumed + reserved), durable under the aggregate lock; reconcile
  the reservation at completion to avoid double-charge/stranded reservation.
- **C DONE (GREEN).** `authorizeOperation` atomically reserves the operation's
  budget unit in `budget.reserved` under the aggregate lock; the ledger
  conservation check now counts in-flight (authorized, not completed)
  operations in `reserved`; `releaseOperationReservation` runs in both
  completion paths before charging, so each unit is charged at most once and
  no reservation strands. Regression: capacity for one search → two
  concurrent authorizations → exactly one succeeds, one committed, and
  `consumed + reserved === 1` is durable. RED observed first (both succeeded;
  then both failed until the conservation check counted in-flight ops).
- **Next:** case D — stable operation identity: identical replay → no second
  reservation/revision; same operation identity + different request → refused.
- **D DONE (GREEN).** `opId` derives from `(run, kind, tool_call_id)` only; the
  canonical request is a binding — same identity + different request → refused.
  Identical replay → idempotent (no second reservation/revision). RED observed
  first (a conflicting request minted a new authorization).
- **E DONE (GREEN).** `authorizeOperation` preserves URL case for reads
  (trim only, no lowercase); search stays lowercased. Regression: an uppercase
  path + query value round-trips the stored request case-intact. RED observed
  first (the stored request was lowercased).
- **F DONE (GREEN).** Production web_search commits the authorization + reserved
  unit durably before the adapter is invoked; the (barrier) adapter observes the
  matching committed authorization/reservation in persisted state.
- **Test fixes.** `callTool` gains an optional `toolCallId` (default `"tc-test"`);
  ketch.test.ts: the shared-discovery test now seeds a full valid ledger (was a
  bare `evidence_round`), and the two compatibility-ledger tests pass distinct
  `toolCallId`s per query (same for the idempotent retry) so case D's identity
  does not collide. All 32 ketch tests pass.
- **GATE GREEN.** Full `npm run verify`: all 6 stages pass (132.6s serial).
