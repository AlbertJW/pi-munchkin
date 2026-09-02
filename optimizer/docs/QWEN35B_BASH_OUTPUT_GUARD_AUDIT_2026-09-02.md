# Qwen 35B bash-output guard audit — 2026-09-02

## Verdict

**CLEAN MECHANISM RECEIPT.** The dark guard fired on one deliberately oversized
bash result and delivered a bounded recovery diagnostic on the pinned Qwen
serving path. This is not evidence of lower false positives, better task
quality, or adoption value.

## Bound identity

- Runtime source commit: `accdf89`
- Package-source surface SHA-256:
  `b929b6b2239f364be90a9bb012881d291260caf11bb38b10c2c22afc79a07917`
- Loaded Pi agent surface SHA-256:
  `251708fed05114ef0cb1617812d8662a96c39efeeb587ab829748ab5688f2b89`
- Subject: `local-llamacpp/qwen36-35b-iq3s`

## Safe observations

The disposable RPC run exited `0` with zero stderr and one settled lifecycle.
It emitted 43 safe rows in one session, all hash-bound to the loaded surface.
Exactly one `bash-output-guard/withheld` event recorded `chars=12000` against
`max_chars=8000`, with no suspected cwd escape. The run completed four
successful provider turns, and the failure-episode and verification extensions
observed the bounded error path. No raw command or output was retained.

## Interpretation and next gate

The trigger mechanism is live for Qwen. The candidate remains dark: the next
study must use paired noisy and ordinary commands to measure false positives,
recovery cost, and task impact before any default or adoption decision.
