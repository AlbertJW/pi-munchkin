# Semantic-overrun refinement QA — 2026-08-10

This records mechanism checks for the review-only measurement refinement. It changes no
loop-breaker enforcement tier, activation trigger, blocking rule, or default. It is not an efficacy
result and must not be pooled with measurements from another harness surface hash.

## Counterfactuals

| Defect | Counterfactual | Targeted result |
|---|---|---|
| Missing correlated session counter | Temporarily replaced the correlated increment with a no-op. | `same family, target, and plan item increments both overrun counters` failed with correlated `0 !== 1`; the increment was restored before rerunning the suite. |
| Work on the no-episode hot path | Exercised the allocation-first ordering as an isolated legacy function because the repository safety guard correctly prohibited weakening production code. | A proxy whose arguments must remain untouched threw before the empty-set return. The production regression proves the current ordering returns without inspection. |

## Acceptance evidence

- Unit tests cover unrelated calls, matching alternatives, changed targets, changed plan items,
  multiple exposed episodes, recovery/settlement/compaction/manual-resume/reset cleanup, snapshot
  v3, and the
  allocation-free empty-set path.
- Extension tests bind correlation to the plan item captured at tool start, expose both counters in
  `/loop-status`, and retain the existing one-highest-tier collision regression.
- A full tracker/session reset clears exposure. Native `session_compact` now settles active
  semantic episodes and clears exposure without calling that settlement recovery. This matches the
  run-boundary contract and prevents a pre-compaction episode from charging post-compaction work.
- Full verification, deterministic package smoke, peer boundaries, Pi 0.80–0.83 isolated
  consumers, and the non-echoing diff secret scan are required before review.
- No live mirror, default change, adoption, calibration, or gate round is authorized by this record.
