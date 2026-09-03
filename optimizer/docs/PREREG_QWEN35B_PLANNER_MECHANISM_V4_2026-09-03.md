# Preregistration amendment: Qwen 35B hierarchical planner routing screen v4 (2026-09-03)

## Status and purpose

**PREPARED — NO QUALIFYING MODEL SCREEN UNDER THIS BOUNDARY.** This amendment
supersedes the v3 screen boundary because the first post-lease diagnostic
showed that the graph was reachable only when the user prompt explicitly
ordered planner-first execution. The model-visible deep-research skill
description now advertises that workflow, while the parent-only lease and all
planner flags remain opt-in. This amendment tests routing reachability; it is
not an efficacy comparison or an authorization to enable defaults.

## Frozen identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`.
- Source commit: `db3e5cd` (`fix(research): advertise planner-first routing`).
- Source surface SHA-256:
  `c52d1af7f0dd7d9e8057fa1ff5f2194657d1a9acc2c85827e8958d1a019608f7`.
- Loaded mirror surface SHA-256:
  `8d7d210f41e4ca5a3eac8202ea2a7b725d25847b2f73ac0f14a418d2bfd84823`.
  `mirror:check` reports 122/122 first-party files with zero drift; no screen
  may start against an older loaded surface.
- Candidate and control configuration hashes remain those in v2/v3:
  `0d01aab9292db845b5f228174e2a1a4c10328883daebd482dcd9c9c9f5f5fd1e` and
  `a2e5efef3ab36d90ab58ee91920b766e5c7a162905da970778e9439c3c1c92f7`.

The only source change after v3 is the deep-research frontmatter description:
for complex, contested, comparative, multi-part, or delegated research it
directs the model to read the skill and call `research_plan_start` before any
web tool when available; straightforward fact lookup remains lightweight. The
parent launcher still sets `PI_MUNCHKIN_HEADLESS_PLAN=on`, and delegated
children cannot inherit that marker.

## Evidence boundary

The v3 post-lease diagnostic used an explicit planner-first user instruction.
It called `research_plan_start` twice (the first request allocated six reads,
then the model corrected to five), successfully started a three-branch graph,
and began one subagent before the 350,000-byte cap stopped the run at 84.961
seconds (exit 143). It produced one `research-start`, no branch merge or
settlement, and no raw-payload telemetry. This is a reachability diagnostic,
not screen evidence; it cannot be pooled with v2 or v3 receipts.

## Execution and acceptance

After mirror hashing and human review, run the same admitted comparative,
contested, multi-part, and fact-lookup fixtures with the existing 180-second /
350,000-byte bounds: six candidate mechanism sessions and three negative
controls, balanced and randomized as preregistered. Candidate prompts remain
the frozen fixture text; the skill description is the routing intervention.
The screen requires at least four of six candidate `research-start` events,
one validated branch merge, no branch failure, and one terminal parent
settlement after parent evidence rereads. Controls must contain zero graph
starts, merges, and settlements.

Any identity drift, malformed telemetry, payload retention, budget inflation,
depth violation, missing child report, or incomplete lifecycle invalidates the
affected session. A clean screen establishes only graph operability on Qwen
35B. A separate answer-quality comparison is required before either planner
flag can be considered for activation. This amendment authorizes no further
model execution, calibration, mirror mutation, or adoption beyond a separately
approved screen command.
