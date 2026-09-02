# Preregistration: Qwen 35B graceful-shutdown settlement smoke (2026-09-02)

## Status and scope

**PREPARED — this document binds the current source and loaded mirror; the
execution command remains a separately approved action.** This reissues the
stale 2026-09-01 screen after the goal-schema compatibility fix and its live
mirror receipt. It is a base-only infrastructure screen for the graceful
shutdown path, not a candidate comparison, quality study, planner/deep-
research evaluation, adoption decision, or rollout.

The narrow question is whether, at the existing bounded gate timeout, Pi gives
an active agent enough time to emit exactly one authoritative settlement before
telemetry is flushed. A timeout, missing settlement, or invalid sidecar is
incomplete evidence and cannot count as a pass.

## Pinned identity

- Requested and resolved model: `local-llamacpp/qwen36-35b-iq3s`
- Transport: loopback llama-swap OpenAI-compatible endpoint; `MODEL_CONTROL=llama`
- Source branch: `codex/qwen35b-provenance`
- Source commit: `c85ded6` (goal grammar receipt; graceful-stop implementation remains `071874e`)
- Package-source surface SHA-256: `03ed0ab76427cc3aa9c1cb160b2641b574362b5d268030bfd29716966448af1d`
- Loaded Pi agent surface SHA-256: `7624ee447fb6a9a77f96e4abf5ee9b01580ddd478f3ae67b329f858761e07ca7`
- Registered-model catalog SHA-256: `ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf`
- Baseline config SHA-256: `5306ecc5a68682ce8fe6d52d59e0171367cfae0f390965bc4956c0f9d706d379`

The loaded hash is authoritative for every row. If the registry, config,
source, loaded mirror, serving identity, or model changes, stop and create a
new preregistration rather than pooling observations.

## Design and bound

- Arm: `base` only, through the existing `--calibrate` path.
- Replicates: `N=1`, `REP_START=1` (one row each for `parens`, `equil`, and `bigdata`).
- Per-row process bound: `PI_TIMEOUT=480` seconds, with the existing 30-second
  kill grace and 25-second settlement wait.
- Network policy: `GATE_NETWORK=endpoint`; sandbox remains on when available.
- No retries, candidate arm, semantic-loop configuration, planner graph, or
  deep-research profile is enabled.

Accept only rows whose authenticated gate identity, requested/resolved model,
registry/config hashes, loaded surface hash, stable serving fingerprint, exact
usage, and trial-validity sidecar agree, and whose lifecycle contains exactly
one authoritative failure-episode settlement summary. Reports may contain safe
classifications and timings only; never copy prompts, tool arguments,
commands, source, URLs, or raw telemetry.

## No-inference preflight

Run from `optimizer/` after confirming the pinned router and mirror state:

```sh
GEN=qwen35b-graceful-shutdown-20260902 \
N=1 REP_START=1 ARM=base PI_TIMEOUT=480 \
PI_MODEL=qwen36-35b-iq3s \
AGENT_MODELS_SHA256=ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf \
REAL_GATE_RUNS=/private/tmp/qwen35b-graceful-shutdown-20260902-runs \
RESULTS=/private/tmp/qwen35b-graceful-shutdown-20260902.jsonl \
  ./real_gate.sh --dry --calibrate parens equil bigdata
```

Dry mode must emit no evaluation rows and no model requests.

## Explicit execution boundary

Only after the preflight is clean and the serving identity remains pinned may
the operator run the identical command without `--dry`. The result is a
lifecycle/provenance receipt only. It cannot seed Optimizer V2, fleet reports,
semantic-loop decisions, planner/deep-research activation, or adoption.

## Stop and rollback conditions

Stop on any surface/config/serving mismatch, malformed row, duplicate or
missing settlement, unserved model, invalid sidecar, live-mirror drift, or
unredacted payload. Do not repair rows in place or resume them. If the source or
mirror changes, discard this command and prepare a new hash-bound screen.
