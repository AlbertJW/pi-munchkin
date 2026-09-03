# Preregistration amendment: Qwen 35B hierarchical planner routing screen v5 (2026-09-03)

## Status and purpose

**PREPARED — NO QUALIFYING MODEL SCREEN UNDER THIS BOUNDARY.** This amendment
supersedes v4 because the skill-description route was insufficient in the
ordinary comparative fixture: the graph lease was active, but Qwen still chose
direct web research. The parent-only lease now adds a bounded model-visible
planner-first route hint at `before_agent_start`. This remains a routing
operability screen, not an efficacy comparison or authorization to enable
defaults.

## Frozen identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`.
- Source commit: `4f014ad` (`fix(planner): inject headless planner route`).
- Source surface SHA-256:
  `a31ef6d4cf91144ef24e9e97b1432a7a2dfc901e55614a4571176e07d9da4cd5`.
- Loaded mirror surface SHA-256:
  `ff5c7ce76e589a3d13612c9e1aa9d9b6c925e9a2975469d21375d52b92d01924`.
  `mirror:check` reports 122/122 first-party files with zero drift; no screen
  may start against an older loaded surface.
- Candidate and control configuration hashes remain those in v2–v4:
  `0d01aab9292db845b5f228174e2a1a4c10328883daebd482dcd9c9c9f5f5fd1e` and
  `a2e5efef3ab36d90ab58ee91920b766e5c7a162905da970778e9439c3c1c92f7`.

The only source change after v4 is a parent-only `before_agent_start` route
hint. It tells the leased parent to call `research_plan_start` before
`web_search`/`web_read` for complex research, keeps straightforward lookup
lightweight, and states that children cannot plan. The lease marker remains
excluded from delegated child environments.

## Evidence boundary

The post-v4 bounded diagnostic against the comparative fixture still reached
the router but emitted no graph start before its output cap. It is superseded
by a v5 diagnostic at the exact loaded hash: 83.884 seconds, exit 143 at the
350,000-byte cap, zero stderr, 97 authenticated payload-free rows, one
`research-start`, five successful source receipts, one open item, and no branch
merge or parent settlement. It is an incomplete mechanism observation and
cannot be pooled with v2–v4 or with the qualifying screen. The v5 screen must
use the frozen fixture prompts, with no explicit planner-first instruction in
those prompts; the route hint is the sole intervention.

## Execution and acceptance

After human review and an explicit run command, execute the same six candidate
mechanism sessions and three fact-lookup negative controls under the existing
180-second / 350,000-byte bounds, balanced and randomized as preregistered.
Require at least four of six candidate `research-start` events, one validated
branch merge, no branch failure, and one terminal parent settlement after
parent evidence rereads. Controls must contain zero graph starts, merges, and
settlements.

Any identity drift, malformed telemetry, payload retention, budget inflation,
depth violation, missing child report, or incomplete lifecycle invalidates the
affected session. A clean screen establishes only graph operability on Qwen
35B. A separate answer-quality comparison is required before either planner
flag can be considered for activation. This amendment authorizes no model
execution, calibration, mirror mutation, or adoption beyond a separately
approved screen command.
