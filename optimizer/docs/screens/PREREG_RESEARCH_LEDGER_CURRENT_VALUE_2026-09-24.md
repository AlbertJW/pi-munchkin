# Preregistration: current research-ledger value comparison — 2026-09-24

Status: **PROTOCOL DRAFT — NOT EXECUTION-READY; NOT EXECUTED.** The 2026-09-02 Run 4 document is
superseded as an execution protocol: its source/model/surface pin is stale and
it was never run. It remains preserved as history and is not evidence. Run 3
remains incomplete with one timeout and no independent synthesis judge. The
Phase 3B Occamy screen qualified the integrated parent workflow, not the
isolated value of `RESEARCH_LEDGER`.

## Question and binding

Does the current parent-verified ledger improve evidence-supported answer
quality or reduce unsupported/unattributed claims enough to justify its
additional context and tool cost, compared with enforcing the same research
budget without the ledger?

The runtime source pin is commit
`632409ddbc12085064f4953b1c1eaec73999ba91` and source-surface SHA-256
`121bd19bf1203f89493c782635b3275bb02e75d4d310d059dabd17c6f827086c`.
Commit `3989534` and this closeout contain documentation changes only; such
commits do not invalidate the runtime pin while the source-surface and
relevant runtime-file hashes remain identical. Protocol identity is
`RESEARCH_LEDGER_CURRENT_VALUE_REV1`, this versioned document; its Git blob
identity is recorded in the consolidated runbook after commit. A protocol
change creates a new revision. Runtime behavior changes require re-review and
a new protocol revision. Before execution, derive current source/test/fixture
digests, loaded package hash,
served model/artifact, endpoint fingerprint, context/output settings, and
actual flags. Model and serving identity remain unassigned until a separately
approved preflight. Any source, model, fixture, or serving change needs a new
revision.

## Arms and tasks

Use the same candidate Q2, Q3, Q4, Q6, and Q8 questions from
`optimizer/docs/archive/RESEARCH_EVAL_QUESTIONS_2026-08.md`, with frozen
source-time cutoffs, materialized prompt text, evidence-family oracles, and
randomized arm order within each pair. The archived numbered prompts are not
the frozen execution fixtures. Run one fresh isolated A/B pair per question,
identical model, skill, tools, token/output settings, and 15-minute session
wall. Pin `KETCH_TIMEOUT_MS=30,000`, `KETCH_BROAD_TIMEOUT_MS=45,000`, and
`KETCH_READ_TIMEOUT_MS=60,000`; use one serving slot at a time.

- **A — budget-only control:** `RESEARCH_LEDGER=off`, `RESEARCH_BUDGET=on`.
- **B — ledger treatment:** `RESEARCH_LEDGER=on`, `RESEARCH_BUDGET=off`;
  ledger-on must enforce the same non-graph 3-search/5-read-unit wall.

Explicitly set `PLAN_GRAPH=off` and `DEEP_RESEARCH_PLANNING=off`, and leave
`RESEARCH_WORKFLOW` unset in both arms. This isolates the ledger effect from
graph and parent-workflow behavior. Confirm before dispatch that these
settings select the non-graph path, treatment has ledger tools/cache/footer,
control has the budget-only wall without those additions, and both enforce
the same 3/5 budget. Read units are counted per call as the exact distinct
URLs in that call; repeating a URL in a later call consumes another unit in
both arms. A treatment cache hit occurs after its read allowance is charged.
The changed tool schema and guidance are part of the ledger treatment and
their context cost must be included.

## Outcomes and thresholds

An independent blinded judge scores correctness, directness, attribution
honesty, evidence coverage, conflict handling, and uncertainty. Ledger
presence, note count, and tool-call count are not quality points. A malformed
judge or unavailable independent judge makes the quality outcome
`UNAVAILABLE`, never a substitute self-judgment.

Report per pair: completion; pairwise quality verdict and rubric; supported
material-claim/citation errors; searches, read allowance units, validated notes,
rejections by reason class, corrections and cache hits; provider-reported and
estimated token counts separately; tool calls; wall time; and incomplete
causes. Public receipts contain only safe aggregates and digests, not prompts,
answers, URLs, quotes, or page text.

The result supports a later scoped adoption proposal only when all five pairs
are complete and bound, B is non-inferior in at least four pairs with no
critical correctness or attribution regression, B does not increase
incomplete answers, and it demonstrates either a better blinded quality
verdict in at least three non-tied pairs or at least 10% lower median total
input tokens without exceeding the shared research envelope. Treat the small
cohort as directional, not statistical proof. Any missing pair, overrun,
identity mismatch, accepted note lacking validated source support, raw-data
leak, or incomplete telemetry blocks qualification. Never retry or pool a
failed cell into this revision.

## Readiness gaps

This protocol is not execution-ready. The five exact prompts, source snapshots,
source-time cutoffs, and independent expected-evidence oracles have not been
materialized or hashed. The score dimensions have no frozen numeric scale,
weights, critical-error rule, or judge-tie adjudication; the pair threshold
alone does not define a numeric non-inferiority margin. No execution-runner
version or independent judge endpoint/model is bound, and the task
model/serving identity, loaded surface, context/output settings, and artifact
permissions must be frozen at a separately approved preflight. Preflight must
also demonstrate the two flag combinations instantiate the intended
non-graph budget-only and ledger surfaces. Missing any item blocks sessions;
do not fill gaps after seeing outputs.

## Approval and evidence

Preflight, paired-session execution, and post-run review each require separate
explicit approval. Store safe receipts under `docs/evidence/` and the screen
report under `optimizer/docs/screens/`; private transcripts and ledger files
remain outside Git. The flag remains opt-in. Any later promotion requires a
separate source review, a pre-install inventory/rollback receipt, exact
selected-file hashes, and fresh enabled/disabled sessions. This preregistration
does not authorize execution, mirroring, installation, or a default change.

## Historical references

- Run 3 preregistration and incomplete audit:
  `optimizer/docs/screens/PREREG_QWEN35B_RESEARCH_LEDGER_RUN3_2026-09-02.md` and
  `optimizer/docs/screens/QWEN35B_RESEARCH_LEDGER_RUN3_AUDIT_2026-09-02.md`.
- Superseded, unexecuted Run 4:
  `optimizer/docs/screens/PREREG_QWEN35B_RESEARCH_LEDGER_RUN4_2026-09-02.md`.
- Current integrated parent qualification:
  `optimizer/docs/screens/PHASE3B_OCCAMY_SCREEN_2026-09-23.md`.
