# Hierarchical planner and deep-research plan graph

## Status

Implemented on the isolated `codex/hierarchical-planner` branch. Both runtime switches default to
`off`; this branch has not been merged, mirrored, loaded by Pi, or used for a model session. The
existing semantic-loop study remains the first eligible measurement track. Package-source surface:
`b8f1c8b060fc963045ab4235416265b4c973438da8e92e291bbeb7bd0e34efef`.

## Runtime contract

The planner has two compatible state forms:

- schema v4 is the existing flat `/plan` checklist. With `PLAN_GRAPH=off`, its commands, review
  hold, `/plan-go`, and storage behavior are unchanged.
- schema v5 is a reusable parent/child graph. A v4 state read under `PLAN_GRAPH=on` migrates to
  flat root `work` nodes on its next mutation. A v5 capsule is dormant while the kill switch is
  off; it is not silently downgraded.

V5 adds optional `parent_id`, `kind`, `owner_ref`, conserved `{allocated, used}` budgets,
`evidence_gaps`, retrieval `coverage`, and terminal `deferred` state with required
value/risk/rationale. IDs remain stable.
The validator rejects orphans, cycles, depth overflow, duplicate IDs, budget inflation, profile
fan-out violations, and graphs above 24 nodes.

`plan_expand` changes structure below one stable parent. `plan_settle` is head-only economic
settlement: every required node must be terminal, blocked work prevents settlement, deferrals must
be explained, completed research nodes must have complete gap-free coverage, and profile-specific
evidence conditions must pass. A settled graph is immutable: routine deltas, structural rewrites,
and delayed child results cannot change it. Ordinary local progress still
allows one current item; concurrently delegated items require distinct owners.

Ambient status renders roots, descendant counts, remaining budget, and evidence-gap counts.
`/plan-status <node-id>` discloses one subtree. `/plan-export` writes non-authoritative review
snapshots to `.pi/TODO.md` and `.pi/plan-review.json`; the private capsule remains authoritative.

## Deep-research profile

`DEEP_RESEARCH_PLANNING=on` requires `PLAN_GRAPH=on`. `research_plan_start` additionally refuses
unless `RESEARCH_LEDGER=on`, because child evidence cannot settle the head without parent re-reading.
The deep-research skill requests this profile only for complex, contested, comparative, multi-part,
or delegated work. Straightforward fact lookup stays on the lightweight path.

The profile is deliberately small:

```
head plan
  ├─ research branch (depth 1, owned by one research-planner)
  │    └─ 0–2 research-scout leaves (depth 2, terminal; no planning/delegation)
  ├─ research branch
  └─ research branch                         (three roots maximum)
```

One discovery envelope covers the graph: three search calls and five distinct source reads. Root
allocations must sum within that envelope; a branch may subdivide only its own unspent remainder.
The retrieval tools enforce the assigned per-process remainder before execution, and the terminal
report reconciles parent and scout receipts. Once the graph starts, the head receives no second
search envelope—only up to five validation re-reads.
Budget exhaustion becomes an evidence gap, never a reset.

## Retrieval selection and completeness

The plan graph does not make a structural graph the universal retrieval path. A node may declare
`direct`, `structural`, or `hybrid` retrieval. Literal matches, known files, small fan-out, and
straightforward fact lookup stay direct. Caller/reference enumeration, rename planning, dependency
tracing, and other high-fan-out questions are candidates for structural retrieval. A future code
graph profile should default to one or two hops; a three-hop walk requires an explicit remaining
gap and budget because measured benefit is size- and query-dependent.

Coverage is a typed receipt: bounded versus exhaustive scope, returned and optional total counts,
truncation, failure, budget exhaustion, and derived completion. Exhaustive retrieval cannot be
complete without an exact total and equality between returned and total counts. Any truncated,
failed, or budget-exhausted receipt is incomplete. `web_search` and `web_read` expose the same
machine-readable fields; the model-visible render of the receipt is gated behind
`PLAN_GRAPH=on` (dark by default). Public-web branches normally use
direct/bounded coverage; they must not invent a total. Incomplete work may be blocked or explicitly
deferred with value/risk/rationale, but it cannot be marked done or silently complete the head.

This contract incorporates the useful mechanism from the measured code-graph discussion without
overclaiming its benchmark: its 40 probes were chosen from high-degree symbols, measured retrieval
tokens rather than downstream coding success, and showed that three-hop impact can be worse than
grep/read. Routing and completion integrity are adopted; universal graph retrieval is not.

## Child boundary and ownership

The head passes an exact typed `plan_context` with run ID, parent node, owner, depth, budget, and
expansion limits. The subagent wrapper writes it to a newly-created private temporary directory,
passes only the two per-call paths to that child, and removes the directory after exit. Those paths
are explicitly excluded from inherited child environments.

The child may write only a typed `branch_report`: proposed leaf nodes, terminal state, budget used,
source leads, and unresolved gaps. `branch_plan` returns distinct depth-two contexts for those
leaves; the wrapper permits only `research-scout`, no more than two dispatches, and exposes no
delegation tool inside a scout. Scout search/read use is derived from captured tool-call receipts,
not prose, and the terminal report must reconcile leaf and branch consumption. The child never
opens the parent capsule. After child exit the wrapper
validates the report and emits a typed result; the parent serializes concurrent arrivals and merges
each transactionally. A depth-one context has a one-shot dispatch lease and the first terminal
result wins, so duplicate dispatch or delivery cannot spend or rewrite the branch twice. Wrong ownership,
collisions, malformed reports, over-budget reports, interruption, and missing reports cannot add
nodes; a failed owner branch becomes blocked with a bounded failure class.

Delegated URLs remain unverified leads. Successful parent `research_note` calls publish sanitized
ledger keys in memory. Deep-research settlement requires the parent to validate every delegated
lead used by the graph and at least two sources overall; no more than the five-read validation
allowance can be credited.

## Observability and rollout

The dark mechanism records counts only:

- `plan-runner/research-start`
- `plan-runner/expand`
- `plan-runner/branch-merged`
- `plan-runner/branch-failed`
- `plan-runner/settled`

Telemetry carries no URLs, queries, claims, or quotes. Full child content remains subject to Pi's
existing transcript persistence boundary; the branch artifact itself is private and temporary.

Rollout order is fixed:

1. keep `PLAN_GRAPH=off` and `DEEP_RESEARCH_PLANNING=off` in shipped defaults;
2. finish or explicitly retire the already-prepared semantic-loop screen;
3. merge and mirror this surface only through the existing human gate, record its loaded hash, and
   re-run the no-inference load checks;
4. admit purpose-built complex-research fixtures and run the candidate-only mechanism screen in
   `optimizer/docs/PREREG_HIERARCHICAL_PLANNER_SCREEN_2026-08.md` only after Albert approves it;
5. make no default change from mechanism evidence alone. A bounded comparative measurement and a
   separate human decision are required before complex research can activate planning by default.

No automatic live mirror, stage progression, efficacy experiment, or default flip is implemented.
