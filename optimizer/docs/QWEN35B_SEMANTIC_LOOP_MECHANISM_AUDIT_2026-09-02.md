# Qwen 35B semantic-loop mechanism audit (2026-09-02)

**Classification: MECHANISM SCREEN FAILED / INCOMPLETE.** This run is not an
efficacy result and cannot authorize `LOOP_EPISODE_MODE=enforce`, planner
activation, Optimizer V2, or any default change.

The three-session candidate-only screen followed the hash-bound Qwen
preregistration and private study manifest (`e740dc5693cb34f50ac29ba3bc62912ce53e157c4f7c062e2b00f7c4a2fa6ee9`).
All local fixture gates passed, but only `sweep-b` produced an authoritative
settlement:

| Fixture | Gate | Infrastructure validity | Safe failure-loop result |
|---|---:|---:|---|
| `sweep-b` | 1 | PASS | completed at 344/480 seconds; no settled semantic intervention in the reducer |
| `sweep-c` | 1 | FAIL | still mutating at the 480-second boundary; settlement sidecar incomplete |
| `ling-exact-gate-recovery` | 1 | FAIL | still mutating at the 480-second boundary; settlement sidecar incomplete |

The bounded exposure artifacts named a `failure-episode/intervention` and
`failure-episode/tier-observed` for each session, but the authoritative
failure-episode reducer reported no intervention for the valid `sweep-b` row;
the two rows with proposed activity were lifecycle-voided. No valid row proved
an arbiter-delivered `winner_reason=semantic_tier` intervention. This is
exactly why proposed and delivered exposure are kept separate.

The result is therefore a protocol/subject-suitability failure, not evidence
that semantic recovery is ineffective. Qwen 35B reaches the intended loop
shape, but its mutation tails exceed the current wall-clock bound on two of
three fixtures. The foreground-timeout fix remains valid; this screen shows
that it cannot turn an unfinished model loop into a settled mechanism receipt.

The run was not resumed or pooled. Keep `LOOP_EPISODE_MODE=shadow`, the
planner/deep-research flags off, and the Qwen rows quarantined. Before another
semantic study, either characterize a bounded active-tool cancellation path or
choose a subject/fixture envelope that can settle within the declared bound;
then prepare a new preregistration. The hierarchical planner screen remains
blocked behind this unresolved semantic-loop prerequisite.
