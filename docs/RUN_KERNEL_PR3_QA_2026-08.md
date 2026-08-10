# Run Kernel PR 3 QA ledger

Scope: `codex/run-kernel-pr3-arbiter`. No live mirror, gate round, or control adoption was
performed.

## Counterfactual regressions

| Restored behavior | Targeted proof | Expected distinction |
|---|---|---|
| Every producer delivers independently | real verify-gate plus pseudo-tool-rescue collision | legacy actions are both observable; enforce emits exactly one verification intervention |
| A tier-three abort also sends a correction | abort-winner integration fixture | abort callback fires once and the automatic message list remains empty |
| Telemetry rows drive blackboard or activation | architecture and telemetry-equivalence fixtures | removing typed signal delivery or reintroducing a telemetry tap changes state/messages and fails |
| Writer drains run independently | cross-module ordered-sequence stress fixture | serialized output is strictly increasing; unordered drains violate the assertion |
| Queue growth is unbounded | overflow fixture | the capped queue drops rows and later emits one count-only receipt |
| Pending control is bounded only per boundary | 129-boundary fixture | the queue retains at most 128 proposals globally and clamps delivery text before queueing |
| Failed overflow-receipt enqueue counts as lost data | full-queue count fixture | the retained observational drop count stays exact until capacity recovers |
| Async writer chmods an existing parent | pre-existing `0755` parent fixture | the file becomes private while the user-owned parent mode remains unchanged |
| Flush extension loads before settled producers | package-order closure assertion | the flush boundary is last, after Run Kernel and every other settled producer |
| `enforce` is set while the arbiter extension is omitted | active-bus handshake fixture | producers retain legacy delivery instead of silently dropping every correction |
| Dormant micro-gate emits outside arbitration | closed producer and priority fixtures | parse failures rank as safety consequences; heuristic slop warnings rank as context hints |

## Verification lanes

Final command output immediately before review and commit is authoritative. Counts below are
updated only after the final staged diff passes.

| Lane | Result |
|---|---|
| focused arbiter/signal/writer tests | green |
| telemetry-on/off control equivalence | green |
| canonical test runner | 467/467 green |
| Pi 0.80.6 lower-bound typecheck | green |
| deterministic package smoke | 116 files; 30 extensions and 2 skills loaded |
| full `npm run verify` | green: tests, typecheck, health, package smoke, optimizer verification |
| packed consumers Pi 0.80–0.83 | green on 0.80, 0.81, 0.82, and 0.83; 30 extensions and 2 skills loaded per consumer |
| peer range boundaries | green: below-lower and at-upper rejected; lower and inside-upper accepted |
| non-echoing secret scan | clean; 1,440 added lines inspected before staging |
| deterministic source surface | `6548d5d9265ed5e9b7643e55a10ccb9df22381eafe3827209e72b5b993943f54` |
| protected paths | no `context-pressure*` path changed |
