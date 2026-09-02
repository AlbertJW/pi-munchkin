# Qwen 35B graceful-shutdown smoke audit (2026-09-02)

## Verdict

**INVALID / lifecycle incomplete.** The three preregistered base-arm gate
rows all reached `gate=1`, but the authoritative trial-validity sidecar voided
all three for `infra_valid`. No row is Qwen quality evidence, baseline evidence,
or adoption evidence.

## Bound identity

- Preregistration: `PREREG_QWEN35B_GRACEFUL_SHUTDOWN_2026-09-02.md`
- Run invocation: `e7753a`
- Model: `local-llamacpp/qwen36-35b-iq3s`
- Source surface SHA-256: `03ed0ab76427cc3aa9c1cb160b2641b574362b5d268030bfd29716966448af1d`
- Loaded surface SHA-256: `7624ee447fb6a9a77f96e4abf5ee9b01580ddd478f3ae67b329f858761e07ca7`
- Registry SHA-256: `ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf`
- Baseline config SHA-256: `5306ecc5a68682ce8fe6d52d59e0171367cfae0f390965bc4956c0f9d706d379`

## Safe result summary

The `parens`, `equil`, and `bigdata` rows each reported a gate pass. The
sidecar reported `infra_valid: FAIL` for all three because the authenticated
failure-episode settlement summary was missing. The low-timeout diagnostic
failed for two rows and passed for one; it is diagnostic only and does not
restore authority. Serving fingerprints were stable and context telemetry was
authenticated, so the failure is specifically the missing settlement boundary,
not a model/provider identity mismatch.

Session inspection found the final assistant state still stopped at `toolUse`
for each row; no final settled callback was observed. This is an observation,
not a claim about the provider's internal cancellation path. The previous
extension unit test remains insufficient to qualify the full `timeout →
SIGTERM → active tool → runtime disposal` topology.

## Decision and next action

Do not resume, pool, or repair these rows. Do not rerun this command unchanged.
The graceful-stop path needs a deterministic active-tool cancellation fixture
and a red-green integration test that proves settlement after the gate timeout
topology. Any source change requires a new source/loaded hash boundary and a
new preregistration. Until that work is complete, Qwen baseline and
research-shaped screens remain unqualified.
