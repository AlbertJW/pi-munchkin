# Preregistration: hierarchical planner diagnostic and qualification — 2026-09-24

Status: **PROTOCOL DRAFT — NOT EXECUTION-READY; NOT EXECUTED.** `PLAN_GRAPH` and
`DEEP_RESEARCH_PLANNING` remain off by default. This protocol concerns the
older delegated hierarchical planner, not Phase 3B's parent-led research
workflow. The successful Phase 3B Occamy result cannot be used to erase or
pool with earlier planner failures.

## Current status and question

Runtime source pin: commit
`632409ddbc12085064f4953b1c1eaec73999ba91`, source-surface SHA-256
`121bd19bf1203f89493c782635b3275bb02e75d4d310d059dabd17c6f827086c`.
Documentation-only commits do not invalidate this runtime pin while the
source-surface and relevant runtime-file hashes remain identical. Protocol
identity is `HIERARCHICAL_PLANNER_DIAGNOSTIC_REV1`, this versioned document;
its Git blob identity is recorded in the consolidated runbook after commit.
Protocol changes require a new revision; runtime behavior changes require
re-review and a new protocol revision.

The graph, bounded child-report, shared-budget, and parent-validation
mechanisms exist and have substantial offline coverage. The 2026-09-04 Qwen
V3 screen stopped after 0/3 candidate sessions settled; G04's model comparison
was inconclusive after bounded branch failures/timeouts. These are real
historical outcomes for their frozen identities. They do not show that the
current source has repaired model-facing activation, branch completion, or
parent synthesis.

First question: can the current hierarchical route reliably activate only on
complex eligible research, complete bounded branches, validate returned
evidence at the parent, and settle one supported answer without overruns? Only
after mechanism qualification may a separately preregistered paired study ask
whether it improves research quality or cost.

## Required stages

1. **Zero-inference source/fixture preflight:** bind current commit and
   source-surface hash, loaded package hash, model/serving identity at the
   later approved execution, flags, manifests, runner/tests, telemetry schema,
   private artifact handling, and admitted fixtures. The model identity is
   unassigned in this document and must be frozen before any session. Refuse
   if a fixture lacks an independent answer/evidence oracle.
2. **Bounded diagnostic qualification:** use three artifact-graded complex
   fixtures: comparative evidence, a contested claim with counterevidence,
   and multi-part synthesis with a genuine gap; pair each with a simple
   fact-lookup negative control. Run one candidate session per complex fixture
   and one candidate negative-control session per fact lookup, in randomized
   order. Candidate enables `PLAN_GRAPH=on`,
   `DEEP_RESEARCH_PLANNING=on`, and required `RESEARCH_LEDGER=on`. No control
   arm is needed for this mechanism-only stage. Each session has a 10-minute
   process-group wall that the future runner must enforce; this is an
   execution constraint, not a guarantee supplied by the older graph
   workflow. Each session uses the shared 3-search/5-read-unit envelope;
   delegation remains at most one child at a time and the source's bounded
   depth/node limits apply. Pin `KETCH_TIMEOUT_MS=30,000`,
   `KETCH_BROAD_TIMEOUT_MS=45,000`, and `KETCH_READ_TIMEOUT_MS=60,000`.
3. **Separate value study:** only after a clean mechanism result, prepare a
   new randomized paired preregistration with a sufficiently complete task
   slate and independent blinded judge. No quality or adoption claim follows
   from stage 2 alone.

## Measures and pass rules

For each candidate, record start/expand/merge/fail/settle event counts, root
and leaf counts, maximum depth, allocated/consumed budget, child exit classes,
parent reread/validation evidence, unresolved/deferred gaps, terminal-answer
presence, rubric result against the external oracle, total tokens/tools/time,
and all incomplete reasons. Retain counts/digests only in public receipts.

Mechanism qualification requires all three complex sessions to produce a
validated parent terminal answer within budget and deadline; no stale,
unleased, duplicate, unvalidated, or post-settlement result may mutate state;
and all three negative controls must have zero planner starts/merges/settles.
All six sessions must have complete identity-bound receipts. Any timeout,
missing answer, failed branch, budget mismatch, identity drift, or missing
receipt is `INCOMPLETE` or `FAIL`, never a pass. A pass establishes bounded
operability on these fixtures only. It is not task-value evidence.

## Approval, evidence, and rollback

Source review/preflight, live diagnostic sessions, and any later value study
are separate approval stages. Store safe evidence under `docs/evidence/` and a
screen report under `optimizer/docs/screens/`; private transcripts and child
artifacts stay outside Git. Keep the graph flags dark. A promotion proposal
requires a later value study, a separate human release decision, exact overlay
and source hashes, and a full live-package rollback inventory. On any future
installation failure, restore that inventory and verify all hashes; this
document authorizes no mirror, installation, or default change.

## Readiness gaps

This protocol is not execution-ready. The three complex fixtures and three
fact-lookup negative controls are only described by task class; prompt text,
fixture files/hashes, evidence-family oracles, and source-time cutoffs have
not been authored or admitted. No diagnostic runner version is bound to
enforce the process-group deadline, capture complete branch/lease/settlement
receipts, or redact artifacts. Model/artifact, endpoint fingerprint,
loaded-package hash, context/output settings, and independent fixture-reviewer
identity remain unassigned. The mechanism gate has event-count rules, but the
terminal-answer validation oracle must be frozen per fixture. No numeric
efficacy rubric or non-inferiority margin is defined; that belongs in a
separate value study. Missing any prerequisite blocks sessions.

## Prior evidence (not pooled)

- `optimizer/docs/screens/QWEN35B_PLANNER_DEEP_RESEARCH_EVALUATION_2026-09-04-V3.md`
  — early-stop no-go for its frozen Qwen source/model identity.
- `docs/evidence/G04.md` and
  `optimizer/docs/screens/G04_DEEP_RESEARCH_EVALUATION_2026-09-07.md` —
  mechanism evidence and inconclusive quality comparison.
- `optimizer/docs/screens/PHASE3B_OCCAMY_SCREEN_2026-09-23.md` — integrated
  parent workflow qualification, explicitly a distinct subject.
