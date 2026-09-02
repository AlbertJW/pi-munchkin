# Preregistration: Qwen 35B bash-output guard trigger screen (2026-09-02)

## Status and scope

**PREPARED — mechanism screen only.** This bounded run tests that the dark
`BASH_OUTPUT_GUARD=on` surface withholds one deliberately oversized bash result
and returns a bounded recovery diagnostic to the model. It is not an efficacy,
false-positive, quality, gate, or adoption result.

## Frozen identity

- Runtime source commit: `accdf89`
- Package-source surface SHA-256:
  `b929b6b2239f364be90a9bb012881d291260caf11bb38b10c2c22afc79a07917`
- Loaded Pi agent surface SHA-256:
  `251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`
- Subject: `local-llamacpp/qwen36-35b-iq3s`
- Configuration: `BASH_OUTPUT_GUARD=on`, `BASH_OUTPUT_MAX_CHARS=8000`,
  `CONTEXT_HANDOFF=off`, `CONTEXT_DISCOVERY=off`, `GOALS=off`, telemetry on,
  one built-in `bash` tool, no saved session.

## Fixture and sequence

Send one instruction asking the model to use bash exactly once to emit 12,000
characters and then stop. The model must see the guard's bounded diagnostic;
the raw oversized result must not be retained in the report. The disposable
RPC driver has a 300-second wall bound and records only safe event counts,
statuses, hashes, and byte sizes.

## Acceptance and stop rules

Accept only if the process exits `0` with zero stderr, one
`bash-output-guard/withheld` row is emitted with `chars > max_chars`, the
result is marked as an error for recovery, and all telemetry carries the frozen
loaded surface hash in one session. A missing guard row, a raw payload,
multiple oversized executions, mixed identity, or a failed lifecycle makes the
screen incomplete. A clean trigger proves reachability only; paired noisy and
ordinary fixtures are required before any adoption decision.
