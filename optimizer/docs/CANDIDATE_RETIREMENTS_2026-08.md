# Candidate retirement register — 2026-08-12 draft

This register separates an active experiment from preserved history. Moving a
recipe here does not rewrite its recorded result and does not turn an old neutral
result into evidence of no effect. Every `NEUTRAL` below that predates the
2026-07-27 measurement audit is **historically recorded and currently UNTESTED**.
The old rounds were generally underpowered, often scored the wrong endpoint, and
frequently lacked mechanism exposure.

## Runtime paths prepared for retirement

| Path | Draft disposition | Reason |
|---|---|---|
| micro-gate and micro-gate slop | removed from loadable/package/control/telemetry surfaces; source archived | overlaps plan gates; efficiency benefit did not replicate |
| payload audit | removed from loadable/package surfaces; source archived | writes project-local high-frequency traces; default summary receipts make it unnecessary |
| redundancy nudge | code and full-mode forcing removed | forces expensive duplicate analysis to create a prompt nudge without powered benefit |
| state-lens `view|both` | per-call context mutation removed; `steer|off` retained | invalidates the serving prefix every call; event-driven steer owns the useful path |
| mandatory subagent-only edits | plan block and prompt branch removed | adds process/token cost and could not establish real exposure; ordinary additive delegation remains |

## Recipes removed from the active roster

The archived definitions preserve exact historical bytes under
`optimizer/prompt-lab/configs/retired/`: scaffold CoT, pause scaffold,
patient-streak, terse steer, taxonomy steers, prompt YAML, fresh retry, locality
retry, micro-gate, micro-gate slop, plan-subagent-only, redundancy nudge, and the
span-screen study. Their former neutral labels are historical/UNTESTED, not
rejections. No result, raw trajectory, methodology document, or verdict text is
deleted.

## Explicitly retained

- `c10-no-verify-gate` and `c25-harness-off` remain labelled suppression controls.
- `c35-bash-output-guard` and `c46-prompt-lean` remain active candidates.
- Explicit `CONTEXT_SURFACE_MODE=full` and gate-session full receipts remain.
- `BASH_OUTPUT_GUARD`, `RESEARCH_LEDGER`, `RUN_CAPSULE=recovery`, adaptive planning,
  phase activation, and semantic-episode enforcement are not part of this draft.

This branch is a prepared deletion PR only. Merging it, flipping prompt/control
defaults, publishing it, mirroring it live, calibrating, or starting a gate round
each requires its own stated checkpoint.
