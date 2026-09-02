# Preregistration: Qwen 35B post-foreground-timeout gate screen (2026-09-02)

## Status and scope

**PREPARED — no model execution is implied by this document.** This is the
first full gate preregistration after the duplicate-signal timeout fix. It is a
base-only infrastructure qualification: it does not compare candidates,
measure harness quality, seed Optimizer V2, evaluate planner/deep-research
graphs, or authorize adoption.

The question is whether fresh authenticated gate rows now carry a complete
failure-episode settlement sidecar when an active Qwen 35B session reaches the
bounded timeout path. Any missing, duplicate, or unauthenticated settlement
voids the affected row; a fixture gate pass alone is insufficient.

## Pinned identities

- Requested and resolved model: `local-llamacpp/qwen36-35b-iq3s`
- Transport: loopback llama-swap OpenAI-compatible endpoint; `MODEL_CONTROL=llama`
- Source branch: `codex/qwen35b-provenance`
- Gate source commit: `6ef1464`
- Package-source surface SHA-256: `03ed0ab76427cc3aa9c1cb160b2641b574362b5d268030bfd29716966448af1d`
- Loaded Pi agent surface SHA-256: `7624ee447fb6a9a77f96e4abf5ee9b01580ddd478f3ae67b329f858761e07ca7`
- Registered-model catalog SHA-256: `ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf`
- Baseline configuration SHA-256: `5306ecc5a68682ce8fe6d52d59e0171367cfae0f390965bc4956c0f9d706d379`

The loaded Pi surface is unchanged by this wrapper-only fix, but the gate
commit is part of this preregistration identity. If any identity changes,
discard this command and prepare a new one; never pool across the boundary.

## Design and limits

- Arm: `base` only, through the existing `--calibrate` path.
- Replicates: `N=1`, `REP_START=1`; one row each for `parens`, `equil`, and
  `bigdata`.
- Per-row wall-clock bound: `PI_TIMEOUT=480` seconds, with the existing
  30-second TERM grace and bounded settlement handling.
- Network policy: `GATE_NETWORK=endpoint`; Seatbelt sandbox remains required
  for hidden tasks when available.
- No retries, candidate arm, semantic-loop enforcement, planner graph,
  deep-research planning, calibration campaign, or optimizer provider.

Accept only rows whose authenticated gate identity, requested/resolved model,
registry/config hashes, loaded surface hash, stable serving fingerprint, exact
usage, and trial-validity sidecar agree. The sidecar must contain exactly one
authoritative failure-episode settlement for the session. Reports may retain
safe classifications and timings only; do not copy prompts, tool arguments,
commands, source, URLs, or raw telemetry.

## Offline preflight

Run from `optimizer/` after checking the pinned router and mirror. This must
emit no evaluation rows and make no model request:

```sh
GEN=qwen35b-graceful-shutdown-v2-20260902 \
N=1 REP_START=1 ARM=base PI_TIMEOUT=480 \
PI_MODEL=qwen36-35b-iq3s \
AGENT_MODELS_SHA256=ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf \
REAL_GATE_RUNS=/private/tmp/qwen35b-graceful-shutdown-v2-20260902-runs \
RESULTS=/private/tmp/qwen35b-graceful-shutdown-v2-20260902.jsonl \
  ./real_gate.sh --dry --calibrate parens equil bigdata
```

The dry output must show the endpoint policy, the pinned model, the three
fixtures, and `N=1`; the results file must remain empty.

## Explicit execution boundary

Only after the preflight is clean, the router reports the pinned model loaded,
the mirror is 122/122, and no Pi process is active may an operator run the
identical command without `--dry`. This is a fresh infrastructure receipt. It
cannot be resumed, pooled with the prior invalid screen, or used as evidence
for a model-quality or adoption decision.

## Stop conditions and interpretation

Stop on any source/loaded/config/registry/serving mismatch, malformed or
duplicate row, missing settlement, invalid sidecar, unserved model, stale
mirror, or unredacted payload. Do not repair rows in place. A valid row proves
the lifecycle protocol for that session only; it does not establish that every
long-running tool turn will finish within 480 seconds or that Qwen's task
performance is improved.
