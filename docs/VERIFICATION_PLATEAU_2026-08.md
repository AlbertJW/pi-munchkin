# Shadow verification-plateau control

Status: observational by default. `VERIFICATION_PLATEAU=shadow` records strict exposure;
`enforce` is a dark candidate; `off` is the collection kill switch. No gate or calibration was
started by this change.

## Definition

The verification gate remains the sole verification authority. A separate pure reducer consumes
only facts that authority already established. One plateau epoch requires a successful source
mutation followed by a later ordered exact-project-gate result with an internally consistent Node
TAP summary. The result must fail, the TAP frontier must not advance, the same hashed active plan
item and gate must remain in scope, and no mutation may remain pending.

One exact gate consumes at most one mutation. Multiple edits followed by one test run count once,
and repeated test runs without new source mutation do not count. Unknown output, missing or
overlapping execution events, a changed plan item, exact green, or a productive frontier advance
fail closed or reset the candidate streak. A frontier advance does not itself close the semantic
failure episode.

## Dark enforcement

At the third unchanged epoch, `enforce` proposes one recovery correction through the typed control
arbiter. It states one observed fact and one action: obtain a discriminating fact that separates
another local patch from a subsystem-level correction. If exact verification is also due, the
arbiter appends that intact requirement to the same delivery.

At the fifth epoch the verifier emits one additive `subagent` capability request only when that
tool exists. The activation manager remains authoritative: narrowed explicit surfaces are
preserved, prior automatic attempts are not repeated, and a later manual disable is not undone.
The correction never names the optional tool. Plateau control never aborts.

## Measurement

Telemetry retains mode, counts, booleans, and gate/plan hashes only. No command, TAP output, path,
error, or prompt text is persisted. Shadow settlement reports eligible epochs, event count,
maximum/current streak, frontier advances, pending-pair state, corrections, and activation
requests. A preregistered mechanism screen uses authenticated v4 exposure counts and the existing
complete frontier settlement; it does not infer firing from generic failures.

The broad `verification_plateau_overrun` metric begins after three unchanged recognized failed
frontiers. The strict plateau event additionally requires mutation pairing and stable plan/gate
scope. Keep both labels distinct in analysis. Enforcement is first tested separately from working
memory and requires its own adoption decision.
