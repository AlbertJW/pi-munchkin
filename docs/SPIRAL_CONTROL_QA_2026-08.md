# Spiral-control hardening QA

This bounded record names tests and outcomes only. It intentionally contains no
commands, compiler output, gate output, paths outside this repository, endpoints,
or matched secret text.

## PR 1 counterfactuals

- Restoring success-only mutation ordering made
  `an overlapping verifier cannot recover a failed mutation attempt` fail.
- Restoring shared first-receipt consumption made
  `concurrent plan calls consume only their own call-bound gate receipts` fail.
- Raw gate-output persistence was not temporarily restored: doing so would itself
  violate the security boundary under test. The regression instead drives a real
  failed plan gate and proves the hostile marker is absent from plan state, TODO,
  trace, telemetry, notifications, and model-directed control messages while the
  transient diagnostic remains bounded and JSON framed.

Both executable counterfactuals were reverted immediately, and their targeted
tests passed again before the full acceptance suite.

## PR 1 acceptance

- The complete verifier passed 581 tests plus typecheck, health, deterministic
  package smoke, and optimizer checks.
- Offline peer-boundary checks accepted 0.80.6 and 0.84.x and rejected 0.80.5
  and 0.85.0.
- Isolated packed consumers typechecked and loaded all 32 extensions and both
  skills on Pi 0.80, 0.81, 0.82, 0.83, and 0.84.
- Diff whitespace and the non-echoing secret scan passed; no file matching the
  protected context-pressure pattern changed.

## PR 2 counterfactuals

- Restoring start-only progress made
  `candidate progress resets repetition only after its successful execution end`
  fail on the first failed edit.
- Restoring same-family recovery for an exact-gate episode made
  `an exact-project-gate episode ignores generic verifier success` fail.
- Replacing the pure precedence reducer with last-candidate selection made
  `highest loop tier wins regardless of detector` and
  `stable exact ties preserve the first candidate` fail.

Each counterfactual was restored immediately. The focused loop, recovery, and
failure-episode suites passed again before full acceptance.

## PR 2 acceptance

- The complete verifier passed 589 tests plus typecheck, health, deterministic
  package smoke, and optimizer checks.
- Offline peer boundaries accepted 0.80.6 and 0.84.x and rejected 0.80.5 and
  0.85.0.
- Isolated packed consumers typechecked and loaded all 32 extensions and both
  skills on Pi 0.80, 0.81, 0.82, 0.83, and 0.84.
- The non-echoing secret scan, diff whitespace check, and protected-file check
  passed. No live-agent directory was read from or modified by acceptance work.
