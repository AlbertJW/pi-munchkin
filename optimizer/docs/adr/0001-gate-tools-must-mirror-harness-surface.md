# 0001-gate-tools-must-mirror-harness-surface

- **Status:** active
- **Date:** 2026-07-23
- **Superseded by:** none

## Decision

Every tool a gate session's `--tools` allowlist grants (or omits) must be
audited against every active flag that changes model-visible behavior
(`PLAN_SUBAGENT_ONLY`, `PLAN_DELEGATE_ALL`, `SPAWN_DELEGATION`, `TRAJECTORY`/
`SPAN_TOOLS`, and `plan_write` itself). A flag that tells the model to do
something (delegate, span-search, plan) is a lie if the corresponding tool
isn't actually in the session's tool list.

## Rationale

`--tools` is a real allowlist over *all* tools, including extension-registered
ones — pi core's `_refreshToolRegistry` filters extension tools through the
same `isAllowedTool` check as builtins. A hand-maintained tool-list string in
`real_gate.sh` is therefore load-bearing for correctness, not cosmetic, and
silently omitting an entry doesn't error — it just produces a session that
can't do what its env flags claim it can.

## Evidence / incident that triggered it

`real_gate.sh`'s tool-grant logic omitted `plan_write` from every gate session
ever run. This confounded two candidates (c37: spawn-delegation, c38:
plan_write block) before being caught via a live transcript in which the
model itself said "plan_write is not in my available tools list" after
retry-looping a blocked action 76 of 102 turns. Fixed 2026-07-23:
`optimizer/real_gate.sh` now grants `read,edit,bash,plan_write`
unconditionally on every arm (comment at the grant site cites this incident
directly), and c38's block now fails open when `plan_write`/`subagent` is
unavailable, mirroring the `subagentAvailable` check pattern (`pi
.getActiveTools().includes(...)`) already used by c25/c37 in
`harness/extensions/plan-runner.ts`.

## Relevant paths / subsystems

`optimizer/real_gate.sh` (tool-grant logic), `harness/extensions/plan-runner.ts`
(fail-open pattern), any dark candidate that changes tool availability or
tells the model to use a tool that isn't unconditionally granted.

## Review / invalidation condition

Revisit if a new flag introduces another conditionally-granted tool without a
matching audit step, or if pi core's tool-filtering semantics change (e.g. if
extension tools stop being subject to `--tools`). The enforcing mechanism is
an instrument-consistency check in `real_gate.sh` — if that check is ever
removed or bypassed, this ADR's decision has silently reverted to the
pre-2026-07-23 state.
