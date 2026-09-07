# G03 Qwen 35B representative-baseline runbook (2026-09-07)

## Status and boundary

Prepared, but not executed. This is the first real model-quality baseline for
the frozen G03 pilot; it is not an optimizer campaign, rollout, or adoption
decision. Ling remains a protocol-qualification subject and must not be pooled
with this Qwen cohort. No model session may start until the human explicitly
approves the resolved hashes below and Pi/llama-swap is confirmed healthy.

Readiness is currently invalidated by identity drift. The frozen values below
are historical bindings for this document, not permission to run: the current
worktree source resolves to `9aed85c14ebae22b7f255d00fbe9eb7a8a90b023a450291837ef9cf40e67bc18`
(frozen source `b0fae0e28b68a4fcac6c952be214b45e8bec9cb7880eb4ca284e1c161411f082`),
and the current live agent directory resolves to loaded surface
`5d7216b4e209c40033ec84b5929d68e7678e4a95046280f7c2c914a1ff061025`
(frozen loaded surface `184c9178950c38c2caf469f68bfee242bddbbf24af299172bd3a91d68511417a`).
Do not rewrite this frozen record. Reissue the pack/preregistration against a
stabilized source and loaded mirror before requesting execution approval.

## Frozen identities

- Subject: `local-llamacpp/qwen36-35b-iq3s` (Qwen 35B adoption cohort)
- Benchmark file SHA-256: `1fbe72a6d5c008ddc174e86d98c70c0e9616a3c586a624755f7b40462265292d`
- Benchmark canonical identity: `3cf87cdaad18b2cca4c8e8280140d924e269a238ec95d5b0d2f3dc972f5bf1da`
- Preregistration canonical identity: `b994cbe0e93e5b470a2b918f2104c39b272c099d75edea798142baef3dad2a28`
- Source commits: `1da150a`, `20adf3a`, `88faf05`, `8f30f10`, `6a30858`, `3039087`
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
`8cb81cfcad62b096135e09a8e55381eb7d4326f84cd7c428004fb8db56eb1a60`.
It must remain `model_quality_evidence=false`; its twelve-case coverage ledger
must mark both opaque test cases as `excluded` with reason
`opaque_test_quarantined`.

## Execution procedure

Before execution, verify a clean `real_gate.sh --dry` response, resolve the
requested and served provider/model identity, and write a private run receipt
containing the preregistration and loaded-surface hashes. Execute the matched
baseline and candidate arms over the train/development cells only. The existing
Pi gate remains authoritative for coding, recovery, documentation, and
long-context fixtures. After the run, pass its rows and exact validity sidecar
through `optimizer/v2/real_baseline.py --ingest` so every attempted cell is
classified under the frozen report contract. For each research-shaped cell, the
parent runner must first write one private `pi.research-trial/v1` artifact and
reduce it with `optimizer/v2/research_baseline.py --reduce`; the resulting V4
row/validity pair joins the gate rows before the shared reducer is invoked. The
adapter's metadata oracle checks only admitted claim IDs and parent-validated
original URLs, so an eloquent answer or a delegated citation cannot score by
itself. Do not substitute the older
three-fixture Qwen screens: their
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

The private reduction command is explicit and replayable once the research
adapter and gate artifacts exist:

```sh
python3 optimizer/v2/real_baseline.py --ingest \
  --rows <private>/rows.jsonl \
  --validity <private>/rows.jsonl.validity.jsonl \
  --preregistration optimizer/v2/examples/g03-baseline-preregistration.json \
  --case-tasks <private>/case-tasks.json \
  --run-id <gate-run-id> \
  --resolved-provider <resolved-provider> \
  --resolved-model qwen36-35b-iq3s \
  --output <private>/g03-real-baseline-report.json
```

`case-tasks.json` is a private, immutable mapping from every train/development
case ID to the distinct real-gate task name used for that run. The reducer
prints only the report digest, decision, evidence class, and trial count; the
full report remains mode `0600` and contains no prompts, transcripts, source
contents, or tool arguments.

## Stop and reconstruction rules

Stop the run on identity drift, malformed or missing sidecars, an unverified
mutation, a budget or isolation violation, an open timeout tail, or any hard
guard failure. A ceiling, floor, insufficient discrimination, or incomplete
cohort is an explicit `inconclusive` result, not a reason to change the pack or
extend the campaign. Store the immutable pack/preregistration files, private
receipt directory, safe trial rows, and review packet; a reviewer must be able
to reconstruct all classifications without rerunning inference. Selection and
adoption remain human-only and are not authorized by this runbook.

Current external blocker: the latest read-only `real_gate.sh --dry` reports
llama-swap serving `defiant-9b`, not the preregistered Qwen 35B subject, and the
frozen source/loaded-surface bindings have drifted. The offline registry, shared
reducer, and research row adapter are complete; G03-C remains open until a fresh
pack/preregistration revision and a fully bound Qwen run cover the declared
cohort and emit the required private research artifacts.
