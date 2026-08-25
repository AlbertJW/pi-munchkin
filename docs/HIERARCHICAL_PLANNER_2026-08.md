# Hierarchical planner and deep-research plan graph

## Status

Implemented on the isolated `codex/hierarchical-planner` branch. Both runtime switches default to
`off`; this branch has not been merged, mirrored, loaded by Pi, or used for a model session. The
existing semantic-loop study remains the first eligible measurement track. Package-source surface:
`ed59f742891f592318896c7120c3c7373efdf04e242ed9d54ca1d2509c953b66`.

## Runtime contract

The planner has two compatible state forms:

- schema v4 is the existing flat `/plan` checklist. With `PLAN_GRAPH=off`, its commands, review
  hold, `/plan-go`, and storage behavior are unchanged.
- schema v5 is a reusable parent/child graph. A v4 state read under `PLAN_GRAPH=on` migrates to
  flat root `work` nodes on its next mutation. A v5 capsule is dormant while the kill switch is
  off; it is not silently downgraded.

V5 adds optional `parent_id`, `kind`, `owner_ref`, conserved `{allocated, used}` budgets,
`evidence_gaps`, and terminal `deferred` state with required value/risk/rationale. IDs remain stable.
The validator rejects orphans, cycles, depth overflow, duplicate IDs, budget inflation, profile
fan-out violations, and graphs above 24 nodes.

`plan_expand` changes structure below one stable parent. `plan_settle` is head-only economic
settlement: every required node must be terminal, blocked work prevents settlement, deferrals must
be explained, and profile-specific evidence conditions must pass. Ordinary local progress still
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

One discovery envelope covers the graph: three searches and five source reads. Root allocations
must sum within that envelope; a branch may subdivide only its own remainder. The head receives up
to five validation re-reads. Budget exhaustion becomes an evidence gap, never a reset.

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
each transactionally. Duplicate delivery replaces only that branch's children. Wrong ownership,
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
