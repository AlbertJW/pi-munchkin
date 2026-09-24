# Preregistration: Jina Reader task quality and cost — revision 2 — 2026-09-24

Status: **PROTOCOL DRAFT — NOT EXECUTION-READY; NOT EXECUTED.** This successor
replaces the unexecuted 2026-09-24 Jina draft because that draft set
`JINA_READER=on` in both arms and therefore could not guarantee a direct-only
control. It is not an execution authorization. The 2026-09-10 extraction
screen remains an immutable, narrow retrieval receipt and is not task-quality
evidence.

## Runtime and protocol identity

- Runtime source commit: `632409ddbc12085064f4953b1c1eaec73999ba91`, the latest
  commit containing harness runtime changes in this checkout.
- Runtime source-surface SHA-256:
  `121bd19bf1203f89493c782635b3275bb02e75d4d310d059dabd17c6f827086c`.
- Relevant runtime: `harness/extensions/ketch.ts` and
  `harness/lib/ketch-runtime.ts`. Re-derive their hashes and the source-surface
  hash at preflight. Documentation-only commits do not invalidate this runtime
  pin if those hashes remain identical.
- Protocol identity: `JINA_TASK_QUALITY_COST_REV2`, this versioned document;
  its Git blob identity is recorded in the consolidated runbook after commit.
  Any protocol edit creates a new protocol revision. A runtime behavior change
  requires review and a new protocol revision; never silently rebind it.

## Question and scientifically honest estimand

Estimate the **intent-to-treat effect of enabling the complete `JINA_READER`
feature** in an isolated Pi research session, compared with leaving the flag
off. This includes the treatment's tool-schema/guidance change, explicit
`reader="jina"` selections, and automatic Jina fallback after an eligible
direct Ketch failure. It does **not** isolate the intrinsic quality of Jina
formatting conditional on a Jina fetch. A pure explicit-reader comparison is
not supported by the current implementation: with the flag enabled, a
`reader="ketch"` request can still fall back to Jina. Do not change runtime
code to force that design as part of this closeout.

The study asks whether enabling the feature improves evidence-supported
research answers or lowers total measured task cost on a frozen five-task
corpus. Use Q2, Q3, Q4, Q6, and Q8 from
`optimizer/docs/archive/RESEARCH_EVAL_QUESTIONS_2026-08.md` as candidate task
identifiers, then author a separate execution fixture that freezes exact
prompts, source-time cutoffs, expected evidence families, independent answer
oracles, and allowed-source/citation policy. Those task fixtures do not yet
exist and their identities remain unassigned.

## Paired design and reader exposure

For each task, run one fresh pair in randomized order with the same model,
skill text, retrieval/search backends, tool limits, character caps, session
wall, and other environment. Keep the environment identical except for the
flag:

- **Control:** `JINA_READER=off`. `web_read` has no reader parameter and
  direct Ketch fallback is disabled; this is the guaranteed direct-only arm.
- **Treatment:** `JINA_READER=on`. The model sees the reader parameter and
  Jina guidance. It may omit `reader`/select Ketch, explicitly select Jina, or
  receive automatic Jina fallback after an eligible failed Ketch invocation.

Both arms also set `RESEARCH_LEDGER=off`, `RESEARCH_BUDGET=on`,
`PLAN_GRAPH=off`, and `DEEP_RESEARCH_PLANNING=off`, with
`RESEARCH_WORKFLOW` unset. This supplies the same Ketch-enforced search/read
allowance without ledger-specific schema or prompt additions. The five reads
are allowance units per request batch: exact repeated URLs inside one batch
are counted once, but a later call for the same URL consumes another unit.
Do not describe this as a global unique-URL quota.

Schema and prompt differences are intentional parts of the full-feature
treatment, not confounds to remove. Freeze and report their exact rendered
tool schema and guidance digests. Do not pool rows based on actual selected
reader; that would condition on a post-treatment choice.

For every `web_read` call retain private, reviewable event metadata and
publish only aggregates classified as: no read; control Ketch; treatment
Ketch-only; explicit Jina; Ketch-then-Jina fallback; or failed/aborted. The
model's requested reader is available from its tool-call arguments; the
effective reader and fallback flag are returned in tool-result details and
effective-reader telemetry. The existing read telemetry does not itself
provide all these fields in one row, so the future runner must bind the tool
call and result by call identity. Missing or unmatched exposure receipts make
that cell incomplete.

