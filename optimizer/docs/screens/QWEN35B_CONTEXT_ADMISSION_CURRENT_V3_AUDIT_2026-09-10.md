# Qwen context-admission current-source V3 — audit (2026-09-10)

## Verdict

V3 is a **clean, narrow current-source mechanism/safety receipt**. It does
not support default adoption or an efficacy claim.

The normal Qwen cell exited `0`, produced one
`context-admission/admitted` / `within_budget` telemetry row, and crossed the
isolated forwarding proxy exactly once. The 200,000-byte private system-prompt
cell produced one `context-admission/rejected` /
`aggregate_budget_exceeded` row and crossed the proxy zero times. The guard
therefore demonstrated both normal exposure and pre-dispatch prevention under
the frozen V3 rule.

## Binding and containment

- Run ID: `aae00809-b956-4254-8d64-ad9f4f04e74c`
- Approval SHA-256:
  `40bdda224345b3f92085f106066b6d6bc4a912435f3bce8981098cb15253b550`
- Endpoint fingerprint:
  `75a5be964d6e0f344c4bd3cf366443183784a28430c4a2e7ee101ef94fdad83e`
- Private artifact-path digest:
  `e844ade46be40b7772d7dc2e2095b3b3c7ca3982b2e857a595c9acaff4758cb4`
- Private artifact mode: `0600`

The approval bound the manifest, runnable probe, admission extension,
telemetry flusher, evaluator, and proxy-route policy. The private result holds
only hashes, status classes, byte counts, timings, model identity, and proxy
counts. It contains no raw prompt, model output, router URL, or error text.

## Limits and decision

V3 measured one small normal request and one local aggregate-overflow refusal.
It did not measure actual provider-rendered token capacity, observed-overflow
recovery after a provider turn, compaction success/failure, output
reservations, concurrency, model switching, or task-level benefit. Do not pool
it with V1/V2, historical G02, or any different serving/surface identity.

`CONTEXT_ADMISSION=on` remains opt-in and **unresolved** pending the broader
safety/recovery screen named in the candidate register. No live default,
mirror, deployment, or release decision changed.
