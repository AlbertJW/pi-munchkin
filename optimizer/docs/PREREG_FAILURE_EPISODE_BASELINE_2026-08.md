# Failure-episode baseline calibration — prepared, not approved

**Status: PREPARED ONLY. Do not execute this calibration without a separate human gate.**

This is a behavior-neutral baseline for the semantic failure-episode instrument. It is not a
candidate round and cannot support an efficacy claim. The optimizer remains a historical,
unsupported archive; this document only pins the measurement contract needed by the vNext
work.

## Fixed calibration block

- Arm: current baseline harness with `LOOP_EPISODE_MODE=shadow`.
- Repetitions: exactly 6 per selected fixture/model cell; no candidate arm.
- Fixtures, at their checked-in versions:
  - `hygiene-shared-config-reread` (`2026-07.1`)
  - `sv-ambiguous-spec` (`2026-07.3`)
  - graded `audit-sweep` (`2026-07.1`)
- Serving: one fixture/model cell at a time and at most one gate round per serving box.
- Surface: compute and record `HARNESS_SURFACE_SHA256` immediately before execution. Never pool
  rows across a different surface hash.
- Model: pin the exact serving fingerprint before execution. Historical rows do not satisfy
  this calibration.

## Required rows

For every session record the existing correctness and effort fields plus:

- episode count and longest episode;
- failures after the second attempt;
- `semantic_failure_overrun` (tool calls after the second semantic failure until verified
  recovery);
- calls until recovery and settlement without recovery;
- mechanism exposure, repeat calls, tool errors, turns, tokens, latency, and aborts.

The instrument is invalid for a row if raw arguments, commands, output, errors, URLs, paths,
credentials, or endpoints appear in its episode state or telemetry.

## Calibration decision

This n=6 block only decides whether a fixture/model pair is eligible for a later powered study.
Eligibility requires 30–70% strict or graded performance and non-zero semantic-episode exposure.
Report every cell, including floors and ceilings. Do not choose a candidate, flip a default,
mirror the live harness, or launch an A/B round from this result. A later A/B requires its own
preregistration, bootstrap power calculation, and explicit approval.
