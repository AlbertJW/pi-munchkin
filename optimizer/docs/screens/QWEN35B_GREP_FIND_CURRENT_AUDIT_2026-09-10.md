# Audit: current-source Qwen native grep/find mechanism screen (2026-09-10)

## Result

This screen is **incomplete and unresolved**. It must not be rerun under the
same manifest. The private, mode-0600 receipt has SHA-256
`e9f19a4cee79de2db6d54e87f75798702e48080e845445d9c3b493ef939ce38b`.
It was run as `1343d9ae-ea10-4113-9b9e-888a1dd83c56` under approval
`97a3a6431500d9443ac5ccc8e828f0070ba95afff2ad4da99f422dc600002432`.

Both fresh Qwen arms exited successfully after exactly one forwarded provider
request, without timeout or a request-cap breach. Neither reached the fixed
final-answer hash and neither emitted any safe builtin tool-execution event.
The control correctly recorded zero native calls, but treatment also recorded
zero `grep` and zero `find` calls. Therefore neither arm completed and treatment
exposure was not observed.

## Interpretation and next action

This does not establish that `GREP_FIND_TOOLS=on` is ineffective: with no tool
call, the result cannot distinguish Qwen declining the task from a failure to
surface the pair in the spawned session. The screen's source and environment
were bound, but V1 did not persist an active-tool roster before provider
dispatch. It is an incomplete measurement, not a task-quality result or a
candidate retirement.

The candidate remains dark and unresolved. A separately preregistered V2 must
first record a safe active-surface receipt for both arms, then test actual
native invocation. No default, mirror, deployment, or adoption decision
changed.
