# Preregistration: Qwen 35B semantic-loop shutdown retest (2026-09-02)

## Status and purpose

**PREPARED — lifecycle characterization only.** This boundary retests the
active-tool timeout path after the `telemetry-flush` shutdown-abort fix. It is
not an efficacy screen, adoption request, or claim that semantic-loop recovery
works. A timeout remains incomplete evidence even when the shutdown receipt is
durable.

The prior Qwen mechanism screen used an older loaded surface and left two
fixtures mutating at the wall-clock bound. This retest asks the smaller,
falsifiable question: when a candidate session is externally timed out while a
tool is active, does the current surface produce one authenticated settlement
before the gate's cleanup sweep? If the subject finishes normally, the result
is still only a normal-settlement control observation.

## Frozen identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`
- Source branch: `codex/qwen35b-provenance`
- Source tip: `a9f8726`
- Package source surface SHA-256: `b929b6b2239f364be90a9bb012881d291260caf11bb38b10c2c22afc79a07917`
- Loaded Pi surface SHA-256: `251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`
- Model-registry SHA-256: `ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf`
- Control config SHA-256: `5306ecc5a68682ce8fe6d52d59e0171367cfae0f390965bc4956c0f9d706d379`
- Candidate config SHA-256: `72346849b6358bdf542457ddcea2b3ae19dabb8be56ef7a3e4862cfafc57a7f7`
- Rendered governor SHA-256: `3e44c844705d1f39ddb2d3b231a7fe4a44db10307ca60c6ab666b90cd646b004`

The private manifest is held outside Git and binds these values. Any mismatch,
missing sidecar, duplicate settlement, or raw sensitive telemetry voids the
observation.

## Bounded procedure

Use two already-admitted loop-shaped fixtures, one candidate-arm session each,
with `PI_TIMEOUT=30` for the active-tail probe. The candidate remains
`LOOP_EPISODE_MODE=enforce`; all other dark candidates stay unchanged. Run the
dry gate first, then execute only after the loopback router reports the pinned
model and `mirror:check` is clean. Keep the private manifest, rows, and run
root outside the repository.

The lifecycle pass condition is exactly one authenticated
`failure-episode/settled` summary, a matching parent `session_shutdown`, stable
serving identity, and complete provenance. A row that reaches the timeout
without that settlement is explicitly **INCOMPLETE** and cannot count as
semantic exposure or a negative result. No source, mirror, defaults, or old
evidence may be modified by this procedure.

## Decision rule

If both fixtures settle through the current shutdown path, retire the active-tail
blocker and prepare a new, properly powered semantic mechanism preregistration
with a fixture envelope that can complete. If either fixture remains unsettled,
keep `LOOP_EPISODE_MODE=shadow`, retain the blocker, and treat the result as
subject/fixture suitability evidence only. In neither case may this retest
unlock `PLAN_GRAPH` or change live defaults.

## Rollback and privacy

This is a documentation/procedure boundary. Delete the private run root to
discard raw traces; the committed preregistration remains the audit record.
Summaries must contain classifications and digests only, never prompts, source
contents, tool arguments, URLs, or endpoint identities.

