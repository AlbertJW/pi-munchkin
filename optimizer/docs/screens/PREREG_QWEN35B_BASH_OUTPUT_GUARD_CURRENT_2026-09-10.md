# Preregistration: current-source Qwen bash-output guard value screen (2026-09-10)

## Scope

This replaces the older mechanism-only receipt with a fresh, current-source,
matched four-case screen. It measures process completion, a fixed final-answer
oracle, tool/recovery counts, visible output volume, guard exposure, and false
positives. It is still too small to support default adoption.

## Frozen identity

- Revision: `qwen35b-bash-output-guard-v1`
- Requested/served model: `local-llamacpp/qwen36-35b-iq3s` /
  `qwen36-35b-iq3s`
- Manifest SHA-256: `4ef80cda002c330aaadfd485b68ca21356b010bd26701c4cf4870ef557be76c1`
- Probe SHA-256:
  `c122211aae6094c9758135c5a70b06cb3efb6f5cb85933b31fd0008f8dbef3eb`
- Guard SHA-256:
  `f801944352d31b95bf50962aa7e3430ffda624a387a6bfb6f12fb83b66557e67`
- Approval SHA-256:
  `1a3f1f0425ce5b6bad7cbd28ca08aa521416771b8fbfb374dce9058f36846813`

Each fresh, private case runs a single pinned model with Bash as its only tool.
The case order is control ordinary, treatment noisy, treatment ordinary,
control noisy. Each has a fixed final-answer oracle held as a hash in the
result, a 180-second wall, and no more than four provider requests. The local
proxy fails further provider calls rather than silently allowing a loop.

## Hypothesis and criteria

The noisy task asks for one controlled oversized shell result; the ordinary
task asks for one short result. The treatment should withhold exactly the noisy
result above the 8,000-character threshold, permit no ordinary false positive,
and still complete with its matching final oracle. Controls should never emit a
withheld row and should complete the same task.

The result retains only safe facts: exit/timeout, proxy count, tool-call/error
counts, visible-output byte counts, final-answer hash comparison, and guard
telemetry counts. Raw commands, prompts, shell output, model text, endpoints,
and model errors are never public screen data.

A clean screen requires all four cases to exit successfully, make exactly one
Bash execution, reach their final oracle, stay under their provider-call cap,
and meet their declared guard exposure. It reports recovery cost and output
volume comparatively but does not preregister a task-quality winner from one
replicate. Any failure is recorded as incomplete; it is not retried under this
manifest.
