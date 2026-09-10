# Qwen context-admission current-source V1 — launcher failure audit (2026-09-10)

The prepared V1 run `761d7f6f-ee6d-448c-9982-057d2f63c390` did not reach
Qwen. Both cells exited at Pi startup; the private receipt records zero
forwarded requests, no extension telemetry, and `passed: false`. The result is
therefore a launcher failure, not evidence for or against context admission.

The root cause was reproduced offline: the runner supplied an isolated
`models.json` file through Pi's `--models` option, which is a model-selection
filter, rather than writing the file inside `PI_CODING_AGENT_DIR`. The repair
places the private model config in the isolated agent directory and validates
the launcher with `pi --list-models` before a new screen.

V1 is retained as historical negative evidence. It is not extended or
reclassified. Any actual Qwen treatment measurement uses the separately frozen
V2 manifest and approval hash.
