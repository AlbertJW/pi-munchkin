# Run Kernel PR 3: control arbitration and observational telemetry

Status: dark control implementation. Source hash `6548d5d9265ed5e9b7643e55a10ccb9df22381eafe3827209e72b5b993943f54`.
No control adoption, live mirror, or model round is implied by this document.

## One correction boundary

Turn-end correction producers publish closed `ControlProposalV1` metadata. A proposal contains
only hashes, enums, priority, boundary sequence, effect, and a bounded message-factory ID. The
message itself remains in an in-memory delivery envelope and never enters RunState, telemetry, a
snapshot, or a notification. Pending control is capped at 128 proposals across all boundaries,
and any in-memory delivery text is clamped to 4,000 characters before queueing.

Priority is deterministic: safety consequence, safe abort, exact verification, failure recovery,
plan resolution, tool rescue, then context hint. `control-arbiter.ts` is loaded after every
turn-end producer, consumes one boundary once, and chooses the highest-priority proposal. Stable
emission order breaks equal-priority ties. Tier-three abort and shutdown decisions inject no
automatic message in enforce mode.

The dormant micro-gate participates too: a deterministic parse/compile failure is a safety
consequence, while its heuristic slop warning is only a context hint. User-command follow-ups and
post-settlement model reviews remain outside the turn boundary.

`CONTROL_ARBITER=shadow` is the default. Legacy producers still act exactly as before, while the
arbiter records the shadow winner, legacy-action attempt count, and collision count without text.
`enforce` suppresses direct producer sends and executes only the winner. `off` registers no
arbiter handlers or subscriber; typed domain signals remain available so disabling the arbiter
cannot disable existing activation or blackboard behavior.
If an explicitly selected extension surface omits the arbiter, producers fail safe to their
legacy direct actions even when the environment requests `enforce`.

Immediate deterministic tool rejection remains synchronous. Git/policy guards, exact repeated
call walls, inlet limits, and plan mutation holds do not wait for a turn-end decision. User-run
commands, compaction continuation, and post-settlement review advisories are also not recast as
same-boundary correction proposals.

## Telemetry is no longer a control bus

The global `__pi_telemetry_taps` mechanism is removed. Plan state, context receipts, compaction,
and loop tiers use a closed `HarnessSignalV1` channel on Pi's event bus. Tool activation and the
blackboard subscribe to those validated signals. The state lens proposes its lower-priority hint
from the loop proposal itself, preserving its existing cooldown and shadow behavior.

Run Kernel observes safe proposal and decision metadata through its own event reducer. No control
library imports telemetry, and `TELEMETRY=off` leaves messages, decisions, aborts, tools, and
blackboard facts unchanged. Telemetry only records the already-made decision.

## Bounded asynchronous writer

`TELEMETRY_WRITER=sync` remains the default and the rollback. `async` is available only for
interactive path-based telemetry. Gate source and inherited file-descriptor telemetry always stay
synchronous so authenticated authority and launcher settlement are unchanged.

The async writer uses one process-shared ordered promise chain per target file, pre-encodes rows,
coalesces bounded batches, creates `0700` directories and `0600` files, and retains the existing
one-generation rotation boundary. Queue rows and bytes are capped. Overflow drops observational
rows rather than blocking the agent; after capacity recovers, one count-only
`telemetry/writer-overflow` receipt is emitted. `agent_settled` and session shutdown await the
final flush. Idle writer state is discarded after a clean flush.

## Measurement boundary

Shadow collision telemetry establishes exposure only. It is not evidence that enforce mode helps
small models, and enforce remains dark until collision exposure and a separately preregistered
evaluation justify adoption. Measurements across this source surface and earlier surfaces are
not pooled.
