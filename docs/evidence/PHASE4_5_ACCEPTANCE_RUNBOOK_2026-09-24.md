# Phase 4–5 feature acceptance and release runbook — 2026-09-24

Status: **DOCUMENTATION CLOSEOUT; NO EXECUTION AUTHORIZED.** This runbook
covers feature acceptance and release boundaries from the original harness
handover. It is separate from the old upgrade plan's optimizer Packages 4
(optimizer durability/execution qualification) and 5 (optimizer verification
and release review), which remain mothballed under
`optimizer/docs/MOTHBALLED_2026-09-16.md`.

## Programme state

The 2026-09-23 receipts establish Phase 3A context admission and Phase 3B
parent-led research as installed live overlays, qualified on Occamy for their
respective frozen safety/operability cases, and still opt-in. The current
source-surface hash is `121bd19bf1203f89493c782635b3275bb02e75d4d310d059dabd17c6f827086c`;
current Git contents of each Phase 3A and Phase 3B selected runtime file match
the respective qualified candidate commit. This does not mean either feature
is on by default, that all models are qualified, or that either feature
improves answer quality or cost. Historical installed-file and rollback
receipts remain authoritative for the installation at the time recorded.

## Per-feature acceptance matrix

| Feature | Current state and prerequisite identity | Control / treatment and measures | Pass, fail, and incomplete | Approval, evidence, promotion, rollback |
| --- | --- | --- | --- | --- |
| **Jina Reader** | Implemented, opt-in, extraction mechanism qualified only. 2026-09-10 screen: 4/4 term coverage vs direct Ketch 3/4, one timing sample; no answer-quality evidence. Current successor: `PREREG_JINA_READER_TASK_QUALITY_COST_REV2_2026-09-24.md`; protocol draft, not execution-ready. | Full-feature intent-to-treat: `JINA_READER=off` direct-only control vs `on` treatment. Treatment includes changed tool schema/guidance, explicit Jina selection, and automatic fallback after eligible Ketch failure. Log requested/effective reader and fallback per call. Both arms set `RESEARCH_LEDGER=off`, `RESEARCH_BUDGET=on`, graph flags off, and `RESEARCH_WORKFLOW` unset. Same 3-search/5-read-unit allowance (exact duplicate URLs dedupe only within one call; later repeat calls cost another unit), 15-minute session, Ketch 30s quick/45s broad/60s read bounds. Compare blinded task quality, citation support, tokens, allowance units, invocations, tool calls, and wall time. | Keep every cell, including failed/aborted/fallback cells. No study-level retries. A fallback is one read allowance unit but at least two top-level invocations; include it in costs. Exact per-invocation timings and hidden Ketch-binary retries are unavailable, so only aggregate feature cost is measurable. Full task fixtures, numerical rubric/margins, judge identity, and runner are missing; a pure explicit-reader comparison needs runtime changes and is out of scope. | Standalone Pi environment flags require no optimizer schema support. JINA_READER is absent from the mothballed optimizer config schema; do not add it or invoke optimizer. Separate approval for fixture/runner/judge preparation, then later session execution/review. Keep off absent separate release approval. |
| **Research ledger** | Implemented, opt-in; integrated with graph/parent research. Run 3 incomplete, Run 4 superseded/unexecuted; Phase 3B does not isolate value. Successor `PREREG_RESEARCH_LEDGER_CURRENT_VALUE_2026-09-24.md` is a protocol draft, not execution-ready. | Paired Q2/Q3/Q4/Q6/Q8: `RESEARCH_BUDGET=on` control vs `RESEARCH_LEDGER=on` treatment (`RESEARCH_BUDGET=off`); source behavior makes both use same 3-search/5-read-unit wall. Exact duplicate URLs dedupe inside each web_read call; repeated later calls consume units in both arms, and treatment cache hits are charged. Explicitly disable graph/planning and leave `RESEARCH_WORKFLOW` unset. Same 15-minute session and 30s/45s/60s Ketch bounds. | All five complete identity-bound pairs; retain failures. Provisional win-count/token thresholds are not an executable numeric non-inferiority rule. Fixtures/oracles, numeric rubric/judge, runner identity, model, and serving pins are missing. Do not execute before successor manifest resolves them. | Preflight, paired sessions, review, and any promotion separately approved. Evidence in common destinations; private ledger/transcripts outside Git. Keep opt-in. |
| **Hierarchical planner** | Existing graph/delegation implementation; flags remain off. Historical Qwen V3 stopped at 0/3 settlements; G04 inconclusive. Distinct from Phase 3B. Successor `PREREG_HIERARCHICAL_PLANNER_CURRENT_DIAGNOSTIC_2026-09-24.md` is a protocol draft, not execution-ready. | Mechanism diagnostic: three complex candidate sessions plus three simple lookup negative controls; candidate flags `PLAN_GRAPH=on`, `DEEP_RESEARCH_PLANNING=on`, `RESEARCH_LEDGER=on`; keep `RESEARCH_WORKFLOW` unset. Enforce 10-minute wall in the future runner (the old graph workflow itself does not provide that guarantee); pin 30s/45s/60s Ketch timeouts. | Require all three complex answers validated/settled within limits and zero planner starts/merges/settles in all negative controls. Keep every failed/incomplete session. Fixtures/oracles, execution runner/deadline identity, model/serving pins, and answer-validation oracle are missing; no execution-ready manifest exists. Pass would establish mechanism only. | Preflight and sessions separately approved; value study and release decision later. Preserve historical outcomes. No promotion from diagnostic pass alone. |
| **Vision / SAM** | Observation/cache/geometry/SAM boundaries exist; `VISION=off`, grounding unset. Existing foundation, model receipts, tests, and 2026-09-11 five-case preregistration are audited in `docs/evidence/VISION_STATUS_AUDIT_2026-09-24.md`. No rebuild is indicated. | Keep model arms separate. Existing case map covers exact cache reuse, uncertainty, action invalidation, model-switch invalidation, and harness-checked SAM geometry. Bind current source, renderer/fixture, SAM executable/checkpoint, model artifact, and serving identity at a new approved preflight if needed. | Do not rerun historical manifests. Existing Qwen negative and LFM one-case positive remain model-specific. Any new revision must pass every declared case with valid oracle-bound geometry and no stale-target authority; missing SAM/runtime or model receipts are incomplete. Mechanism pass is not UI-task benefit. | Static applicability audit needs no execution approval; each capture/SAM/model stage later needs separate explicit approval. Store safe reports in common destinations, no raw screenshots or model output in public receipts. Keep flags off; no promotion without a distinct value study and human decision. |
| **Phase 3A context admission** | **Installed, Occamy safety/recovery qualified, opt-in, not benefit-qualified.** Frozen source `632409d`; source surface `121bd19b…`; current selected source files unchanged. Report and evidence: `optimizer/docs/screens/PHASE3A_OCCAMY_SCREEN_2026-09-23.md`, `docs/evidence/PHASE3A_LIVE_INVENTORY_2026-09-23.json`, and linked Occamy receipts. | Original 11-case safety screen: two live transport checks plus deterministic fault-injection cases; post-install enabled/disabled fresh Pi smokes. Measures are pre-dispatch decisions, provenance, epochs, reservations, recovery, and flag-off compatibility. | 11/11 cases and all six verification stages passed on the frozen candidate; installed overlay and 115 nonselected-file preservation verified by receipt. The result is scoped to safety/operability on Occamy; no efficacy conclusion. | Already promoted as opt-in. Keep `CONTEXT_ADMISSION` default off. Future source changes require a new safety review; rollback from the recorded inventory `/Users/Albert.Wessels/LLM/phase3a-live-backup-20260923` and verify hashes. |
| **Phase 3B parent-led research** | **Installed, Occamy safety/operability qualified, opt-in, not benefit-qualified.** Frozen source `0ae16e7`; source surface `8a9e5e7d…`; current selected source files unchanged. Report and inventory: `optimizer/docs/screens/PHASE3B_OCCAMY_SCREEN_2026-09-23.md`, `docs/evidence/PHASE3B_OCCAMY_PROMOTION_2026-09-23.json`. | Ten frozen cases: direct parent flow, accounting, atomic failure, concurrency, deadline/extension, fresh-process recovery, child leases, terminal delivery, compatibility rebuild, and legacy isolation. Occamy live case plus deterministic faults; no pooling with Qwen's incomplete case. | 10/10 cases, six verification stages, and reported fresh parent-mode/legacy-isolation checks passed for the frozen candidate. This proves bounded operation, not comparative research quality or model-general behavior. | Already promoted with four parent-research flags still opt-in. Keep optimizer mothballed. Rollback using receipt-linked backup `/Users/Albert.Wessels/LLM/phase3b-live-backup-20260923` and verify the captured inventory before any restoration. |

