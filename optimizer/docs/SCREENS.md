# Screen index

Every preregistration in `screens/` and the audit that reports its result. A screen with no
audit either never ran or was superseded before it ran -- that is a fact about the programme,
not a gap in the record, so it is shown rather than hidden.

Records here are **append-only**. A verdict is never edited to match a later belief; a later
screen supersedes an earlier one by name. See
[`MEASUREMENT_METHODOLOGY_2026-07.md`](MEASUREMENT_METHODOLOGY_2026-07.md) for why, and
[`../../docs/SURFACE_BOUNDARIES.md`](../../docs/SURFACE_BOUNDARIES.md) for which surface each
result may be pooled with.

| screen | prereg | audit | recorded outcome |
|---|---|---|---|
| `C25_4B_POWERED` | [prereg](screens/PREREG_C25_4B_POWERED_2026-07-28.md) | _none_ | Committed before any session of this round ran |
| `C50_RETRYTRAP` | [prereg](screens/PREREG_C50_RETRYTRAP_2026-07-29.md) | _none_ | Committed before any session of this round ran |
| `FAILURE_EPISODE_BASELINE` | [prereg](screens/PREREG_FAILURE_EPISODE_BASELINE_2026-08.md) | _none_ | SUPERSEDED 2026-08-25 by PREREG_SEMANTIC_LOOP_SCREEN_2026-08.md |
| `FIXTURE_BAND` | [prereg](screens/PREREG_FIXTURE_BAND_2026-08-11.md) | _none_ | mean gate-pass rate per fixture |
| `HIERARCHICAL_PLANNER_SCREEN` | [prereg](screens/PREREG_HIERARCHICAL_PLANNER_SCREEN_2026-08.md) | _none_ | STATUS: BLOCKED DRAFT — NO SESSION MAY START |
| `JINA_READER_CURRENT` | [prereg](screens/PREREG_JINA_READER_CURRENT_2026-09-10.md) | [audit](screens/JINA_READER_CURRENT_AUDIT_2026-09-10.md) | CLEAN NARROW RETRIEVAL RECEIPT — source identity held; 4/4 required terms versus direct Ketch 3/4 in one fixed-source observation; no adoption claim |
| `QWEN35B_BASELINE` | [prereg](screens/PREREG_QWEN35B_BASELINE_2026-09-01.md) | [audit](screens/QWEN35B_BASELINE_AUDIT_2026-09-01.md) | The explicitly approved, current-surface screen ran one base replicate for parens, equil, and bigdata under invocation 96faf8 |
| `G03_QWEN35B_REPRESENTATIVE_BASELINE` | [prereg](screens/PREREG_G03_QWEN35B_REPRESENTATIVE_BASELINE_2026-09-07.md) | _none_ | Prepared against the frozen twelve-case pack; execution pending Pi/llama-swap and the research adapter |
| `GREP_FIND_TOOLS` | [prereg](screens/PREREG_GREP_FIND_TOOLS_2026-09-09.md) | _none_ | STATUS: PREPARED. Activating pi's native grep/find tools in the default surface; mechanism screen verifies they are called before powered trial |
| `QWEN35B_GREP_FIND_CURRENT` | [prereg](screens/PREREG_QWEN35B_GREP_FIND_CURRENT_2026-09-10.md) | [audit](screens/QWEN35B_GREP_FIND_CURRENT_AUDIT_2026-09-10.md) | INCOMPLETE / UNRESOLVED — both arms made no tool call and missed the final oracle; treatment active surface was not independently captured |
| `QWEN35B_BASELINE_REPLACEMENT` | [prereg](screens/PREREG_QWEN35B_BASELINE_REPLACEMENT_2026-08-27.md) | _none_ | This replaces PREREG_QWEN35B_BASELINE_SHADOW_2026-08-27.md, whose partial rows are permanently non-authoritative and must not be resumed or pooled |
| `QWEN35B_BASELINE_SHADOW` | [prereg](screens/PREREG_QWEN35B_BASELINE_SHADOW_2026-08-27.md) | _none_ | Prepared before inference |
| `QWEN35B_BASELINE_TIMEOUT_RETRY` | [prereg](screens/PREREG_QWEN35B_BASELINE_TIMEOUT_RETRY_2026-09-01.md) | [audit](screens/QWEN35B_BASELINE_TIMEOUT_RETRY_AUDIT_2026-09-01.md) | The explicitly approved timeout-only replacement run completed one base replicate for parens, equil, and bigdata under invocation 3c3dd2 with PI_TIMEO |
| `QWEN35B_BASH_OUTPUT_GUARD` | [prereg](screens/PREREG_QWEN35B_BASH_OUTPUT_GUARD_2026-09-02.md) | [audit](screens/QWEN35B_BASH_OUTPUT_GUARD_AUDIT_2026-09-02.md) | CLEAN MECHANISM RECEIPT |
| `QWEN35B_BASH_OUTPUT_GUARD_PAIRED` | [prereg](screens/PREREG_QWEN35B_BASH_OUTPUT_GUARD_PAIRED_2026-09-02.md) | [audit](screens/QWEN35B_BASH_OUTPUT_GUARD_PAIRED_AUDIT_2026-09-02.md) | CLEAN |
| `QWEN35B_BASH_OUTPUT_GUARD_CURRENT` | [prereg](screens/PREREG_QWEN35B_BASH_OUTPUT_GUARD_CURRENT_2026-09-10.md) | [audit](screens/QWEN35B_BASH_OUTPUT_GUARD_CURRENT_AUDIT_2026-09-10.md) | INCOMPLETE / UNRESOLVED — noisy command duplicated in both arms; treatment withheld twice, so the one-command recovery rule failed |
| `LFM25_VL_3B_VISION_REAL_UI` | [prereg](screens/PREREG_LFM25_VL_3B_VISION_REAL_UI_2026-09-10.md) | [audit](screens/LFM25_VL_3B_VISION_REAL_UI_AUDIT_2026-09-10.md) | INVALID DIAGNOSTIC — runner source was absent from V1 approval binding; superseded by separately frozen V2 |
| `LFM25_VL_3B_VISION_REAL_UI_V2` | [prereg](screens/PREREG_LFM25_VL_3B_VISION_REAL_UI_V2_2026-09-10.md) | [audit](screens/LFM25_VL_3B_VISION_REAL_UI_V2_AUDIT_2026-09-10.md) | CLEAN NARROW PROTOCOL / SEMANTIC RECEIPT — one bound 3B VLM image-answer case; no adoption claim |
| `QWEN_VISION_REAL_UI` | [frozen screen](screens/QWEN_VISION_REAL_UI_2026-09-10.md) | [result](screens/QWEN_VISION_REAL_UI_2026-09-10.md) | VALID NEGATIVE — transport/geometry bound, semantic coverage 0/1; do not rerun this screen |
| `VISION_GROUNDING_QUALIFICATION` | [prereg](screens/PREREG_VISION_GROUNDING_QUALIFICATION_2026-09-11.md) | _none_ | STATUS: PREPARED. Five-case study (cache, uncertainty, action, model-switch, harness-checked SAM) against a real installed SAM 2.1 Tiny runner; no session may start without explicit per-stage approval |
| `QWEN35B_CONTEXT_ADMISSION_CURRENT_V1` | [prereg](screens/PREREG_QWEN35B_CONTEXT_ADMISSION_CURRENT_2026-09-10.md) | [audit](screens/QWEN35B_CONTEXT_ADMISSION_CURRENT_V1_AUDIT_2026-09-10.md) | INVALID LAUNCHER FAILURE — zero forwarded requests; superseded by separately frozen V2 |
| `QWEN35B_CONTEXT_ADMISSION_CURRENT_V2` | [prereg](screens/PREREG_QWEN35B_CONTEXT_ADMISSION_CURRENT_V2_2026-09-10.md) | [audit](screens/QWEN35B_CONTEXT_ADMISSION_CURRENT_V2_AUDIT_2026-09-10.md) | INCOMPLETE / UNRESOLVED — pre-dispatch treatment exposed, but normal Pi completion failed; do not rerun V2 |
| `QWEN35B_CONTEXT_ADMISSION_CURRENT_V3` | [prereg](screens/PREREG_QWEN35B_CONTEXT_ADMISSION_CURRENT_V3_2026-09-10.md) | [audit](screens/QWEN35B_CONTEXT_ADMISSION_CURRENT_V3_AUDIT_2026-09-10.md) | CLEAN NARROW MECHANISM / SAFETY RECEIPT — normal admission and oversized pre-dispatch refusal; no adoption claim |
| `QWEN35B_CONTEXT_EPOCHS` | [prereg](screens/PREREG_QWEN35B_CONTEXT_EPOCHS_2026-09-02.md) | [audit](screens/QWEN35B_CONTEXT_EPOCHS_AUDIT_2026-09-02.md) | Classification: VALID MECHANISM / REACHABILITY RECEIPT ONLY |
| `QWEN35B_CONTEXT_EPOCH_SWITCH` | [prereg](screens/PREREG_QWEN35B_CONTEXT_EPOCH_SWITCH_2026-09-02.md) | [audit](screens/QWEN35B_CONTEXT_EPOCH_SWITCH_AUDIT_2026-09-02.md) | CLEAN MECHANISM RECEIPT |
| `QWEN35B_CONTEXT_HANDOFF_ACTIVE_GOAL` | [prereg](screens/PREREG_QWEN35B_CONTEXT_HANDOFF_ACTIVE_GOAL_2026-09-02.md) | [audit](screens/QWEN35B_CONTEXT_HANDOFF_ACTIVE_GOAL_AUDIT_2026-09-02.md) | CLEAN MECHANISM RECEIPT |
| `QWEN35B_CONTEXT_HANDOFF_REARM` | [prereg](screens/PREREG_QWEN35B_CONTEXT_HANDOFF_REARM_2026-09-02.md) | [audit](screens/QWEN35B_CONTEXT_HANDOFF_REARM_AUDIT_2026-09-02.md) | CLEAN MECHANISM RECEIPT |
| `QWEN35B_CONTEXT_HANDOFF_THRESHOLD` | [prereg](screens/PREREG_QWEN35B_CONTEXT_HANDOFF_THRESHOLD_2026-09-02.md) | [audit](screens/QWEN35B_CONTEXT_HANDOFF_THRESHOLD_AUDIT_2026-09-02.md) | Classification: INCOMPLETE MECHANISM PROBE; SOURCE DEFECT IS CONFIRMED |
| `QWEN35B_CONTEXT_HANDOFF_THRESHOLD_V2` | [prereg](screens/PREREG_QWEN35B_CONTEXT_HANDOFF_THRESHOLD_V2_2026-09-02.md) | [audit](screens/QWEN35B_CONTEXT_HANDOFF_THRESHOLD_V2_AUDIT_2026-09-02.md) | Classification: INCOMPLETE MECHANISM PROBE; FAILED CLOSED |
| `QWEN35B_CONTEXT_HANDOFF_THRESHOLD_V3` | [prereg](screens/PREREG_QWEN35B_CONTEXT_HANDOFF_THRESHOLD_V3_2026-09-02.md) | [audit](screens/QWEN35B_CONTEXT_HANDOFF_THRESHOLD_V3_AUDIT_2026-09-02.md) | Classification: INCOMPLETE MECHANISM PROBE; FAILED CLOSED |
| `QWEN35B_CONTEXT_HANDOFF_THRESHOLD_V4` | [prereg](screens/PREREG_QWEN35B_CONTEXT_HANDOFF_THRESHOLD_V4_2026-09-02.md) | [audit](screens/QWEN35B_CONTEXT_HANDOFF_THRESHOLD_V4_AUDIT_2026-09-02.md) | CLEAN MECHANISM RECEIPT |
| `QWEN35B_GOAL_GRAMMAR` | [prereg](screens/PREREG_QWEN35B_GOAL_GRAMMAR_2026-09-02.md) | _none_ | COMPLETED — mechanism/lifecycle smoke only |
| `QWEN35B_GRACEFUL_SHUTDOWN` (2026-09-01, superseded) | [prereg](screens/PREREG_QWEN35B_GRACEFUL_SHUTDOWN_2026-09-01.md) | _none_ | SUPERSEDED by 2026-09-02 version before any session ran |
| `QWEN35B_GRACEFUL_SHUTDOWN` | [prereg](screens/PREREG_QWEN35B_GRACEFUL_SHUTDOWN_2026-09-02.md) | [audit](screens/QWEN35B_GRACEFUL_SHUTDOWN_AUDIT_2026-09-02.md) | INVALID / lifecycle incomplete |
| `QWEN35B_GRACEFUL_SHUTDOWN_FOREGROUND` | [prereg](screens/PREREG_QWEN35B_GRACEFUL_SHUTDOWN_FOREGROUND_2026-09-02.md) | [audit](screens/QWEN35B_GRACEFUL_SHUTDOWN_FOREGROUND_AUDIT_2026-09-02.md) | Classification: VALID INFRASTRUCTURE MECHANISM RECEIPT ONLY |
| `QWEN35B_GRACEFUL_SHUTDOWN_V2` | [prereg](screens/PREREG_QWEN35B_GRACEFUL_SHUTDOWN_V2_2026-09-02.md) | [audit](screens/QWEN35B_GRACEFUL_SHUTDOWN_V2_AUDIT_2026-09-02.md) | Classification: INCOMPLETE INFRASTRUCTURE SCREEN |
| `QWEN35B_PLANNER_COMPLETION_V7` | [prereg](screens/PREREG_QWEN35B_PLANNER_COMPLETION_V7_2026-09-03.md) | [audit](screens/QWEN35B_PLANNER_COMPLETION_V7_AUDIT_2026-09-03.md) | INCOMPLETE MECHANISM — STOPPED AFTER TWO CANDIDATE SESSIONS |
| `QWEN35B_PLANNER_COMPLETION_V8` | [prereg](screens/PREREG_QWEN35B_PLANNER_COMPLETION_V8_2026-09-03.md) | [audit](screens/QWEN35B_PLANNER_COMPLETION_V8_AUDIT_2026-09-03.md) | INCOMPLETE MECHANISM — CANDIDATE STOPPED; CONTROL NOT RUN |
| `QWEN35B_PLANNER_MECHANISM_SMOKE` | [prereg](screens/PREREG_QWEN35B_PLANNER_MECHANISM_SMOKE_2026-09-02.md) | _none_ | EXECUTED — invalid/incomplete 2026-09-02 |
| `QWEN35B_PLANNER_MECHANISM_V2` | [prereg](screens/PREREG_QWEN35B_PLANNER_MECHANISM_V2_2026-09-02.md) | _none_ | IN PROGRESS — ONE QUARANTINED SESSION OBSERVED; GATE INCOMPLETE |
| `QWEN35B_PLANNER_MECHANISM_V3` | [prereg](screens/PREREG_QWEN35B_PLANNER_MECHANISM_V3_2026-09-03.md) | _none_ | PREPARED — NO QUALIFYING MODEL SCREEN UNDER THIS BOUNDARY |
| `QWEN35B_PLANNER_MECHANISM_V4` | [prereg](screens/PREREG_QWEN35B_PLANNER_MECHANISM_V4_2026-09-03.md) | _none_ | PREPARED — NO QUALIFYING MODEL SCREEN UNDER THIS BOUNDARY |
| `QWEN35B_PLANNER_MECHANISM_V5` | [prereg](screens/PREREG_QWEN35B_PLANNER_MECHANISM_V5_2026-09-03.md) | [audit](screens/QWEN35B_PLANNER_MECHANISM_V5_AUDIT_2026-09-03.md) | INCOMPLETE MECHANISM — PREREGISTERED GATE NOT MET |
| `QWEN35B_PLANNER_MECHANISM_V6` | [prereg](screens/PREREG_QWEN35B_PLANNER_MECHANISM_V6_2026-09-03.md) | [audit](screens/QWEN35B_PLANNER_MECHANISM_V6_AUDIT_2026-09-03.md) | INCOMPLETE MECHANISM OBSERVATION — NO QUALIFYING SCREEN |
| `QWEN35B_RESEARCH_LEDGER_RUN3` | [prereg](screens/PREREG_QWEN35B_RESEARCH_LEDGER_RUN3_2026-09-02.md) | [audit](screens/QWEN35B_RESEARCH_LEDGER_RUN3_AUDIT_2026-09-02.md) | INCOMPLETE |
| `QWEN35B_RESEARCH_LEDGER_RUN4` | [prereg](screens/PREREG_QWEN35B_RESEARCH_LEDGER_RUN4_2026-09-02.md) | _none_ | PREPARED — NO MODEL SESSIONS STARTED |
| `QWEN35B_SEMANTIC_LOOP_DELIVERY` | [prereg](screens/PREREG_QWEN35B_SEMANTIC_LOOP_DELIVERY_2026-09-02.md) | _none_ | EXECUTED — incomplete/voided 2026-09-02 |
| `QWEN35B_SEMANTIC_LOOP_MECHANISM` | [prereg](screens/PREREG_QWEN35B_SEMANTIC_LOOP_MECHANISM_2026-09-02.md) | [audit](screens/QWEN35B_SEMANTIC_LOOP_MECHANISM_AUDIT_2026-09-02.md) | Classification: MECHANISM SCREEN FAILED / INCOMPLETE |
| `QWEN35B_SEMANTIC_LOOP_SHUTDOWN_RETEST` | [prereg](screens/PREREG_QWEN35B_SEMANTIC_LOOP_SHUTDOWN_RETEST_2026-09-02.md) | _none_ | EXECUTED — lifecycle characterization passed 2026-09-02 |
| `RUN3_4B` | [prereg](screens/PREREG_RUN3_4B_2026-08-06.md) | _none_ | Primary — deterministic, no judge: |
| `SEMANTIC_LOOP_SCREEN` | [prereg](screens/PREREG_SEMANTIC_LOOP_SCREEN_2026-08.md) | _none_ | STATUS: PREPARED. No stage of this study may be started without Albert's explicit, > per-stage approval |

