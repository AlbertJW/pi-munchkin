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
