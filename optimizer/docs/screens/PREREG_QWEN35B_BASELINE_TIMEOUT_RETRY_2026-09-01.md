# Preregistration: Qwen 35B bounded baseline timeout retry (2026-09-01)

## Status and scope

This is a fresh timeout-only replacement for the 240-second screen recorded in
`QWEN35B_BASELINE_AUDIT_2026-09-01.md`. That run is permanently voided and is
not resumed or pooled. The only changed design variable is the per-row wall
bound: 480 seconds instead of 240. Model, provider, fixtures, arm, config,
surface, registry, sandbox, and telemetry protocol remain unchanged.

This remains a base-only provenance and baseline health screen. It is not a
candidate comparison, semantic-loop efficacy study, adoption decision, or
rollout. Planner and hierarchical deep-research graph features remain dark.

## Subject and pinned surface

- Requested and resolved model: `local-llamacpp/qwen36-35b-iq3s`
- Transport: loopback llama-swap OpenAI-compatible endpoint; `MODEL_CONTROL=llama`
- Source branch: `codex/qwen35b-provenance`
- Source commit: `db39840` (audit receipt documentation)
- Package-source surface SHA-256: `f6b0c3334007de66f218c4e97fd6fc66f57af54bd5653e6697d358291c99fd86`
- Loaded Pi agent surface SHA-256: `636715442f82c348b430fbedc04fc42fbe149907356dea42fbe36f8ed19e0e8b`
- Live mirror: `/Users/Albert.Wessels/.pi/agent`; `mirror:check` 122/122, zero unmanaged extensions/orphans
- Registered-model catalog SHA-256: `ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf`
- Baseline config SHA-256: `5306ecc5a68682ce8fe6d52d59e0171367cfae0f390965bc4956c0f9d706d379`

The loaded surface hash is authoritative for every row. The source hash is a
review aid only; it is not substituted for a loaded-surface receipt.

## Design and bound

- Arm: `base` only, through `--calibrate`.
- Replicates: `N=1`, `REP_START=1` (three total fixture rows).
- Fixtures: `parens`, `equil`, `bigdata`.
- Per-row process bound: `PI_TIMEOUT=480` seconds. A timeout is incomplete
  evidence, not a successful or pooled result.
- Network policy: `GATE_NETWORK=endpoint`; sandbox remains on when available.
- Exact provider usage, parent identity, requested/resolved model, registry
  hash, baseline hash, and loaded surface hash are mandatory for authority.
- No retries, candidate arm, semantic-loop configuration, planner graph, or
  deep-research profile is enabled.

The longer bound tests whether the prior void was caused by the Qwen tool and
settlement tail rather than by a permanent lifecycle incompatibility. It does
not relax provenance or turn an interrupted row into evidence.

## No-inference preflight

```sh
GEN=qwen35b-baseline-timeout-retry-20260901 \
N=1 REP_START=1 ARM=base PI_TIMEOUT=480 \
PI_MODEL=qwen36-35b-iq3s \
AGENT_MODELS_SHA256=ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf \
REAL_GATE_RUNS=/private/tmp/qwen35b-baseline-timeout-retry-20260901-runs \
RESULTS=/private/tmp/qwen35b-baseline-timeout-retry-20260901.jsonl \
  ./real_gate.sh --dry --calibrate parens equil bigdata
```

## Explicit execution boundary

Only after the preflight is clean, the explicitly approved retry may run:

```sh
GEN=qwen35b-baseline-timeout-retry-20260901 \
N=1 REP_START=1 ARM=base PI_TIMEOUT=480 \
PI_MODEL=qwen36-35b-iq3s \
AGENT_MODELS_SHA256=ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf \
REAL_GATE_RUNS=/private/tmp/qwen35b-baseline-timeout-retry-20260901-runs \
RESULTS=/private/tmp/qwen35b-baseline-timeout-retry-20260901.jsonl \
  ./real_gate.sh --calibrate parens equil bigdata
```

## Acceptance and reporting

Accept only rows whose authenticated gate identity, requested/resolved model,
registry/config hashes, loaded surface hash, stable serving fingerprint, and
exact usage agree, and whose lifecycle reaches exactly one failure-episode
settlement summary. Report safe aggregate classifications only. Do not copy
prompts, tool arguments, commands, source, paths, or raw telemetry payloads
into reports.

This retry does not authorize semantic-loop, planner, deep-research, candidate,
fleet, or adoption decisions. A clean screen permits a separate Qwen-specific
preregistration for those studies; it does not start one.
