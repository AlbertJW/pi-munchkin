# Preregistration — Qwen 35B dynamic context epoch smoke (2026-09-02)

**Status: PREPARED — explicit mechanism smoke only.** This screen tests
protocol wiring for model-aware context profiles, serving-window discovery,
calibration, and safe handoff state. It is not a quality, efficiency,
calibration-capacity, or adoption result. No rows may be pooled with an older
surface or with the invalid graceful-shutdown run.

## Bound identity

- Subject: `local-llamacpp/qwen36-35b-iq3s` (the daily-driver model).
- Source commit: `da2e885` at preparation; source surface SHA-256:
  `03ed0ab76427cc3aa9c1cb160b2641b574362b5d268030bfd29716966448af1d`.
- Loaded mirror SHA-256: `7624ee447fb6a9a77f96e4abf5ee9b01580ddd478f3ae67b329f858761e07ca7`.
- Model registry SHA-256:
  `ac7ba5ebd4b8136d2ae127e77d0dc799e8c805552cb755ed2422693e605a7ccf`.
- Configuration: source defaults, `CONTEXT_DISCOVERY=on`,
  `CONTEXT_HANDOFF=off` for this first smoke; no goal, planner, candidate, or
  optimizer flags are enabled.

The discovery request is opt-in and local-only. A one-token calibration proves
serving-path reachability and is labelled `observed`; it is not a capacity
measurement. The serving probe reads only the local llama.cpp `/props` fact and
must never retain the raw endpoint in telemetry or reports.

## Procedure

Run one bounded non-interactive Pi turn from an isolated temporary agent
directory, with stdin closed and the pinned model selected explicitly:

```sh
CONTEXT_DISCOVERY=on CONTEXT_HANDOFF=off \
  pi -p --model local-llamacpp/qwen36-35b-iq3s \
  "Reply with exactly READY and no tool calls." < /dev/null
```

The operator must first verify that no Pi process is running and that the
loopback router is healthy. Capture only exit status, stderr byte count, safe
telemetry event kinds, authenticated surface/model identity, context epoch,
safe-input budget, calibration outcome, served-versus-registry verdict, and
whether any handoff was requested. Do not retain prompt/response text, raw
tool arguments, URLs, or private paths.

## Acceptance and interpretation

Pass requires exit 0, zero stderr, one authenticated
`runtime/context-profile`, one `runtime/context-calibration` with
`confidence=observed` (or an explicit bounded failure), and one
`runtime/serving-truth` row when the local probe is reachable. Every row must
bind the loaded surface and the pinned model; endpoint data must remain hashed.
Any missing or mismatched identity, raw endpoint, or unauthoritative row makes
the smoke invalid. A successful smoke establishes wiring only. Threshold
crossing, rearm, served-window shrinkage, and cross-provider/model switching
remain untested and require a separate preregistered multi-turn screen.

No default, dark flag, mirror, gate, benchmark, historical evidence, or rollout
decision changes as a result of this smoke.
