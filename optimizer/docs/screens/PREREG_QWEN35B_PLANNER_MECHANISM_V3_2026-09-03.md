# Preregistration amendment: Qwen 35B hierarchical planner mechanism screen v3 (2026-09-03)

## Status and purpose

**PREPARED — NO QUALIFYING MODEL SCREEN UNDER THIS BOUNDARY.** One bounded
diagnostic session was run after the lease repair; it is explicitly excluded
from the mechanism screen below. This amendment
supersedes the v2 launcher identity after the planner screen exposed a real
activation gap: graph and research tools were registered but deferred at
startup, so a model could not reach `research_plan_start` without an
unreliable manual capability detour. It changes reachability only; it does
not enable planner defaults, turn the incomplete v2 receipt into evidence, or
authorize an efficacy comparison.

## New frozen identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`.
- Source commit: `db61e8e` (`fix(planner): add explicit headless research lease`).
- Source surface SHA-256:
  `70c202d47b49d21e73255d163ad6a8d46c9c0bc4b7f25cb2b0c8d2676238105f`.
- Loaded mirror surface SHA-256:
  `a4856f916419d26da39b80aa77ce4737a4dc08acb86c8a46cb95ab58a4ddeeb5`.
  `mirror:check` reports 122/122 first-party files with zero drift; no v3
  screen run may start against an older surface.
- Candidate and control configuration hashes remain those in v2:
  `0d01aab9292db845b5f228174e2a1a4c10328883daebd482dcd9c9c9f5f5fd1e` and
  `a2e5efef3ab36d90ab58ee91920b766e5c7a162905da970778e9439c3c1c92f7`.

The parent launcher opts into the lease with the private
`PI_MUNCHKIN_HEADLESS_PLAN=on` environment marker, alongside the existing
candidate flags. The marker is excluded from delegated child environments;
children receive only their typed private `plan_context` and cannot regain the
parent startup surface. Ordinary sessions, the control arm, and all live
defaults remain unchanged.

## Evidence boundary

The 2026-09-02 v2 comparative receipt (old loaded hash `9629b4db…`) remains an
incomplete, quarantined mechanism observation: it reached the router but
recorded no activation request, branch merge, or graph settlement. It cannot
pool with v3. The earlier sandbox connection-refused attempt and the
output-capped contested attempt remain excluded as well.

## Execution and acceptance

After a human reviews this amendment, refresh `preflight.py --dry` against the
new source and loaded hashes, then use `optimizer/v2/planner_smoke.py --run`
with the same 180-second/350,000-byte bounds and the admitted comparative,
contested, multi-part, and fact-lookup fixtures from v2. Run six candidate
mechanism sessions and three negative controls, balanced and randomized as
already preregistered. A candidate session must contain one
`research-start`; the screen still requires at least four of six starts, one
validated branch merge, no branch failure, and one terminal parent settlement
after parent evidence rereads. The controls must contain zero graph starts,
merges, and settlements.

Any identity drift, malformed telemetry, payload retention, budget inflation,
depth violation, missing child report, or incomplete lifecycle invalidates the
affected session. A clean screen establishes only graph operability on this
Qwen subject. It does not justify enabling `PLAN_GRAPH` or
`DEEP_RESEARCH_PLANNING`, and a later answer-quality comparison still needs a
separate powered preregistration.

This amendment authorizes no further model execution, mirror mutation,
calibration, or adoption. It is a fresh boundary for the next explicitly
approved screen command.

## Bounded diagnostic after lease repair (not screen evidence)

An explicitly bounded host-network diagnostic used the exact loaded hash above
with Qwen 35B, the comparative fixture prompt, a 180-second wall, and a
350,000-byte output cap. It reached the router and activated the leased
research surface: the parent recorded ten `headless-plan-lease` activations,
three successful searches, five successful source reads, and the shared
3-search/5-read budget wall. It then exited with `output_cap` (143) after
95.478 seconds. The safe telemetry projection contained 101 rows and no raw
payloads, but it contained zero `research-start`, branch-merge, or graph-
settlement events; the run therefore cannot satisfy any screen threshold or be
pooled with the pre-lease receipts. Its only conclusion is that the startup
lease is reachable and the research budget is enforced. The next diagnostic
must determine why the model still chooses the direct research path when the
graph entrypoint is available.
