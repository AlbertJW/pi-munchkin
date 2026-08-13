# Ling measurement v3 — bounded QA record

This record contains commands and verdicts only. It contains no telemetry payloads, model output,
commands from evaluated sessions, paths outside the public repository, endpoints, or credentials.

## Measurement bridge

- Counterfactual: wrapped `context_telemetry.aggregate()` with the pre-v3 behavior that omits
  `failure_episodes`, then ran `context_telemetry.selftest()`.
- Expected failure observed: `authenticated failure episode aggregate regression: KeyError`.
- Fixed-path checks: `context_telemetry.py --selftest`, `fleet_report.py --selftest`,
  `fleet_verdict.py --selftest`, `propose.py --selftest`, and `test_span_screen.py` pass.
- Repository gates: `git diff --check`, `npm run secret-scan:diff`, and `npm run verify` pass.

The regression is non-vacuous: removing the authenticated episode aggregate makes the targeted
selftest fail before a powered row can be accepted. Missing or duplicated settlement summaries
remain represented as incomplete evidence rather than disappearing from the result stream.

## Serving fingerprint and stage runner

- Counterfactual: replaced the parsed batch-size identity with `backend-default`, then ran the
  fingerprint integrity check.
- Expected failure observed: `test_fingerprint` rejected the missing `2048` batch identity.
- Fixed-path checks: fingerprint helper environment isolation, exact v2 shape/privacy, semantic
  template drift, performance identity, and full pre/post comparison pass.
- Runner checks: stage names are closed, inference stages require `--execute`, output is private,
  completed cells are resumable, coherence adoption is a preflight prerequisite, and direct or
  credential-bearing transport is refused.
- `bash scripts/verify-optimizer.sh` passes after restoring the production implementation.

This proves the performance hash is not decorative: omitting a serving parameter makes the
targeted check fail before a powered row can enter a study population. No model session was
started while producing this record.

## Ling semantic fixture admission

Four 2026-08 fixtures were added in an unapproved state: exact-project-gate recovery,
cross-file shared vocabulary, partial-order scheduling, and public-export path evidence.
For each fixture, the admission runner executed three repetitions of all six proof cells:
pristine pass-to-pass passed, pristine fail-to-pass failed, gold passed both suites, and the
realistic shortcut preserved the visible suite while failing the hidden suite.

The shortcut states are the counterfactuals. They respectively implement input-order allocation
without urgency, update only the shared policy while retaining the duplicate parser list, use a
one-pass comparator instead of a topological scheduler, and repair the similarly named decoy
file rather than the exported implementation. Removing each gold mechanism therefore recreates
a targeted hidden-test failure without weakening the visible regression suite.

Automated receipts persist only pass state, return code, output byte count, and output SHA-256.
Raw test output and temporary paths are absent. Human fixture review and approval remain pending;
no Ling calibration or model session was started.
