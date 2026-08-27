# Preregistration: Qwen 35B bounded baseline/shadow screen (2026-08-27)

## Status and scope

Prepared before inference. This is a bounded baseline/observability screen for
the first real evaluation subject after model-neutral tool-contract
qualification. It is not a candidate comparison, semantic-loop efficacy study,
adoption decision, or rollout. The planner and hierarchical deep-research
graph remain dark.

The screen is authorized only at the explicit `--calibrate` invocation below.
No test, gate script, or rollout automation invokes it by default. Results stay
outside the repository and are summarized as safe aggregates only.

## Subject and pinned surface

- Requested and resolved model: `local-llamacpp/qwen36-35b-iq3s`
- Transport: llama-swap OpenAI-compatible endpoint at loopback; `MODEL_CONTROL=llama`
- Source checkout: `b9955a16753c4674a969fa5b79aa0a378938ffc5`
- Loaded Pi agent surface SHA-256: `455bba5ae1b2e041bea7cb7d45453a1491e839ae1253b8904e27cb8d37dd52d0`
- Source surface SHA-256: `79f300f9f9a5ba9a24bdce62c61cda335105c9f47fc40d2a8eae18d213fcf404`
- Registered-model catalog SHA-256: `d54d4c1a13f0835899dd37a97222873c54f9b78eb3f8e08a94dbc980a0182e11`
- Baseline config SHA-256: `5306ecc5a68682ce8fe6d52d59e0171367cfae0f390965bc4956c0f9d706d379`
- Candidate config: none; both gate arms are excluded from this screen

The loaded surface hash is authoritative for each gate row. The source hash
documents the checkout that produced this preregistration; it is not substituted
for a loaded-surface mismatch. Registry and baseline hashes are pinned by the
runner and a mismatch fails closed.

## Question and estimand

Can the current Qwen 35B baseline run through the existing gate with stable
parent provenance, authenticated telemetry binding, fixture isolation, and
ordinary baseline task outcomes after the identical Ling/Qwen tool-contract
qualification? The screen estimates only per-fixture baseline completion and
provenance health under the current serving configuration. It does not estimate
cross-model equivalence, treatment effect, or candidate benefit.

## Design

- Arm: `base` only, via `--calibrate`.
- Replicates: `N=3` per fixture, `REP_START=1`.
- Fixtures: `parens`, `equil`, `bigdata`; each was authoritative at preregistration.
- Network policy: `GATE_NETWORK=endpoint`; sandbox remains on.
- Model alias: `PI_MODEL=qwen36-35b-iq3s` (the registered llama-router alias).
- Exact usage: required; a row without authenticated usage is not accepted as
  authoritative evidence.
- Planner/deep-research flags: unchanged and dark. No `deep-research-*` config,
  semantic-loop candidate, mirror, or rollout flag is passed.
- Run and result artifacts: private paths under `/private/tmp`; no raw row,
  source, tool argument, command, or prompt payload is copied into this file.

The bounded size is deliberate: this is a provenance and baseline screen, not a
power study. A failed health check, identity mismatch, serving-fingerprint
instability, fixture drift, or missing exact usage fails the affected result;
there is no silent pooling or retry-based repair.

## Preflight (no inference)

```sh
GEN=qwen35b-baseline-shadow-20260827 \
N=3 ARM=base \
PI_MODEL=qwen36-35b-iq3s \
AGENT_MODELS_SHA256=d54d4c1a13f0835899dd37a97222873c54f9b78eb3f8e08a94dbc980a0182e11 \
REAL_GATE_RUNS=/private/tmp/qwen35b-baseline-shadow-runs-20260827 \
RESULTS=/private/tmp/qwen35b-baseline-shadow-20260827.jsonl \
  ./real_gate.sh --dry --calibrate parens equil bigdata
```

## Explicit execution boundary

Only after the preflight is clean, a human may run the same command without
`--dry`:

```sh
GEN=qwen35b-baseline-shadow-20260827 \
N=3 ARM=base \
PI_MODEL=qwen36-35b-iq3s \
AGENT_MODELS_SHA256=d54d4c1a13f0835899dd37a97222873c54f9b78eb3f8e08a94dbc980a0182e11 \
REAL_GATE_RUNS=/private/tmp/qwen35b-baseline-shadow-runs-20260827 \
RESULTS=/private/tmp/qwen35b-baseline-shadow-20260827.jsonl \
  ./real_gate.sh --calibrate parens equil bigdata
```

The model-running command is intentionally absent from automated tests and
rollout scripts. The endpoint must be the already-qualified Qwen 35B service;
changing the provider, model alias, registry, surface, or baseline hash starts
a new preregistration rather than creating a new result row under this one.

## Acceptance and reporting

Accept only rows whose parent session identity, authenticated telemetry identity,
requested/resolved model, registry hash, baseline hash, and loaded surface hash
agree exactly. Summarize counts by fixture and safe status classifications
(`completed`, `verification-passed`, recovery outcome, or failed reason). Do not
report raw prompts, tool arguments, source, paths, commands, or telemetry
payloads. `pi.tool-contract/v1` records remain qualification-only and are not
eligible for this baseline result or for fleet/adoption reporting.

No candidate is selected from this screen. If provenance is clean, the next
separate gate is a Qwen-35B-specific preregistration for one dark semantic-loop
mechanism candidate. Hierarchical planner/deep-research graph work remains a
separate research-shaped screen.

## 2026-08-27 execution outcome (non-authoritative; preregistration superseded)

The dry preflight passed and the pinned loopback router reported the requested
Qwen 35B alias. The explicit run was then stopped after four base rows (three
`parens`, one `equil`) completed with binary gate score 1 and exact provider
usage. None of those rows is evidence: every row was marked incomplete because
the deployed context reducer could not validate the canonical parent identity.

Two source/deployment defects were isolated:

1. The reducer emitted the older `run_id`/`provider`/`model` provenance shape,
   while the gate validator requires `session_id`/`invocation_id` and resolved
   identity fields. The launcher also had not transported the invocation id
   into telemetry.
2. `plan-runner` can attach a transient `unknown` provider/model snapshot. The
   deployed envelope allowed that detail to override the launcher's canonical
   identity, producing a provider mismatch in the authenticated stream.

The source now transports `PI_GATE_INVOCATION_ID`, reduces the telemetry
identity into the canonical schema (while retaining safe historical aliases),
and gives gate environment identity precedence over detail snapshots. Regression
tests and the context-telemetry self-test pass. The live mirror was not changed:
its safety gate correctly refused a force-apply because this checkout is not
pushed, and no automatic live rollout is authorized. The interrupted `equil`
replicate had reached a roughly 1.1 MB model response and 17+ minutes; it was
terminated to keep the screen bounded. Its branch is incomplete, not pooled.

This preregistration must not be resumed or pooled. After a human pushes the
source commit, applies the deliberate mirror, records the new loaded surface
hash, and creates a replacement preregistration, rerun a smaller, explicitly
bounded Qwen baseline/provenance screen. No planner/deep-research graph or
semantic-loop candidate may be enabled by that rerun.
