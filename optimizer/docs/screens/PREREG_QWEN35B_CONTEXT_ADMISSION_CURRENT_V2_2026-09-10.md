# Preregistration: current-source Qwen context-admission safety screen V2 (2026-09-10)

## Scope

V2 is a fresh, two-cell treatment-exposure screen after the V1 isolated-Pi
launcher failed before model dispatch. It has the same deliberately narrow
safety scope, but a new manifest identity and no repeated V1 result.

## Frozen inputs

- Revision: `qwen35b-context-admission-v2`
- Requested model: `local-llamacpp/qwen36-35b-iq3s`
- Served model request: `qwen36-35b-iq3s`
- Declared context window: 32,768 tokens
- Manifest SHA-256: `93030c7788c5cd7a4474a08659e081fafce8fe49f0c687ea71534b51f25458d6`
- Context-admission SHA-256:
  `fa48f06ae7d865a71cc468ada847faf16d81620fbbb04221092bc84cc28c6a7b`
- Telemetry-flush SHA-256:
  `571128f7fc6e70312f345a808b39144954e6c2af876be0957fe708723386d532`
- Approval SHA-256:
  `cea78dd5e5663d510cd0286fc20ec98c26b25807c966a44f69531c6f851f879a`

The launcher stores `models.json` inside its fresh private
`PI_CODING_AGENT_DIR`, as Pi requires. Its no-inference `--validate` mode runs
`pi --list-models` against the isolated directory before this screen.

## Hypothesis, limits, and rule

V2 permits one normal Qwen request. It must generate an `admitted`
context-admission telemetry row and exactly one proxy-forwarded request. It
then generates a private 200,000-byte system-prompt fixture. That cell must
generate a `rejected` / `aggregate_budget_exceeded` row and zero proxy-forwarded
requests. The fixed subprocess limits are 180 and 60 seconds respectively.

No retries, extra cells, provider fallback, calibration, default change, or
adoption decision are permitted. A missing row, failed Pi process, or any
unexpected forwarded request fails this V2 screen. A pass is only a current
mechanism/safety receipt; it does not demonstrate task benefit or settle the
remaining observed-overflow, reservation, compaction, or switching questions.
