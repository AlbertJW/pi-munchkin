# Draft pre-registration: hierarchical deep-research planner screen (2026-08-25)

> **STATUS: BLOCKED DRAFT — NO SESSION MAY START.** The already-prepared semantic-loop screen must
> finish or Albert must explicitly retire it first. This source branch must then be human-merged,
> mirrored, and loaded; an authoritative loaded surface hash must replace `UNASSIGNED`. Purpose-built
> complex-research fixtures must also pass the repository's fixture-admission rule. Every stage
> requires Albert's explicit approval and nothing auto-advances.

## 1. Treatment

Candidate: `configs/pending/deep-research-planning.json`. Control:
`configs/pending/deep-research-planning-control.json`. Their exact hashes are frozen below after the
final source verification. Both arms set `RESEARCH_LEDGER=on`. The only treatment delta is:

- control: `PLAN_GRAPH=off`, `DEEP_RESEARCH_PLANNING=off`;
- candidate: `PLAN_GRAPH=on`, `DEEP_RESEARCH_PLANNING=on`.

No planner, research, governor, model, serving, tool-profile, budget, or judge delta may be co-tested.

## 2. Question and declared prediction

This screen asks only whether complex deep research reliably activates and completes the bounded
parent-authoritative graph. It makes no efficacy claim. The later comparative question, if separately
approved, is whether the graph improves evidence coverage and synthesis reliability at neutral or
lower wasted effort while holding the same three-search/five-discovery-read envelope.

Straightforward fact lookup is a negative-control class: it must not call `research_plan_start`.

## 3. Required fixture slate

Before preflight, author and admit at least three artifact-graded research fixtures:

1. a comparative question requiring independent evidence families;
2. a contested claim requiring supporting and counter-evidence branches;
3. a multi-part synthesis where one branch has a genuine unresolved evidence gap.

At least one fixture must make a depth-one split useful; at least one must not require it. Every
fixture must have a frozen prompt, source-time cutoff, expected evidence families, citation/claim
grading, a budget receipt, and a negative-control fact-lookup sibling. Existing software-edit gates
are ineligible because they cannot expose this mechanism.

## 4. Stages and gates

Stages are separate human-started actions:

1. **preflight (zero model sessions):** verify both config hashes, source and loaded surface hashes,
   model/registry/serving identity, flags, telemetry catalog, private artifact modes, and fixture
   admission. Refuse if the semantic-loop track is unfinished or not explicitly retired.
2. **mechanism screen:** six candidate-only complex-research sessions, balanced across admitted
   fixtures. Pass only if at least four sessions contain exactly one `plan-runner/research-start`,
   at least one `plan-runner/branch-merged`, no telemetry schema rejection, no budget inflation,
   and a terminal `plan-runner/settled`. Any `branch-failed` session is reported and cannot count
   as a pass. On failure: stop and diagnose; these rows never become efficacy data.
3. **negative-control screen:** three candidate-arm fact lookups. All three must have zero
   `research-start`, `branch-merged`, and `settled` events. Any activation stops the track.
4. **bounded shadow/comparative design:** computation and protocol review only. A future A/B sample
   size, primary score, non-inferiority guards, and adoption predicate require a new committed
   preregistration and another Albert approval.

## 5. Mechanism and integrity receipts

Per candidate session report:

- counts for `research-start`, `expand`, `branch-merged`, `branch-failed`, and `settled`;
- root/leaf counts and maximum depth (no graph may exceed 24 nodes or profile depth two);
- allocated and consumed searches/reads across all branches;
- parent validation-note count, delegated-lead count, unresolved-gap count, and deferred count;
- retrieval strategy and coverage receipts: bounded/exhaustive scope, returned/total counts,
  truncation, failed retrieval, budget exhaustion, and whether any `done` node lacked complete
  gap-free coverage;
- child exits and failure classes; no URL, query, quote, or claim enters telemetry;
- total tool calls, turns, tokens, wall time, and artifact-grade correctness.

The graph mechanism is unexposed if it merely becomes available. Exposure requires a merged branch;
completion requires settlement after parent evidence validation. Proposed child citations are never
credited as verified evidence.

## 6. Stop conditions

Stop immediately on a surface/config/serving mismatch, duplicate or absent settlement, graph budget
inflation, parent capsule mutation by a child, a depth-two delegation attempt, telemetry rejection,
unredacted research content in telemetry, a completed node with incomplete coverage, post-settlement
mutation, or any live-mirror drift. A mechanism-screen failure is
`DIAGNOSE`, not a negative efficacy result.

## 7. Frozen identity (incomplete by design)

- branch source surface: `b8f1c8b060fc963045ab4235416265b4c973438da8e92e291bbeb7bd0e34efef`
- authoritative loaded live surface: `UNASSIGNED`
- candidate config sha256: `0d01aab9292db845b5f228174e2a1a4c10328883daebd482dcd9c9c9f5f5fd1e`
- control config sha256: `a2e5efef3ab36d90ab58ee91920b766e5c7a162905da970778e9439c3c1c92f7`
- model registry, model alias, serving fingerprint, fixture manifests: `UNASSIGNED`

This draft is stale by definition until the remaining live/model/fixture values are assigned after
the earlier semantic-loop screen and the human-gated mirror/load boundary. Assigning values does
not authorize a stage.

## 8. What this screen cannot conclude

Passing proves only activation, bounded delegation, merge, parent verification, and settlement on
the admitted fixtures. It cannot justify enabling the flags by default. Default activation requires
a separately powered comparative result and a separate human decision.

The comparative protocol must not use token savings alone. It must stratify direct versus structural
questions, low- versus high-degree targets, repository scale, and traversal depth; include ordinary
project traces plus task-specific suites such as CodeRAG-Bench, COIR-Retrieval, ContextBench, and
SWE-Explore; and report task correctness, coverage/completeness, latency, index construction and
amortization, tool calls, and tokens. A traversal that truncates or hits its budget is incomplete and
cannot be credited as a saving. Highest-degree-only probes are an explicit selection-bias failure.
