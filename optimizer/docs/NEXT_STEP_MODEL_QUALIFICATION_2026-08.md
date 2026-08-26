# Next step: model-neutral qualification (2026-08-26)

## Decision

The harness is qualified as a protocol against any registered model. Ling is the
first smoke subject only. A passing Ling screen demonstrates that launch,
telemetry binding, fixture isolation, and the core tool contract work; it is not
evidence that Ling and a larger model have comparable coding capability.

The first real evaluation/adoption cohort is Qwen 35B:
`local-llamacpp/qwen36-35b-iq3s`. No model-visible default, planner flag,
candidate, mirror, rollout, or live inference is implied by this implementation.

## Findings carried forward

- The gate had a signed telemetry channel, but did not pass the same per-session
  run/model/provider/config identity into the parent Pi process. Result rows could
  name a model while the authenticated event stream had null identity fields.
- Child Pi processes inherit gate telemetry configuration but not the parent file
  descriptors. Without an explicit policy they can fall back to the interactive
  telemetry file. Gate children are now contained (`TELEMETRY=off`); parent
  trajectory data records delegation while detailed child telemetry remains a
  later authenticated-collector package.
- Aggregate per-turn context budgeting remains an independent safety gap. It is
  intentionally not folded into this provenance package.
- Tool-contract rows use `pi.tool-contract/v1` and are rejected by fleet adoption
  code. They cannot inflate an efficacy result or promote a model.

## Implementation surface

- `optimizer/prompt-lab/gate_provenance.py` mints and validates the canonical
  parent-session identity.
- `real_gate.sh` binds that identity to the parent environment and result row;
  the reducer exposes and checks the same values.
- `harness/vendor/pi-subagent/runner-env.js` contains gate child telemetry and
  labels the policy `contained`.
- `optimizer/prompt-lab/tool_contract.py` and `tool-contract-v1.json` define a
  model-neutral, bounded core-tool screen. `--selftest` and `--dry` never invoke
  a model. `--run --confirm --model <registered-model> --command ...` is the
  explicit model-execution boundary and emits qualification-only rows.

## Ordered follow-up

1. Run the Ling smoke contract explicitly and inspect the provenance audit.
2. Run the identical contract protocol against Qwen 35B.
3. Reissue a Qwen-35B-specific preregistration against the current source
   surface; do not reuse the stale 4B semantic-loop preregistration.
4. Run a bounded baseline/shadow measurement only after provenance passes.
5. Select and preregister one dark mechanism candidate. Keep planner and
   deep-research graph work dark until a research-shaped screen evaluates it.
6. Address aggregate per-turn context budgeting as a separate safety package.

## Explicit non-goals

This note does not claim cross-model task-success equivalence, does not authorize
inference or rollout, and does not treat a Ling qualification result as an
adoption verdict for Qwen 35B.
