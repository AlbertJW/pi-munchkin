# Preregistration: Phase 3B parent-research promotion (2026-09-22)

Status: **PREPARED — NOT EXECUTED**. This document records the live
qualification contract. It does not authorize inference, mirroring, a flag
default change, or rollout. The optimizer remains mothballed; its retained
offline validator and shutdown checks are the only optimizer code permitted to
run.

## Frozen implementation

- Source commit: `1b3473aeb461b4037304c3518f1002de4506c58d`
- Package-source SHA-256:
  `55247e92ffdfb6c6be86b467499f80a3f5998dae1a06d6cd962640b90c0faca7`
- Offline verification: `npm run verify`, all six stages passed in 160.9s;
  936/936 harness tests passed; typecheck, health, package smoke, optimizer
  mothball enforcement, and secret scan passed.
- Re-pinned 2026-09-22 from `317707f0830d82b977bdd9a3b4bf2a4f14560549`
  (`765b13e8…`) to the Phase 3B lease/lock/recovery hardening commit, as
  mandated by the boundary row in `docs/SURFACE_BOUNDARIES.md`. Only the
  implementation pin moved; the frozen acceptance cases and decision rules
  are unchanged, and the rollback parent remains `706d75b`.
- Promotion flags remain opt-in:
  `PLAN_GRAPH=on`, `DEEP_RESEARCH_PLANNING=on`, `RESEARCH_LEDGER=on`, and
  `RESEARCH_WORKFLOW=parent`.
- `CONTEXT_ADMISSION` remains dark and is outside this promotion.

The intended model-backed arm is the router-served Qwen 3.8 27B Q2 quant.
The exact router model identifier, serving fingerprint, context window,
output reserve, loaded package hash, and flag receipt must be captured at
execution; a friendly model name is not sufficient evidence.

## Required preflight

1. Confirm the router is healthy and the intended Qwen arm is the sole bound
   route. Record the router-reported model identifier and serving fingerprint.
2. Run the live-mirror dry check against the frozen commit. Refuse the screen
   if any changed first-party file is outside the explicit Phase 3B manifest.
3. Apply the mirror only after the operator approves that stage. Recompute and
   record loaded/source parity before any model request.
4. Enable the four opt-in flags for the isolated qualification session only.
   Do not change defaults or unrelated sessions.
5. Preserve a rollback receipt for the previous loaded files and verify that
   disabling `RESEARCH_WORKFLOW=parent` restores the legacy route.

## Frozen acceptance cases

All cases are required. `INCOMPLETE` is not a pass, and results are not pooled
with earlier Phase 3B runs.

1. **Direct parent run:** create one parent-owned branch, perform bounded
   search/read/note/round operations, and finish through `research_finish`.
   The aggregate is the only authority and compatibility files match its final
   revision.
2. **Exact accounting:** a multi-URL read reserves the full unique batch before
   dispatch; duplicates cost zero; an authorization failure invokes the
   adapter zero times; each completion charges at most once.
3. **Atomic failure:** inject a final validation failure after graph and ledger
   mutations. Graph, evidence, budget, lifecycle, and revision must all remain
   unchanged.
4. **Concurrency:** race distinct graph/ledger operations and duplicate
   completions. No update is lost, no reservation is exceeded, and duplicates
   mint no revision or charge.
5. **Deadline and extension:** close discovery at seven minutes; at ten minutes
   abort a deliberately hung provider turn, persist `awaiting_extension`, and
   emit bounded recovery guidance. Explicit extension resumes the same run
   without restoring spent budget.
6. **Fresh-process recovery:** terminate a process after durable authorization
   and before its receipt. A fresh process must close the uncertain operation
   once as failed, consume its reserved allowance once, and accept no evidence.
7. **Optional child:** dispatch at most one bounded child, require branch
   coverage and its lease, then merge graph and ledger in one aggregate
   revision. A stale or unleased result must change nothing.
8. **Terminal delivery:** interrupt after the terminal aggregate commit but
   before the answer is observed. A fresh session retrieves the identical
   committed answer through `research_finish` replay or `/research-result`
   without resettling or incrementing the revision.
9. **Compatibility rebuild:** remove or corrupt each compatibility view after
   a committed aggregate transition. The next transition/restart rebuilds it
   from the aggregate and never treats it as mutation authority.
10. **Legacy isolation:** with `RESEARCH_WORKFLOW` unset, existing hierarchical
    research behavior remains byte-compatible at its public boundary.

## Decision and rollback

Promotion passes only if all ten cases complete with no unexpected dispatch,
stale authorization, lost graph/ledger update, duplicate charge, false success,
post-deadline continuation, or unverifiable terminal answer. Any such event is
an immediate failure.

On failure, stop inference, disable `RESEARCH_WORKFLOW=parent`, restore the
captured live files, and verify loaded/source parity against the prior live
receipt. The repository rollback parent is `706d75b`; do not rewrite evidence
or delete the failed screen. Mirroring, qualification inference, and default
promotion each remain separate operator-approved stages.
