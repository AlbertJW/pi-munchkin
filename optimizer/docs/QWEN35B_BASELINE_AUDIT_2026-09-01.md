# Qwen35B baseline/provenance audit (2026-09-01)

## Outcome

The explicitly approved, current-surface screen ran one base replicate for
`parens`, `equil`, and `bigdata` under invocation `96faf8`. All three model
sessions completed their local fixture gates with `score=1` and `gate=1`.
None of the three rows is authoritative evidence, so this run must not feed a
fleet report, candidate decision, or adoption step.

The trial-validity sidecar voided all three rows for `infra_valid`. Each row
was marked `status=incomplete` and `authoritative=false` because the
authenticated failure-episode settlement summary was absent. The transcripts
ended at or near the 240-second session bound while a final tool turn was still
in flight; the Pi lifecycle therefore did not reach `agent_settled` and the
failure-episode reducer correctly refused to manufacture a settlement.

## Safe provenance audit

All three rows agreed on the following identity:

- model: `qwen36-35b-iq3s`
- provider: `llama`
- invocation: `96faf8`
- registry SHA-256: `ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf`
- baseline config SHA-256: `5306ecc5a68682ce8fe6d52d59e0171367cfae0f390965bc4956c0f9d706d379`
- loaded surface SHA-256: `636715442f82c348b430fbedc04fc42fbe149907356dea42fbe36f8ed19e0e8b`

The authenticated context provenance was complete with no mismatches for all
three rows. Serving fingerprints were stable, exact provider usage was present,
and the execution policy and sandbox were authoritative. The failure was
therefore a bounded lifecycle/settlement cutoff, not a model/provider or
identity mismatch.

Safe validity counts were: `infra_valid` FAIL 3/3; `low_timeout` PASS 3/3;
`near_miss` PASS 3/3; `refusals` PASS 3/3; `reward_hacking` PASS 3/3; and
`difficulty_crux`/`task_specification` PENDING_JUDGE 3/3 because the judge
calibration gate is not open.

## Disposition and next gate

The run is a useful harness finding, not a Qwen quality result. Do not resume
or pool it. A replacement preregistration is required before another model
run. It should explicitly choose a larger per-row wall bound (or a separately
characterized graceful-stop protocol) while retaining a hard safety cap; the
current 240-second bound is shorter than the time Qwen needed to reach a clean
agent settlement on these tasks. No semantic-loop, planner, deep-research, or
candidate screen is authorized by this audit.
