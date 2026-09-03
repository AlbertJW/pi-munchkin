# Preregistration: Qwen 35B bounded baseline/provenance screen (2026-09-01)

## Status and scope

This supersedes the 2026-08-27 Qwen replacement preregistration. Its pinned
surface became stale when the goal/context rollout and recovery fixes shipped;
rows from the earlier surface remain non-authoritative and are not resumed or
pooled. This is a short base-only provenance and baseline screen. It is not a
candidate comparison, semantic-loop efficacy study, adoption decision, or
rollout. Planner and hierarchical deep-research graph features remain dark.

No model execution is authorized by this document until the no-inference
preflight below passes and a human explicitly removes `--dry`.

## Subject and pinned surface

- Requested and resolved model: `local-llamacpp/qwen36-35b-iq3s`
- Transport: loopback llama-swap OpenAI-compatible endpoint; `MODEL_CONTROL=llama`
- Source branch: `codex/qwen35b-provenance`
- Source commit: `f9fcb7e` (documentation boundary receipt)
- Package-source surface SHA-256: `f6b0c3334007de66f218c4e97fd6fc66f57af54bd5653e6697d358291c99fd86`
- Loaded Pi agent surface SHA-256: `636715442f82c348b430fbedc04fc42fbe149907356dea42fbe36f8ed19e0e8b`
- Live mirror: `/Users/Albert.Wessels/.pi/agent`; `mirror:check` 122/122, zero unmanaged extensions/orphans
- Registered-model catalog SHA-256: `ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf`
- Baseline config SHA-256: `5306ecc5a68682ce8fe6d52d59e0171367cfae0f390965bc4956c0f9d706d379`

The loaded surface hash is authoritative for every row. The source hash is a
review aid only; it is not substituted for a loaded-surface receipt.

## Question and estimand

Can the corrected harness run one bounded Qwen 35B baseline replicate per
fixture with stable parent identity, authenticated telemetry binding, fixture
isolation, exact usage, and ordinary gate outcomes? This estimates only a small
baseline/provenance health sample. It makes no claim about cross-model
equivalence, model quality, treatment effect, or adoption.

## Design and bound

- Arm: `base` only, through `--calibrate`.
- Replicates: `N=1`, `REP_START=1` (three total fixture rows).
- Fixtures: `parens`, `equil`, `bigdata`.
- Per-row process bound: `PI_TIMEOUT=240` seconds; a timeout is incomplete
  evidence, not a successful or pooled result.
- Network policy: `GATE_NETWORK=endpoint`; sandbox remains on when available.
- Exact provider usage, parent identity, requested/resolved model, registry
  hash, baseline hash, and loaded surface hash are mandatory for authority.
- No retries, candidate arm, semantic-loop configuration, planner graph, or
  deep-research profile is enabled.

The 240-second bound is a safety boundary motivated by the superseded run's
roughly 1.1 MB, 17-minute `equil` response. It limits damage; it does not turn
a truncated or interrupted row into evidence.

## No-inference preflight

```sh
GEN=qwen35b-baseline-20260901 \
N=1 REP_START=1 ARM=base PI_TIMEOUT=240 \
PI_MODEL=qwen36-35b-iq3s \
AGENT_MODELS_SHA256=ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf \
REAL_GATE_RUNS=/private/tmp/qwen35b-baseline-20260901-runs \
RESULTS=/private/tmp/qwen35b-baseline-20260901.jsonl \
  ./real_gate.sh --dry --calibrate parens equil bigdata
```

## Explicit execution boundary

Only after the preflight is clean, a human may run the identical command
without `--dry`:

```sh
GEN=qwen35b-baseline-20260901 \
N=1 REP_START=1 ARM=base PI_TIMEOUT=240 \
PI_MODEL=qwen36-35b-iq3s \
AGENT_MODELS_SHA256=ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf \
REAL_GATE_RUNS=/private/tmp/qwen35b-baseline-20260901-runs \
RESULTS=/private/tmp/qwen35b-baseline-20260901.jsonl \
  ./real_gate.sh --calibrate parens equil bigdata
```

The endpoint must be the already-qualified Qwen alias. A provider, model,
registry, baseline, or surface change starts a new preregistration.

## Acceptance and reporting

Accept only rows whose parent `session_id`/`invocation_id`, authenticated
telemetry identity, requested/resolved model, registry/config hashes, and
loaded surface hash agree exactly. Report safe aggregate classifications only:
completed, verification-passed, recovery outcome, or bounded failure reason.
Do not copy prompts, tool arguments, commands, source, paths, or raw telemetry
payloads into reports.

`pi.tool-contract/v1` records remain qualification-only and are ineligible for
this baseline or fleet/adoption reports. A clean screen permits a separate
Qwen-35B-specific semantic-loop preregistration; it does not authorize one.
Hierarchical planner/deep-research graph work remains a separate
research-shaped screen.
