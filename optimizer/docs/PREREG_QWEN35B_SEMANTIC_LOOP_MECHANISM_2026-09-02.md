# Preregistration: Qwen 35B semantic-loop mechanism screen (2026-09-02)

## Status and scope

**PREPARED — no semantic-loop session has started under this document.** This
is a replacement for the old 4B semantic-loop preregistration's first,
mechanism-only decision path. It is deliberately limited to exposure and
protocol integrity; it is not an efficacy study, a baseline screen, an
Optimizer V2 campaign, or an adoption request.

The question is whether `LOOP_EPISODE_MODE=enforce` can deliver the intended
failure-episode intervention on the current Qwen 35B serving subject, while
the control and candidate share every other surface/configuration choice. A
candidate session that merely loads the extension does not count: exposure
requires a proposed intervention and a corresponding delivered arbiter
decision, with the two counts reported separately.

## Frozen identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`
- Source branch: `codex/qwen35b-provenance`
- Source commit: `b71e0f7` (current documentation/source tip before this prereg)
- Package-source surface SHA-256: `03ed0ab76427cc3aa9c1cb160b2641b574362b5d268030bfd29716966448af1d`
- Loaded Pi surface SHA-256: `7624ee447fb6a9a77f96e4abf5ee9b01580ddd478f3ae67b329f858761e07ca7`
- Model-registry SHA-256: `ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf`
- Control config SHA-256: `5306ecc5a68682ce8fe6d52d59e0171367cfae0f390965bc4956c0f9d706d379`
- Candidate config SHA-256: `72346849b6358bdf542457ddcea2b3ae19dabb8be56ef7a3e4862cfafc57a7f7`
- Study seed: `20260902`

The private `pi.failure-episode-study/v1` manifest is generated outside the
repository and binds the same three fixtures, all hashes above, and its own
manifest digest. A model run is invalid if any identity differs or if the
manifest cannot be loaded and round-tripped before execution.

The source tip is included for audit chronology; the model-visible Pi surface
is unchanged by the gate timeout documentation and remains the authoritative
loaded identity. Any later source or mirror change requires a new
preregistration.

## Fixture slate and bounds

The first screen uses the approved loop-shaped fixtures `sweep-b`, `sweep-c`,
and `ling-exact-gate-recovery`. It runs one candidate-arm session per fixture
(`N=1`, three sessions total) with the existing `real_gate.sh` sandbox,
loopback endpoint, exact provider usage requirement, and a 480-second
per-session wall-clock bound. The base configuration is frozen and used only
as the comparison definition; no candidate and no other surface family is
co-tested.

The screen passes exposure only if at least two of the three candidate rows
contain a non-empty `failure-episode/intervention` proposal and at least one
matching `control-arbiter/decision` with `winner_reason=semantic_tier` proves
delivery. A row with an intervention proposal but no delivered decision is
reported as pre-empted, not as exposure. Every row must also have one
authoritative settlement, stable serving identity, complete provenance, exact
usage, and no telemetry schema rejection. A timeout, malformed sidecar,
reward-hacking signal, or unredacted research payload stops the screen and
cannot count as a negative efficacy result.

## Offline preflight

Create the private manifest and run the candidate-only dry gate before any
inference:

```sh
python3 prompt-lab/make_episode_manifest.py \
  --out /private/tmp/qwen35b-semantic-loop-20260902.json \
  --name qwen35b-semantic-loop-20260902 \
  --model qwen36-35b-iq3s \
  --fixtures sweep-b,sweep-c,ling-exact-gate-recovery \
  --seed 20260902

GEN=qwen35b-semantic-loop-mechanism-20260902 \
N=1 REP_START=1 ARM=cand PI_TIMEOUT=480 \
PI_MODEL=qwen36-35b-iq3s \
BASE=prompt-lab/configs/baseline.json \
CAND=prompt-lab/configs/pending/semantic-loop-enforce.json \
AGENT_MODELS_SHA256=ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf \
EXPERIMENT_MANIFEST=/private/tmp/qwen35b-semantic-loop-20260902.json \
EXPERIMENT_MANIFEST_SHA256=e740dc5693cb34f50ac29ba3bc62912ce53e157c4f7c062e2b00f7c4a2fa6ee9 \
REAL_GATE_RUNS=/private/tmp/qwen35b-semantic-loop-mechanism-20260902-runs \
RESULTS=/private/tmp/qwen35b-semantic-loop-mechanism-20260902.jsonl \
  ./real_gate.sh --dry sweep-b sweep-c ling-exact-gate-recovery
```

The dry output must show `ARM=cand`, the semantic candidate basename, all three
fixtures, `N=1`, and no result rows. The private manifest and its digest are
operator-held; neither is checked into Git.

## Explicit execution boundary

Only after the router reports the pinned model loaded, the live mirror is
122/122, and no Pi process is active may the operator run the identical command
without `--dry`. This stage remains a mechanism screen, not an adoption gate.
The old 4B calibration, powered-study assumptions, and historical exposure
figures do not pool with this Qwen screen. If the mechanism screen passes,
prepare a separate Qwen efficacy preregistration with a powered paired policy;
if it fails, diagnose exposure or fixture suitability before considering any
default change.

## Safety and stop conditions

Keep `PLAN_GRAPH=off`, `DEEP_RESEARCH_PLANNING=off`, `RESEARCH_LEDGER=off`,
`CONTEXT_HANDOFF=off`, and all other dark candidates unchanged. Stop on any
identity mismatch, duplicate/missing settlement, depth or budget anomaly,
child telemetry leakage, arbiter inconsistency, or active-tool tail that
reaches the bound without settlement. Never resume, repair, or pool a partial
screen. No source tree, live mirror, default, or historical result may be
modified by this study.
