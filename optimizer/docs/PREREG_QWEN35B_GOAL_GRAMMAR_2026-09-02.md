# Preregistration: Qwen 35B goal-tool grammar compatibility smoke (2026-09-02)

## Status and scope

**COMPLETED — mechanism/lifecycle smoke only.** This screen tests whether the
freshly mirrored goal-tool schemas initialize on the pinned Qwen 35B serving
path and whether one bounded, user-started goal can execute through evidence-
backed completion. It is not a quality result, baseline, candidate comparison,
calibration, planner/deep-research evaluation, or adoption decision.

The original DD probes failed before inference because llama.cpp rejected nested
schema `maxLength: 2_000` bounds. The source fix caps only the model-visible
objective, criterion, delivered-value, and deferral-rationale fields at 1,999;
the runtime ledger validator still enforces its independent 2,000-byte bound.

## Subject and pinned surface

- Requested and resolved model: `local-llamacpp/qwen36-35b-iq3s`
- Transport: loopback llama-swap OpenAI-compatible endpoint on `127.0.0.1:8080`
- Source branch: `codex/qwen35b-provenance`
- Runtime source commit: `b225d20`
- Package-source surface SHA-256: `03ed0ab76427cc3aa9c1cb160b2641b574362b5d268030bfd29716966448af1d`
- Loaded Pi agent surface SHA-256: `7624ee447fb6a9a77f96e4abf5ee9b01580ddd478f3ae67b329f858761e07ca7`
- Registered-model catalog SHA-256: `ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf`
- Smoke configuration SHA-256: `e259211cc659dcb0fff47145a2e5b3ce0852a81e6e09a83d0fc92099c5b5123f`

The loaded hash is authoritative for this receipt. No rows from the earlier
stale mirror or from the isolated-copy smoke are pooled with this run.

## Design and bound

- One user-started `/goal` command in a disposable project directory.
- Objective: create `goal-smoke.txt` with the exact sentinel `GOAL_SMOKE_OK`,
  verify it, record criterion evidence, and settle as `complete`.
- `GOALS=on`; `CONTEXT_HANDOFF=off`; `CONTEXT_DISCOVERY=off` to isolate this
  grammar/lifecycle mechanism.
- Telemetry was written to a private temporary file. The report retains only
  safe event kinds, counts, hashes, ledger status, and byte counts; it retains
  no model text, prompts, tool arguments, source contents, or URLs.

## Receipt

The live-surface run exited 0 with zero stderr. The private `pi.goal-ledger/v2`
record has one goal, `current_goal_id: null`, status `complete`, one `met`
criterion, and the single transition `active → complete`. Authenticated
telemetry contained 128 well-formed rows, including one each of
`goal-runner/started`, `goal-runner/updated`, and `goal-runner/settled`, plus
five goal-surface activations and four deactivations. The only observed
surface hash was the pinned loaded hash above, and no sensitive payload key
appeared in the summarized rows.

This qualifies protocol reachability and one happy-path lifecycle only. It does
not establish persistence benefit, recovery quality, long-horizon steering,
80/20 behavior, or model efficacy. The goal feature and all planner/deep-
research flags remain at their existing defaults.

## Follow-up

Run a separately prepared 1–3-session lifecycle screen covering pause, user-only
resume, model `goal_block`, 80/20 deferrals, compaction recovery, and a negative
inactive-goal case. Keep it hash-bound to the current loaded surface and do not
pool it with this single happy-path receipt or with any efficacy study.
