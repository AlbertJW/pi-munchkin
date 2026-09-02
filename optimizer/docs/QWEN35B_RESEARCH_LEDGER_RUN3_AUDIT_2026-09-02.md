# Qwen 35B research-ledger Run 3 audit (2026-09-02)

## Verdict

The deterministic half of Run 3 completed as preregistered. Nine of ten
sessions completed with exit 0 and zero stderr; the arm-A Q9 session reached
the 15-minute wall bound without producing an answer and is **INCOMPLETE**.
The run is a mechanism and fidelity receipt only. No efficacy, model-quality,
adoption, default, or rollout decision follows. The independent synthesis
judge was unavailable (`FRONTIER_API_KEY` was not configured), so the paired
answer judgment is **UNAVAILABLE**.

## Frozen identity and containment

- Subject model: `local-llamacpp/qwen36-35b-iq3s`.
- Source checkout surface: `b929b6b2239f364be90a9bb012881d291260caf11bb38b10c2c22afc79a07917`.
- Loaded mirror surface: `251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`.
- Ten fresh sessions used isolated agent/project directories and the pinned
  model. The nine completed sessions exited 0; Q9-A exited 124 at the bound.
- Every telemetry file contained exactly one run identity and exactly one
  loaded surface hash, matching the preregistration. All ten stderr files were
  empty.
- A structural scan found no raw `url`, `query`, `quote`, `prompt`,
  `response`, `content`, or equivalent payload field in the retained
  telemetry summaries. Model text and private ledger contents are not part of
  this report and remain quarantined in the disposable run root.
- Earlier invalid runner attempts (wrong extension path, stale package copy,
  and verify-gate interference) were discarded and are not pooled here.

## Safe per-session results

Arm A is the legacy skill with the ledger disabled; it has no ledger
run-summary by design. Arm B is the current skill with `RESEARCH_LEDGER=on`.
The counts below are sanitized telemetry fields only.

| Question | Arm | Exit / stderr | Searches | Reads | Notes recorded | Notes rejected | Cache hits | Result |
|---|---|---:|---:|---:|---:|---:|---:|---|
| Q2 | A | 0 / 0 | 1 | 2 | — | — | — | complete |
| Q2 | B | 0 / 0 | 1 | 3 | 1 | 2 | 1 | complete |
| Q3 | A | 0 / 0 | 6 | 5 | — | — | — | complete |
| Q3 | B | 0 / 0 | 4 | 11 | 4 | 6 | 0 | complete |
| Q6 | A | 0 / 0 | 5 | 5 | — | — | — | complete |
| Q6 | B | 0 / 0 | 5 | 10 | 5 | 13 | 0 | complete |
| Q8 | A | 0 / 0 | 4 | 2 | — | — | — | complete |
| Q8 | B | 0 / 0 | 14 | 5 | 5 | 3 | 2 | complete |
| Q9 | A | 124 / 0 | 37 | 21 | — | — | — | incomplete: wall bound |
| Q9 | B | 0 / 0 | 28 | 17 | 7 | 0 | 0 | complete |

Across the five ledger-enabled sessions, the totals were 52 searches, 48
reads, 22 recorded notes, 24 rejected note attempts, and 3 cache hits. The
46 note-attempt events broke down as 22 `ok`, 11 `quote_not_found`, and 13
`degraded`; no `corrected`, `url_not_read`, `quote_ambiguous`, or write-failure
event occurred in this run.

## Findings

The ledger mechanism engaged deterministically on Arm B: it produced private
notes, safe run summaries, refusal classifications, and a bounded wrap-up
record without leaking source payloads. The correction path that was the main
target of the post-fix run was not exercised (`corrected = 0`), so this run
cannot claim that wrong-URL attribution was reduced. Refusals and degradation
were still substantial on Q3 and Q6, while Q9 produced seven accepted notes
but its paired legacy arm timed out before answering.

The declared three-search/five-read envelope is not a hard wall for a
ledger-only session. Without a plan context, the observed Arm-B sessions used
up to 28 searches and 17 reads. This is an instrumented safety finding, not a
reason to silently reinterpret the run: budget enforcement outside the
hierarchical planner must be decided and tested as a separate change.

Because Q9-A is incomplete and no independent judge was available, there is
no valid answer-quality comparison. `RESEARCH_LEDGER` therefore remains dark.

## Disposition and next action

Keep this receipt quarantined with the Run 3 root and do not pool it with Run
1, Run 2, the earlier 4B run, another source hash, or another model epoch. The
next research-ledger work is to decide whether the nominal budget should be
enforced for non-graph sessions, add a red-green test for that policy, and
repeat a judge-backed comparison only after that instrumentation decision.
The hierarchical planner/deep-research graph remains downstream of the
semantic-loop gate and must not be enabled from this receipt.
