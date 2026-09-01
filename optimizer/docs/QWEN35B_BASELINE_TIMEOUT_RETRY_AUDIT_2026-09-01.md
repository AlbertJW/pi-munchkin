# Qwen35B baseline timeout-retry audit (2026-09-01)

## Outcome

The explicitly approved timeout-only replacement run completed one base
replicate for `parens`, `equil`, and `bigdata` under invocation `3c3dd2` with
`PI_TIMEOUT=480`. The longer bound changed the result, but did not make the
screen uniformly admissible: `equil` is one authoritative row, while
`parens` and `bigdata` remain voided infrastructure evidence. No row from this
run is a Qwen quality result, candidate result, fleet result, or adoption
signal.

The trial-validity sidecar reports `infra_valid` PASS for `equil` and FAIL for
the other two rows. All three local fixture gates passed (`score=1`, `gate=1`),
but a passing fixture is not enough to establish a valid model episode.

## Safe provenance and validity

All three rows carried complete authenticated provenance with no mismatches:

- model/provider: `qwen36-35b-iq3s` / `llama`
- invocation: `3c3dd2`
- registry SHA-256: `ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf`
- baseline config SHA-256: `5306ecc5a68682ce8fe6d52d59e0171367cfae0f390965bc4956c0f9d706d379`
- loaded surface SHA-256: `636715442f82c348b430fbedc04fc42fbe149907356dea42fbe36f8ed19e0e8b`

Serving fingerprints were stable and provider usage was exact for every row.
The sidecar classifications were `infra_valid` FAIL 2 / PASS 1,
`low_timeout` PASS 3, `near_miss` PASS 3, `refusals` PASS 3, and
`reward_hacking` PASS 3. Difficulty and task-specification judging remained
pending because the judge calibration gate is not open.

## What the retry established

The 240-second bound in the original screen was too short for this subject.
The retry also shows that simply doubling it is not a sufficient protocol:

- `equil` reached a clean lifecycle settlement at about 451 seconds, with one
  failure-episode settlement summary and complete provider timing.
- `parens` and `bigdata` produced valid local mutations and test passes, but
  their sessions were still in tool-loop tails when the 480-second hard bound
  stopped them. Each lacked the required `agent_settled` lifecycle event and
  had zero provider/settlement timing records, so the reducer correctly marked
  the row incomplete. The transcript tails ended after tool activity rather
  than after a settled assistant turn.

This is fixture-sensitive long-tail behavior, not a provenance, serving,
sandbox, or grader mismatch. The `bigdata` row also recorded one exhaustive
`search_spans` call; that is useful trajectory metadata but cannot repair a
missing lifecycle settlement.

## Disposition

The retry is closed and must not be resumed or pooled. Do not launch another
Qwen screen by increasing the timeout again. Before the next approved model
run, characterize a graceful-stop path that gives Pi a bounded opportunity to
finish the current tool call, flush telemetry, and emit exactly one settlement
before the hard safety cap. The path must preserve the existing rule that an
interrupted or duplicated settlement is void evidence; it must not synthesize
success from a partial transcript.

The next model-quality step remains a fresh Qwen-specific preregistration after
that lifecycle work, with a small admitted screen and an explicit wall-clock
policy. No semantic-loop, planner/deep-research graph, optimizer candidate, or
adoption screen is authorized by this result.