## Shared evidence and integrity rules

- Every future execution receipt binds source commit/surface hash, selected-file
  hashes, loaded package/surface hash, fixture and runner digests, exact flags,
  model artifact and serving identity, context/output limits, run identity,
  and actual treatment exposure. Friendly model names alone are insufficient.
- Runtime source identity and protocol identity are separate. Current runtime
  source pin is commit `632409ddbc12085064f4953b1c1eaec73999ba91` with surface
  SHA-256 `121bd19bf1203f89493c782635b3275bb02e75d4d310d059dabd17c6f827086c`;
  the three successor protocols have distinct revision IDs and Git blob
  identities. A documentation-only commit does not invalidate
  the runtime pin when the runtime surface/relevant-file hashes are unchanged.
  Any behavior-changing source drift requires review and a new protocol
  revision before sessions.
- Protocol identities (Git blob SHA-1, independent of the runtime source
  surface): `JINA_TASK_QUALITY_COST_REV2` —
  `c84577c781b74dde99f34ce12da6d9c7ab02ca86`;
  `RESEARCH_LEDGER_CURRENT_VALUE_REV1` —
  `9f2e8bfef649f354455a76c36a975fa1979b43f1`;
  `HIERARCHICAL_PLANNER_DIAGNOSTIC_REV1` —
  `ce6662d5b2f410baad5fac4e20baeed9246ae2ef`. These identify the exact
  protocol text committed by this closeout. Editing a protocol changes its
  identity even when the runtime source hash is unchanged.
