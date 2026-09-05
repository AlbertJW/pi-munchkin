# Harness audit and repairs — 2026-09-06

## Scope and conclusion

This pass followed authority from private files and immutable records through
goal transitions, runtime callbacks, context profiles, research coordination,
optimizer decisions, and repository verification. It reviewed the existing
dirty worktree in place and preserved earlier planner work.

The strongest findings were failures at boundaries: old state overriding
current authority, mutable objects presented as immutable records, invalid
numeric evidence passing comparisons, and routine verification coupled to a
frozen experiment. Those defects are repaired in source with failing-before,
passing-after regressions. This is a source audit and offline verification
receipt, not a claim of exhaustive security review or live model effectiveness.

## Repairs

| Area | Reproduced problem | Result |
|---|---|---|
| Goal recovery | Damaged v2 state fell back to an older active v1 goal | Legacy migration is allowed only when current state is absent; malformed or unreadable current authority stops recovery |
| Goal continuation | Empty/repeated updates changed timestamps and earned another continuation | No-op updates preserve the full revision |
| Goal criteria | Required criteria could be deferred, leaving an impossible settlement request | Required deferral is rejected; existing required-but-unmet state continues rather than requesting settlement |
| Goal settlement guidance | Optional deferrals were described as all criteria met, requesting complete settlement | Deferred optional work requests evidence-backed 80/20 settlement with value, risk, and rationale |
| Context metadata | A fractional window below one token normalized into a zero-token window | Such metadata is invalid and uses the existing fallback behavior |
| Calibration | A permitted endpoint could redirect the opt-in request elsewhere | Redirects are refused; credentialed URLs and non-HTTP(S) schemes are rejected |
| Research reservations | Run IDs "." and ".." escaped the run directory namespace through path normalization | Dot identifiers are hashed; ordinary run IDs retain existing paths |
| Optimizer candidates | Nested provenance could mutate after content addressing, even with a frozen dataclass | Provenance is stored as immutable serialized data; reads and exported records are detached |
| Optimizer projections | Projecting candidate verification mutated the source event payload | Projection construction copies payloads before enrichment |
| Optimizer durability | Failure to write both a projection and its dirty marker turned an already durable append into an error | The fsynced event remains successful; state reads reconstruct from the event log |
| Optimizer decisions | Nonfinite guards passed comparisons; malformed score/pairing values were accepted or crashed unexpectedly | Scores and pairing keys are validated; nonfinite guard values fail training, development, and guard-model checks |
| Optimizer metric direction | Binary minimization rewarded increases instead of decreases | The declared metric direction controls net improvement |
| Optimizer learning | An evaluated candidate that failed guards was still described as having validated generalization | Reflection receives validation only after acceptance |
| Verification | Every model-visible edit broke offline tests by invalidating a historical research fingerprint | Self-tests exercise matching and mismatching identities; real --dry readiness retains exact source/loaded hash checks |

The preceding callback repair remains included: Pi callbacks return
{ messages }, its dispatcher returns the array, and queued goal continuations
must match the executable goal identity. The actual installed dispatcher is
tested alongside the double, including invalid callback return shapes.

## Validation receipt

- npm run verify: all six stages passed.
- Harness: 728 tests passed, zero failed.
- Optimizer V2: 60 tests passed, including eight new audit regression tests.
- Typecheck, health, package smoke, optimizer self-tests, gate dry-run, and
  public-repository secret scanning passed.
- All new defect probes were observed failing before their corresponding fix.
- No task-model or optimizer-model inference, calibration, or campaign ran.
- Source surface: cebc32aa4d451ad9c06bbf2abfe5fd8864dd68070ccb87f8b9e3115d0efe4720.
- Read-only mirror check: 14 of 124 first-party files differ. This is pending
  source work, not a synchronized live release.

## Reviewed boundaries and remaining limitations

The private-artifact primitive retains exclusive temporary creation, file sync,
rename, private permissions, directory sync, and temporary-file cleanup.
Capsule recovery refuses ambiguous multiple-run fallback. Existing graph
validation, branch budgets, parent evidence checks, capability activation,
telemetry authentication, and child environment fences were inspected and their
offline suites remain green. Passing those suites does not prove every runtime
interleaving.

Context filtering removes obsolete instructions but cannot by itself cancel
an already queued provider turn. End-to-end AgentSession scheduling, compaction,
and pause/resume races still need a dedicated no-network runtime fixture and a
pinned-model smoke before declaring the goal-mode release complete.

The public URL guard explicitly remains a best-effort preflight: a downstream
fetcher opens its own socket and may resolve DNS or follow redirects again.
End-to-end protection requires enforcement in that fetcher. This pass does not
claim to close that boundary.

The binary policy named exact-sign remains a preregistered net-fix threshold,
not a significance test. Continuous-policy configuration and reflection
classification deserve a separate statistical review before efficacy claims.
No acceptance threshold or historical campaign was changed by this pass.

Research reservation capacity checks are process-local directory counts around
atomic key creation; their marker ceiling is not a strict concurrent global
limit. The separate authoritative graph budget remains the spending boundary.

The research preregistration remains frozen and stale for the new source;
passing self-tests does not make it ready to execute. Planner/deep-research
default flags and other dark candidates were not promoted.

Changes are uncommitted. The worktree also contains earlier planner changes
and preregistrations; isolate those carefully when forming reviewable commits.
No push or mirror was performed during this audit.
