# Preregistration: Qwen 35B graceful-shutdown settlement smoke (2026-09-01)

## Status and scope

**PREPARED — no model execution is authorized by this document.** This is a
fresh, base-only infrastructure screen for the source-only graceful-shutdown
fix. It supersedes the timeout-retry as the next attempted screen, but does
not rewrite, resume, or pool any earlier rows. The earlier 240-second screen
and 480-second retry remain immutable audit records; their incomplete rows are
not Qwen quality evidence.

The question is narrow: when the gate reaches its existing bounded timeout,
does Pi's shutdown path give an active agent enough time to emit exactly one
authoritative settlement before telemetry is flushed? A clean result qualifies
the lifecycle protocol for a later baseline; it is not a candidate comparison,
semantic-loop study, planner/deep-research evaluation, adoption decision, or
rollout.

## Subject and pinned source

- Requested and resolved model: `local-llamacpp/qwen36-35b-iq3s`
- Transport: loopback llama-swap OpenAI-compatible endpoint; `MODEL_CONTROL=llama`
- Source branch: `codex/qwen35b-provenance`
- Source commit: `6cf8964` (boundary documentation; implementation is `071874e`)
- Package-source surface SHA-256: `f5b3a00d5bb2cc3631d395bb8b2c9d2ff222805ffe69a47d3e33c6c8019a1a52`
- Loaded Pi agent surface SHA-256: **must be recorded after an approved mirror; do not use the old `636715442f82c348b430fbedc04fc42fbe149907356dea42fbe36f8ed19e0e8b` hash**
- Registered-model catalog SHA-256: `ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf`
- Baseline config SHA-256: `5306ecc5a68682ce8fe6d52d59e0171367cfae0f390965bc4956c0f9d706d379`

The loaded hash is authoritative for every row. The source hash is a review
aid and cannot substitute for the post-mirror receipt. If the registry,
configuration, source surface, serving identity, or model changes, stop and
prepare a new preregistration rather than pooling observations.

## Design and bound

- Arm: `base` only, through the existing `--calibrate` path.
- Replicates: `N=1`, `REP_START=1` (one row each for `parens`, `equil`, and `bigdata`).
- Per-row process bound: `PI_TIMEOUT=480` seconds, unchanged from the retry so
  the shutdown fix is isolated as the lifecycle variable. A timeout or missing
  settlement is incomplete evidence, never a pass.
- Existing 30-second kill grace remains in force; the telemetry boundary waits
  at most 25 seconds for the actual `agent_settled` callback before the hard
  kill can occur.
- Network policy: `GATE_NETWORK=endpoint`; sandbox remains on when available.
- No retries, candidate arm, semantic-loop configuration, planner graph, or
  deep-research profile is enabled.

Accept only rows whose authenticated gate identity, requested/resolved model,
registry/config hashes, newly recorded loaded surface hash, stable serving
fingerprint, exact usage, and trial-validity sidecar agree, and whose lifecycle
contains exactly one authoritative failure-episode settlement summary. Report
safe classifications and timings only; never copy prompts, tool arguments,
commands, source, or raw telemetry into the audit.

## Required human gates before execution

1. Review and approve the source boundary `f5b3a00d…`.
2. Mirror the approved source into `/Users/Albert.Wessels/.pi/agent`, run
   `mirror:check`, and record the resulting loaded surface hash. The old
   `63671544…` receipt is not valid for this screen.
3. Confirm the serving identity is still the pinned Qwen35B target and that no
   Pi or gate process is running on the single-slot box.
4. Run the dry preflight below and inspect its output.
5. Separately approve the non-dry command. This document itself is not that
   approval.

## No-inference preflight

Run from `optimizer/` after the new loaded hash is recorded:

```sh
GEN=qwen35b-graceful-shutdown-20260901 \
N=1 REP_START=1 ARM=base PI_TIMEOUT=480 \
PI_MODEL=qwen36-35b-iq3s \
AGENT_MODELS_SHA256=ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf \
REAL_GATE_RUNS=/private/tmp/qwen35b-graceful-shutdown-20260901-runs \
RESULTS=/private/tmp/qwen35b-graceful-shutdown-20260901.jsonl \
  ./real_gate.sh --dry --calibrate parens equil bigdata
```

Dry mode validates wiring and emits no evaluation rows or model requests.

## Explicit execution command (human approval required)

Only after all five gates above pass, and only when explicitly approved:

```sh
GEN=qwen35b-graceful-shutdown-20260901 \
N=1 REP_START=1 ARM=base PI_TIMEOUT=480 \
PI_MODEL=qwen36-35b-iq3s \
AGENT_MODELS_SHA256=ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf \
REAL_GATE_RUNS=/private/tmp/qwen35b-graceful-shutdown-20260901-runs \
RESULTS=/private/tmp/qwen35b-graceful-shutdown-20260901.jsonl \
  ./real_gate.sh --calibrate parens equil bigdata
```

Do not add `--hard`, `--robustness`, a candidate arm, retries, or planner
flags. Do not treat successful fixture gates without authoritative settlement
as success. A completed smoke only permits a separately preregistered Qwen
baseline and later research-shaped screens.

## Rollback and evidence boundary

If the source fix is rolled back or the mirror is mixed, discard the prepared
command and create a new hash-bound preregistration. If any row is malformed,
identity-mismatched, unserved, or missing settlement, mark it incomplete and
stop; do not repair it in place. No result from this smoke may influence
Optimizer V2, fleet adoption, semantic-loop defaults, or the dark hierarchical
planner/deep-research candidate.