## Budgets, retries, and cost

Use the same 3-search/5-source-read-unit ceiling, `max_chars=5,000` unless
the frozen task requires a lower shared cap, 15-minute session wall,
`KETCH_TIMEOUT_MS=30,000`, `KETCH_BROAD_TIMEOUT_MS=45,000`, and
`KETCH_READ_TIMEOUT_MS=60,000`. Freeze all other relevant environment values
and use one serving slot at a time. The 60-second read deadline is shared by
direct Ketch and its optional fallback; the fallback consumes the remaining
time rather than receiving a fresh deadline.

The harness reserves/charges source-read allowance before retrieval. A
Ketch-then-Jina fallback is one requested read unit but at least two Ketch
subprocess invocations. Report both allowance units and actual top-level
invocation counts; include fallback and repeated model tool calls in total
cost. No study-level retries or replacement sessions are allowed. A failed,
truncated, aborted, timed-out, or malformed cell stays in the cohort with its
outcome and costs; it is never discarded or rerun to obtain a clean row.
The current adapter reports total read duration and fallback outcome, not
separate per-invocation timings or any hidden retries inside the Ketch binary.
Accordingly, this study can compare aggregate feature cost (tokens, total
read/tool invocations, wall time) but cannot claim exact per-backend latency or
hidden-network-retry cost. If those are required, execution remains blocked
pending reviewed instrumentation and a new runtime/protocol revision.

## Outcomes and provisional rule

Use an independent blinded judge with randomized answer order. Report
correctness, evidence-family coverage, directness, material-claim support,
citation identity, conflict handling, and uncertainty. Current rubric
dimensions have no agreed numeric scale, weights, critical-error definition,
or adjudication procedure; those are execution blockers and must be frozen
before the final manifest and any session.

Report per task and arm: completion and failure class; requested/effective
reader exposure; fallback and invocation counts; search/read units; model
tokens from provider receipts (estimates separate); tool calls; latency and
total wall time; truncation; supported/unsupported material claims; and the
blinded score. Public receipts contain only counts, hashes, and reason
classes—no prompts, answers, URLs, quotes, or page text.

The prior draft's directional thresholds are not yet an executable
non-inferiority rule: a numeric rubric, margin by outcome, critical-error
policy, and handling of judge ties are unbound. Do not treat “four of five
pairs” or a 10% token threshold alone as validated. Freeze those definitions
and task oracles in a separately reviewed manifest. Any incomplete cell,
source/model identity mismatch, leakage, overrun, or unbound reader exposure
prevents a qualified value conclusion; retain the row and stop rather than
silently exclude it.

## Readiness, configuration, and approvals

This protocol is **prepared but not execution-ready**. Missing items are:

1. Frozen prompt/source/oracle fixtures and hashes for all five tasks.
2. Numeric rubric, quality non-inferiority margin, critical-error policy, and
   judge-tie handling.
3. A dedicated runner identity that captures exact tool-call arguments,
   matching result details, actual exposure, process invocations, and safe
   per-cell receipts. The existing
   `harness/scripts/jina-reader-live-probe.mjs` is an extraction-only probe,
   not that task runner.
4. Current served model/artifact, endpoint fingerprint, context/output
   configuration, loaded package/surface hash, and independent judge
   identity/availability. All are unassigned until a separately approved
   preflight.

`JINA_READER` is present in the runtime but absent from
`optimizer/prompt-lab/configs/schema.json`. This study is defined as a
standalone isolated Pi-session study that sets the environment flag directly;
the optimizer schema is not needed. Do not add schema support or invoke
optimizer tools. If a future design depends on optimizer campaign execution,
it is blocked by the optimizer mothball and requires a separate explicit
restart decision, schema review, and new protocol.

Preflight, session execution, result review, and any opt-in installation each
require separate approval. The next requested approval can cover fixture,
rubric, runner, model, and judge preparation only; it does not authorize model
sessions. Store safe reports under `docs/evidence/` and
`optimizer/docs/screens/`; keep raw artifacts private/outside Git. Promotion
would still require a separate release decision, inventory, exact file hashes,
enabled/disabled smoke sessions, and verified rollback. `JINA_READER` remains
off by default.

## Historical predecessor

`PREREG_JINA_READER_TASK_QUALITY_COST_2026-09-24.md` is retained as the
superseded pre-execution draft. Its both-arms-enabled reader selection is not a
valid direct-only control; no sessions were run under it.
