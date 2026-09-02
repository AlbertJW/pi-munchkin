# Qwen 35B bash-output guard paired audit (2026-09-02)

## Verdict

The paired mechanism screen is **CLEAN**. The treatment withheld the one
deliberately oversized result, delivered a bounded error-shaped diagnostic,
and stopped without a second oversized invocation. Both ordinary and noisy
control sessions completed without stderr, and the ordinary treatment session
was not withheld. This is reachability, specificity, and bounded-recovery
evidence only; it is not a quality, efficacy, gate, adoption, or rollout
result.

## Frozen identity and isolation

- Subject: `local-llamacpp/qwen36-35b-iq3s`.
- Source surface SHA-256:
  `b929b6b2239f364be90a9bb012881d291260caf11bb38b10c2c22afc79a07917`.
- Loaded surface SHA-256 for every session:
  `251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`.
- Four fresh RPC sessions used isolated project directories, one pinned model,
  and the preregistered order B-noisy, A-ordinary, B-ordinary, A-noisy.
- Each telemetry file had exactly one run identity and zero raw payload keys;
  stderr was empty for all four sessions. Raw model streams remain private
  and are not evidence in this report.

## Safe session results

| Session | Guard | Fixture | Exit / stderr | Tool calls | Tool errors | Turns | Withheld rows | Result |
|---|---|---|---:|---:|---:|---:|---:|---|
| B-noisy | on | 12,000-char output | 0 / 0 | 1 | 1 | 2 | 1 (`12000 > 8000`) | clean bounded recovery |
| A-ordinary | off | short marker | 0 / 0 | 1 | 0 | 2 | 0 | clean control |
| B-ordinary | on | short marker | 0 / 0 | 1 | 0 | 2 | 0 | no false positive |
| A-noisy | off | 12,000-char output | 0 / 0 | 1 | 0 | 2 | 0 | unguarded control |

The treatment therefore fired once on the noisy fixture and zero times on the
ordinary fixture; the controls fired zero times. The guarded noisy run had one
bounded tool error (the intended recovery path) and no second oversized call.

## Interpretation

The guard is reachable on Qwen 35B, does not fire on a short ordinary result,
and converts an oversized result into a recoverable error without breaking the
session. The screen does not measure whether the model completes a useful task
more often, spends fewer tokens, or suffers any quality regression. Keep
`BASH_OUTPUT_GUARD` dark until a later value screen covers representative
coding tasks and reports recovery cost, context use, false positives, and
correctness together.