_52 screens; 29 carry separate audit files, and the current real-UI vision
screen records its frozen protocol and result together. Updated 2026-09-11._

## Current candidate roster (2026-09-10)

The 2026-09-09 closure was premature and is superseded. See
[`QWEN_EXPERIMENTAL_CANDIDATE_REGISTER_2026-09-10.md`](QWEN_EXPERIMENTAL_CANDIDATE_REGISTER_2026-09-10.md)
for the current unresolved roster, the verified minimal-profile alias, the
retained semantic-loop no-go, preserved historical receipts, and the requirement
that every new Qwen screen be freshly preregistered. This
note does not edit the append-only screen rows above.

## 2026-09-16 — programme mothballed

Optimizer execution and campaign work are stopped by Albert's explicit decision.
Existing screens and preregistrations are preserved as history; none was run or
reclassified by this action. See `MOTHBALLED_2026-09-16.md`. A prepared study is not
restart authorization.

## Appended records — 2026-09-24

The historical rows above remain unchanged. These later records supersede only
the named unexecuted draft/protocol status; they do not alter any prior result.

| screen | prereg | audit | recorded outcome |
|---|---|---|---|
| `JINA_READER_TASK_QUALITY_COST_REV1` | [draft](screens/PREREG_JINA_READER_TASK_QUALITY_COST_2026-09-24.md) | _none_ | SUPERSEDED BEFORE EXECUTION: JINA_READER was enabled in both arms, so control could automatically fall back to Jina; no sessions ran |
| `JINA_READER_TASK_QUALITY_COST_REV2` | [protocol](screens/PREREG_JINA_READER_TASK_QUALITY_COST_REV2_2026-09-24.md) | _none_ | Protocol draft, not execution-ready; full flag-off versus flag-on intent-to-treat design; fixtures, score rules, runner, model, and judge unbound |
| `RESEARCH_LEDGER_CURRENT_VALUE_REV1` | [protocol](screens/PREREG_RESEARCH_LEDGER_CURRENT_VALUE_2026-09-24.md) | _none_ | Protocol draft, not execution-ready; explicitly supersedes unexecuted stale Run 4; no sessions authorized |
| `HIERARCHICAL_PLANNER_DIAGNOSTIC_REV1` | [protocol](screens/PREREG_HIERARCHICAL_PLANNER_CURRENT_DIAGNOSTIC_2026-09-24.md) | _none_ | Protocol draft, not execution-ready; distinct from Phase 3B; no sessions authorized |
| `PHASE3A_OCCAMY_CONTEXT_ADMISSION` | [prereg](screens/PREREG_CONTEXT_ADMISSION_SAFETY_RECOVERY_OCCAMY_REV3_2026-09-23.md) | [screen](screens/PHASE3A_OCCAMY_SCREEN_2026-09-23.md) | 11/11 PASS; six verification stages PASS; installed live, opt-in; safety qualification only |
| `PHASE3B_OCCAMY_PARENT_RESEARCH` | [prereg](screens/PREREG_PARENT_RESEARCH_PHASE3B_PROMOTION_REV2_2026-09-23.md) | [screen](screens/PHASE3B_OCCAMY_SCREEN_2026-09-23.md) | 10/10 PASS; six verification stages PASS; installed live, opt-in; bounded-operability qualification only |

Phase 3A and 3B Occamy promotion reports and receipts are indexed in the
mutable candidate register and the Phase 4–5 acceptance runbook. Their frozen
historical receipts remain unchanged. This append records documentation status
only and does not restart optimizer execution.

The 2026-09-10 roster summary above is historical. The mutable candidate
register now reflects the 2026-09-23 Phase 3A/3B opt-in promotions and current
Phase 4–5 protocol dispositions. See
[`QWEN_EXPERIMENTAL_CANDIDATE_REGISTER_2026-09-10.md`](QWEN_EXPERIMENTAL_CANDIDATE_REGISTER_2026-09-10.md)
and [`../../docs/evidence/PHASE4_5_ACCEPTANCE_RUNBOOK_2026-09-24.md`](../../docs/evidence/PHASE4_5_ACCEPTANCE_RUNBOOK_2026-09-24.md).
The optimizer remains mothballed; these appended records are documentation
only.
