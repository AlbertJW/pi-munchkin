# Qwen 35B planner mechanism screen v5 — audit (2026-09-03)

## Verdict

**INCOMPLETE MECHANISM — PREREGISTERED GATE NOT MET.** The exact v5 source and
loaded surface were used for six candidate sessions and three controls. All
sessions were arm-bound, identity-consistent, and payload-safe, but the
candidate arm did not produce enough complete graph lifecycles to qualify.
Planner defaults remain dark.

## Frozen identity and protocol

- Subject: `local-llamacpp/qwen36-35b-iq3s`.
- Source surface: `a31ef6d4cf91144ef24e9e97b1432a7a2dfc901e55614a4571176e07d9da4cd5`.
- Loaded surface: `ff5c7ce76e589a3d13612c9e1aa9d9b6c925e9a2975469d21375d52b92d01924`.
- Candidate config: `0d01aab9292db845b5f228174e2a1a4c10328883daebd482dcd9c9c9f5f5fd1e`.
- Control config: `a2e5efef3ab36d90ab58ee91920b766e5c7a162905da970778e9439c3c1c92f7`.
- Bounds: 180 seconds and 350,000 combined stdout/stderr bytes per run.

The arm-qualified launcher verified each config digest, cleared inherited
planner flags, used a distinct disposable project directory, and emitted only
bounded summaries. Every telemetry row carried the expected loaded hash; a
structural scan found no raw prompt, query, URL, quote, content, answer,
transcript, argument, or tool-input keys.

## Session outcomes

| Run | Arm / fixture | Result | Graph lifecycle | Rows | Safe stream digests |
|---|---|---|---|---:|---|
| c1 | candidate / comparative | output cap, 70.753s, exit 143 | 0 starts, 0 merges, 0 failures | 114 | stdout `8e39027e…`, telemetry `b834aa00…` |
| c2 | candidate / contested | output cap, 56.395s, exit 143 | 1 start, 0 merges, 0 failures, 1 open | 105 | stdout `7ab45d21…`, telemetry `ee2d22ae…` |
| c3 | candidate / multi-part | output cap, 53.079s, exit 143 | 1 start, 0 merges, 0 failures, 1 open | 100 | stdout `5ebec03f…`, telemetry `11126e59…` |
| c4 | candidate / multi-part | output cap, 52.599s, exit 143 | 1 start, 0 merges, 0 failures, 3 open | 98 | stdout `41786887…`, telemetry `1259b51c…` |
| c5 | candidate / comparative | output cap, 62.907s, exit 143 | 0 starts, 0 merges, 0 failures | 97 | stdout `232fd940…`, telemetry `aadb450e…` |
| c6 | candidate / contested | output cap, 59.922s, exit -9 | 0 starts, 0 merges, 0 failures; no settled run row | 101 | stdout `59d3f5d1…`, telemetry `1e56f12f…` |
| k1 | control / comparative lookup | completed, 28.958s, exit 0 | 0 starts, 0 merges, 0 failures | 72 | stdout `8c80eb26…`, telemetry `811eb154…` |
| k2 | control / contested lookup | completed, 15.557s, exit 0 | 0 starts, 0 merges, 0 failures | 89 | stdout `13a500d6…`, telemetry `26281d8e…` |
| k3 | control / multi-part lookup | completed, 24.247s, exit 0 | 0 starts, 0 merges, 0 failures | 99 | stdout `62539345…`, telemetry `3e8e013d…` |

The three controls satisfy their negative-control graph condition. Candidate
acceptance does not: only 3/6 sessions emitted `research-start` (required 4),
none emitted a validated branch merge (required 1), and none reached terminal
parent settlement after evidence rereads. The output cap is a bounded
lifecycle classification, not a quality score; no answer-quality inference is
valid from these rows.

## Interpretation and next action

The route hint repaired entrypoint reachability for some complex prompts, but
the subject still tends to run long or stops with an open graph. This does not
distinguish a model limitation from a remaining lifecycle/prompt-contract
issue. Do not pool this screen with v2–v4 or with future quality studies.

The next safe step is a diagnosis pass over the bounded structural traces and,
if a concrete harness defect is found, a new red-green fix with a new
preregistration. Otherwise prepare a fresh, explicitly approved screen with a
shorter research task or stronger completion contract. Do not enable
`PLAN_GRAPH` or `DEEP_RESEARCH_PLANNING` from this result.