- The candidate register lists Jina, but `JINA_READER` is absent from
  `optimizer/prompt-lab/configs/schema.json`. No optimizer schema change is
  required for the planned direct Pi-session study, which sets the environment
  flag itself. Optimizer execution remains mothballed; do not use it as the
  study runner.
- The Jina, ledger, and planner successor documents are prepared protocols,
  not frozen execution manifests. Their task fixture hashes, complete numeric
  rubrics/non-inferiority rules, runner versions, model/serving identities,
  and independent judging arrangements remain unresolved as called out in
  each protocol. No inference session is ready to start.
- `PASS`, `FAIL`, and `INCOMPLETE` are distinct. Missing identity, incomplete
  cohort, missing judge, timeout, absent output, or missing receipt is never a
  pass. Failed and voided results remain in history and cannot be pooled across
  source, fixture, model, or serving changes.
- Public evidence records safe counts, digests, and reason classes only.
  Prompts, model answers, URLs, quotes, source bodies, screenshots, credentials,
  and private ledgers remain outside Git.
- Promotion means reviewed installation for explicit opt-in only. It does not
  change defaults or establish general benefit. Before any install, capture and
  verify the full live inventory and rollback copy; afterward verify selected
  hashes, unchanged nonselected files, loaded surface, and fresh isolated
  smokes. Restore and verify rollback on any installation or smoke failure.
- The optimizer remains mothballed. Its retained offline shutdown/config
  checks are not optimizer qualification and must not be expanded into a
  campaign under this runbook.
- Queued Hashline 2.0 work is an independent track. This feature-acceptance
  closeout neither implements it nor makes it a prerequisite; future
  experimental execution remains separately scoped and approved.

## Current next approval

The next proposed approval is **non-inference Jina study-readiness preparation**:
materialize the five task/source/oracle fixtures, settle the numeric rubric
and non-inferiority policy, define the runner's per-call exposure/cost receipts,
and bind a candidate model and independent judge at a zero-session preflight.
This does not authorize model sessions. Sessions, result review, and any
installation/default decision require later separate approvals. No execution
is authorized by this documentation closeout.
