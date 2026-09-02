# Preregistration: Qwen 35B semantic-loop delivery screen (2026-09-02)

## Status and purpose

**EXECUTED — incomplete/voided 2026-09-02.** This is the follow-up to the failed
Qwen mechanism screen and the successful shutdown-lifecycle retest. It asks
whether the current `LOOP_EPISODE_MODE=enforce` surface can deliver a semantic
failure-episode intervention and an arbiter decision within a bounded session.
It is not a powered efficacy study, quality comparison, or adoption request.

The earlier screen used an older loaded surface and left active-tool tails
unsettled. The shutdown retest now shows that external aborts settle cleanly on
the current surface. This screen therefore uses a shorter, completion-bounded
envelope and treats any timeout as an explicit incomplete observation rather
than a negative result.

## Frozen identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`
- Source branch: `codex/qwen35b-provenance`
- Source tip: `6f1234c`
- Package source surface SHA-256: `b929b6b2239f364be90a9bb012881d291260caf11bb38b10c2c22afc79a07917`
- Loaded Pi surface SHA-256: `251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`
- Model-registry SHA-256: `ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf`
- Control config SHA-256: `5306ecc5a68682ce8fe6d52d59e0171367cfae0f390965bc4956c0f9d706d379`
- Candidate config SHA-256: `72346849b6358bdf542457ddcea2b3ae19dabb8be56ef7a3e4862cfafc57a7f7`
- Rendered governor SHA-256: `3e44c844705d1f39ddb2d3b231a7fe4a44db10307ca60c6ab666b90cd646b004`

The private manifest binds these values and is held outside Git. Any identity
drift, missing/duplicate settlement, unstable serving fingerprint, invalid
trial sidecar, or raw sensitive payload voids the screen.

## Fixture slate and bound

Run one candidate-arm session for each of `sweep-c` and
`ling-exact-gate-recovery`, in that order, with `PI_TIMEOUT=180`. The candidate
configuration alone changes `LOOP_EPISODE_MODE` to `enforce`; all other dark
candidate flags remain unchanged. Both fixtures are already admitted loop
shapes and share the same project gate, sandbox, loopback endpoint, and model
identity. The screen runs the dry gate first and executes only against the
resident pinned model after `mirror:check` is clean.

Exposure is reported only when a row has both a non-empty
`failure-episode/intervention` proposal and a matching
`control-arbiter/decision` with `winner_reason=semantic_tier`. A proposal alone
is pre-empted, not delivered. Each row must also have exactly one authenticated
failure-episode settlement and complete provenance. A timeout or malformed
sidecar is incomplete evidence and cannot count for or against the candidate.

## Decision and follow-up

If at least one fixture produces a valid delivered decision and both rows settle,
record the mechanism receipt and prepare a separate powered paired efficacy
preregistration. If neither fixture delivers, record a clean non-exposure result
for this subject/fixture envelope and explicitly retire semantic-loop enforcement
from the near-term adoption queue; do not keep retrying the same prompt shape.
In either case, leave `LOOP_EPISODE_MODE=shadow`, `PLAN_GRAPH=off`, and
`DEEP_RESEARCH_PLANNING=off`. The planner graph may proceed only after this
delivery boundary is closed or explicitly retired, with its own research-shaped
screen and fresh hash.

## Execution receipt

Private manifest digest: `ac2e465afec55c997c484d6709f8d94838a48eed1705b2c5b3ae927039f64d51`.
The first candidate session (`sweep-c`) ran under the 180-second bound and was
still mutating when the gate stopped it: 31 turns, 36 tool calls, six tool
errors, and six failure episodes opened. It emitted zero
`failure-episode/intervention` events and no authenticated settlement summary;
the row was therefore incomplete/voided by trial validity. The second fixture
was not started after the declared stop condition. No semantic exposure,
efficacy, or adoption inference is valid.

Together with the earlier three-fixture screen, this is repeated evidence that
the current Qwen/fixture envelope is not a practical delivery subject. The
semantic-loop candidate is retired from the near-term Qwen adoption queue,
pending a redesigned, bounded fixture and a fresh preregistration. This is a
scope/operability retirement, not proof that the mechanism is ineffective.

## Privacy and rollback

All manifests, rows, traces, and validity sidecars remain outside the repository
with private permissions. Summaries contain classifications and digests only.
No source, mirror, default, or historical evidence is changed by this screen.
