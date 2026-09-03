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

## PR 3 counterfactuals

- Restoring verification above repeated-failure recovery made
  `repeated-failure recovery wins and retains the exact verification requirement
  at the end` select `verification_required` and fail.
- Restoring the two-minute `__pi_lb_outcome_at` suppression made
  `verification is never suppressed by stale loop wall-clock state` fail.
- Disabling the verification suffix merge made
  `repeated-failure recovery wins and retains the exact verification requirement
  at the end` fail with `verificationMerged=false`.
- Restoring a no-op ambient-guidance stripper made
  `active-only prompt surface is verified in an isolated source-loader process`
  fail because inactive `compact_context` and `subagent` guidance remained.
- Restoring the raw configured-gate display made
  `configured gate labels are bounded single-line data` fail its 240-byte bound;
  the safe implementation then passed the same isolated test.

Each broken form was restored immediately. The focused arbitration,
verification, loop, telemetry, activation, and prompt-surface suites passed
again before full acceptance.

## PR 3 acceptance

- The complete verifier passed 595 harness tests plus typecheck, health,
  deterministic package smoke, and optimizer checks.
- Offline peer boundaries accepted 0.80.6 and 0.84.x and rejected 0.80.5 and
  0.85.0.
- Isolated packed consumers typechecked and loaded all 32 extensions and both
  skills on Pi 0.80, 0.81, 0.82, 0.83, and 0.84 using temporary agent homes.
- The non-echoing secret scan, diff whitespace check, manifest-order tests, and
  protected-file check passed. Deployed defaults remain ambient prompts and a
  shadow arbiter; no live-agent directory was modified.

## PR 4 counterfactuals

- Reintroducing a `CTX_REDUNDANCY_NUDGE` runtime reference made
  `retired environment options have no loadable runtime reader` fail.
- Reintroducing `view` into the active `STATE_LENS` schema made
  `retired extensions and policy are absent from package and active optimizer
  schemas` fail.

Both inert counterfactuals were restored immediately. The same two-test
structural suite then passed, proving that loadable-source and active-schema
residue are independently guarded.

## PR 4 acceptance

- The complete verifier passed 581 harness tests plus typecheck, health,
  deterministic package smoke, and optimizer checks. The packed surface contains
  30 extension entry points and both skills.
- Offline peer boundaries accepted 0.80.6 and 0.84.x and rejected 0.80.5 and
  0.85.0.
- Isolated packed consumers typechecked and loaded all 30 extensions and both
  skills on Pi 0.80, 0.81, 0.82, 0.83, and 0.84 using temporary agent homes.
- The non-echoing secret scan inspected the complete diff without exposing
  matched text. An archived private-endpoint literal was removed rather than
  suppressed; the historical runner now resolves its endpoint at runtime.
- The deterministic source surface is
  `3384948ad1411b5eaedb68f28de89c6f176e7de1c680b19826b24ff9c1b6c663`.
  No protected file or live-agent directory was modified. This remains an
  unmerged deletion draft pending the separate human checkpoint.
