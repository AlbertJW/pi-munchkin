# Preregistration: Qwen 35B bash-output guard paired mechanism screen (2026-09-02)

## Status and scope

**PREPARED — no model session has run under this preregistration.** This
screen compares the dark `BASH_OUTPUT_GUARD` surface on one deliberately noisy
bash task and one ordinary small-output task. It measures trigger reachability,
false positives, and bounded recovery only. It is not an efficacy, quality,
gate, adoption, or rollout result.

## Frozen identity

- Source surface SHA-256:
  `b929b6b2239f364be90a9bb012881d291260caf11bb38b10c2c22afc79a07917`.
- Loaded Pi-agent surface SHA-256:
  `251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`.
- Subject: `local-llamacpp/qwen36-35b-iq3s`.
- Treatment: `BASH_OUTPUT_GUARD=on`, `BASH_OUTPUT_MAX_CHARS=8000`.
- Control: `BASH_OUTPUT_GUARD=off`; all other runner and extension settings
  are identical.
- Four fresh `--no-session` RPC sessions use isolated agent/project
  directories, one pinned model, and the same two prompts. The declared order
  is B-noisy, A-ordinary, B-ordinary, A-noisy.

## Fixtures and bounded procedure

The noisy fixture asks the model to use bash exactly once to emit 12,000
characters, then stop or recover with one bounded command if the treatment
withholds the result. The ordinary fixture asks it to use bash exactly once to
print a short marker and then answer in one sentence. Each process has a
600-second wall bound. Retained reports contain only exit status, stderr byte
count, safe telemetry event counts, guard status, surface/session identities,
and output byte counts. Raw commands, output, prompts, responses, and
endpoints remain private and are never copied into the audit.

## Acceptance and interpretation

The treatment is mechanism-clean only if the noisy arm emits exactly one
`bash-output-guard/withheld` event with `chars > max_chars`, returns an
error-shaped bounded diagnostic, and does not execute a second oversized
command. The ordinary treatment arm must not emit a withheld event. Both
controls must complete without stderr. Any mixed identity, raw payload, or
incomplete lifecycle makes that session **INCOMPLETE**. The screen can show
whether the guard is reachable and whether ordinary output is spared; it
cannot establish that the guard improves coding or research quality.

`BASH_OUTPUT_GUARD` remains dark regardless of this screen. A later value
study, if justified, needs representative coding fixtures and must report
recovery cost alongside correctness and context use.
