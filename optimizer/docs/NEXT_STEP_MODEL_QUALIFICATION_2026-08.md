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

## 2026-08-27 execution attempt

The first explicit Ling run exposed a qualification-runner isolation defect: the
runner redirected Pi stdout to `trace.jsonl` inside the model's working directory,
so Ling could read its own growing trace and loop. The runner now captures stdout in
the parent and materializes the trace only after exit; it also seeds declared
case-local fixtures and passes a per-case tool allowlist.

Two retries were then stopped after the serving arm, not the harness, became the
limiting factor. The `ling3-tiny-fast` router returned multi-minute, 100--300 KB
responses or an empty stream after client timeout. A bounded direct provider probe
with `max_tokens: 8192` and `chat_template_kwargs.enable_thinking=false` returned
`OK`, which isolates the issue to Pi's provider/boot-level fast-mode path (Pi cannot
send arbitrary chat-template kwargs with this provider), not to the fixture capture.
No `pi.tool-contract/v1` aggregate was accepted or used as evidence, and Qwen was
not started. Re-run the explicit Ling screen only after the fast arm is confirmed to
honor thinking-off for Pi requests:

```sh
python3 optimizer/prompt-lab/tool_contract.py --run --confirm \
  --model local-llamacpp/ling3-tiny-fast \
  --output-dir /private/tmp/pi-tool-contract-ling-<date> \
  --output /private/tmp/pi-tool-contract-ling-<date>/result.json \
  --command /bin/bash -c 'extra=(); if [ -n "$TOOL_CONTRACT_TOOLS" ]; then extra=(--tools "$TOOL_CONTRACT_TOOLS"); fi; exec env PI_OBSERVATIONAL_MEMORY_PASSIVE=1 \
    /opt/homebrew/bin/timeout -k 10 120 pi --no-session --no-context-files \
    --no-prompt-templates --no-themes --thinking off \
    --model "$PI_MODEL" "${extra[@]}" --mode json \
    --print "$(cat "$TOOL_CONTRACT_PROMPT_FILE")" </dev/null'
```

This attempt remains a serving qualification blocker, not a model-quality result.

## 2026-08-27 accepted Ling smoke

After the isolation and protocol fixes, the explicit run completed all 10/10
manifest cases for `local-llamacpp/ling3-tiny-fast` using the unchanged
model-neutral command shape. The accepted rows were qualification-only and
were not sent to fleet/adoption tooling. The local oracles independently
confirmed: bounded read, span search/read, intentional shell failure plus
recovery, anchored edit persistence, write persistence, mutation followed by
`verify_project` and a passing fixture gate, capability activation, flat
`plan_write`, and `plan_update`. The result summary contained no raw tool
arguments, paths, commands, or source contents.

This qualifies the harness protocol and fixture/tool contract for the next
registered model; it does not qualify Ling's task performance or Qwen's
quality. The identical Qwen 35B screen is recorded below. The aggregate
context budgeting risk remains open and separate.

## 2026-08-27 accepted Qwen 35B protocol screen

The explicit run against `local-llamacpp/qwen36-35b-iq3s` completed 10/10
manifest cases with exit code zero and all local oracles passing. It used the
same manifest, isolated case directories, dynamic planning-capability path,
and model-execution boundary as the Ling run. The screen covered bounded
read/search, shell failure and recovery, anchored edit and write persistence,
post-mutation `verify_project`, capability activation, flat `plan_write`, and
`plan_update`. Its `pi.tool-contract/v1` result contained only safe
classifications and no raw tool arguments, paths, commands, or source
contents; fleet/adoption tooling cannot ingest that schema.

The first Qwen attempt (8/10) is superseded, not pooled: it exposed a
provider-format issue for nonzero Bash exit markers, an equivalent trailing
newline representation, and planner retries after malformed IDs. The reducer
now classifies bounded exit markers as execution failures, accepts only the
documented newline-normalized write value, marks interrupted processes
incomplete, and asks the planner fixture to omit IDs and stop after the
required calls. This is a protocol qualification, not a Qwen efficacy or
adoption verdict. The next step is a fresh Qwen-35B preregistration against
the current source surface, then a bounded baseline/shadow screen only after
that provenance audit. Planner/deep-research graph changes remain dark.

## 2026-08-27 baseline screen stopped before evidence

The fresh Qwen preregistration passed its no-inference preflight and began a
base-only screen. Four rows completed, but all were correctly rejected as
non-authoritative: the live reducer still emitted legacy provenance names and
the deployed telemetry envelope let a transient plan-runner `unknown` snapshot
split the provider identity. The source fix now adds an invocation-id envelope
field, canonical reducer mapping, gate identity precedence, and regression
coverage. Applying it to `~/.pi/agent` was refused by the deliberate-mirror
safety gate because the checkout is not pushed; therefore no new live surface
hash or result may be claimed. The run was interrupted after an `equil` branch
produced an unbounded ~1.1 MB response. Do not resume or pool that partial run.

Next operational gate: push the source fix, apply the human-gated mirror,
record the new loaded surface hash, write a replacement short-duration Qwen
preregistration, and repeat only the base provenance screen. Aggregate
per-turn context budgeting is now an observed safety concern, not a Qwen
quality result. Planner/deep-research graph work and semantic-loop candidates
remain dark.

## Explicit non-goals

This note does not claim cross-model task-success equivalence, does not authorize
inference or rollout, and does not treat a Ling qualification result as an
adoption verdict for Qwen 35B.
