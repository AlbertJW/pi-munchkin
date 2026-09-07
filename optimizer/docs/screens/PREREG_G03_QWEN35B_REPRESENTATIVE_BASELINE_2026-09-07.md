# G03 Qwen 35B representative-baseline runbook (2026-09-07)

## Status and boundary

Prepared, but not executed. This is the first real model-quality baseline for
the frozen G03 pilot; it is not an optimizer campaign, rollout, or adoption
decision. Ling remains a protocol-qualification subject and must not be pooled
with this Qwen cohort. No model session may start until the human explicitly
approves the resolved hashes below and Pi/llama-swap is confirmed healthy.

## Frozen identities

- Subject: `local-llamacpp/qwen36-35b-iq3s` (Qwen 35B adoption cohort)
- Benchmark file SHA-256: `c17737ae192126e014f2895cca61b2d85cdeb40896c91602b331755ba62561e7`
- Benchmark canonical identity: `146484896d16d15b19546d40ca22c84bdeef3054b67a9cd3355f0a3785f789c7`
- Preregistration canonical identity: `d794fea7af33afd0d329d5e135c74b85f1ed618a060e3b8fbf6c2cc0e6fefd7e`
- Source commit: `7ea9652`
- Baseline config SHA-256: `5306ecc5a68682ce8fe6d52d59e0171367cfae0f390965bc4956c0f9d706d379`
- Candidate config SHA-256: `47c9a04ca233ff552ff71e4e4f77003244cb148d8704f38fb62d2f5cf615b639`
- Loaded surface SHA-256: `9aed85c14ebae22b7f255d00fbe9eb7a8a90b023a450291837ef9cf40e67bc18`

The twelve-case pack is fixed at six train, four development, and two opaque
test cases. The run must preserve those assignments, use seeds `11` and `29`,
one repetition, the 900-second case bound, the 14,400-second pack bound, and
the declared tool/retry/output limits. Arm order is the deterministic hash of
`20260907:case_id:seed:repetition`.

## No-inference preparation

Run the offline preparation and retain its report digest:

```sh
python3 -m optimizer.v2.baseline --dry \
  --preregistration optimizer/v2/examples/g03-baseline-preregistration.json
```

The resulting protocol report is expected to be
`5b24391d650ea5371e4b0b09d28d0e588f7e6155c0b92094384af4a0b3989c61`.
It must remain `model_quality_evidence=false`; its twelve-case coverage ledger
must mark both opaque test cases as `excluded` with reason
`opaque_test_quarantined`.

## Execution procedure

Before execution, verify a clean `real_gate.sh --dry` response, resolve the
requested and served provider/model identity, and write a private run receipt
containing the preregistration and loaded-surface hashes. Execute the matched
baseline and candidate arms over the train/development cells only. The existing
Pi gate remains authoritative for coding, recovery, documentation, and
long-context fixtures; research-shaped fixtures require the research adapter
to emit the same redacted row contract before this twelve-case baseline can be
called complete. Do not substitute the older three-fixture Qwen screens: their
surface and lifecycle identities differ and their rows are permanently
non-authoritative.

Every attempted cell must produce one safe row, including `invalid`, `timeout`,
or `excluded` outcomes with a bounded reason. A row is authoritative only when
its parent session, requested/resolved model and provider, registry/config/
surface hashes, authenticated telemetry, fixture/admission/oracle receipts,
and isolation policy agree. Child telemetry must remain
`unavailable-contained`, never zero. Record primary success, unsupported-claim
and unwanted-continuation guards, tool calls/retries, wall time, input/output
tokens, compactions, and recovery outcomes. Keep any Codex reference in a
separate, visibly unpooled section.

## Stop and reconstruction rules

Stop the run on identity drift, malformed or missing sidecars, an unverified
mutation, a budget or isolation violation, an open timeout tail, or any hard
guard failure. A ceiling, floor, insufficient discrimination, or incomplete
cohort is an explicit `inconclusive` result, not a reason to change the pack or
extend the campaign. Store the immutable pack/preregistration files, private
receipt directory, safe trial rows, and review packet; a reviewer must be able
to reconstruct all classifications without rerunning inference. Selection and
adoption remain human-only and are not authorized by this runbook.

Current external blocker: Pi/llama-swap is down (`real_gate.sh --dry` reports
`server: DOWN`), and the research-shaped live adapter is not yet wired. The
offline registry and protocol are complete; G03-C remains open until a fresh,
fully bound Qwen run covers the declared cohort.
