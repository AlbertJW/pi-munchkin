# Ling measurement v3 — bounded QA record

This record contains commands and verdicts only. It contains no telemetry payloads, model output,
commands from evaluated sessions, paths outside the public repository, endpoints, or credentials.

## Measurement bridge

- Counterfactual: wrapped `context_telemetry.aggregate()` with the pre-v3 behavior that omits
  `failure_episodes`, then ran `context_telemetry.selftest()`.
- Expected failure observed: `authenticated failure episode aggregate regression: KeyError`.
- Fixed-path checks: `context_telemetry.py --selftest`, `fleet_report.py --selftest`,
  `fleet_verdict.py --selftest`, `propose.py --selftest`, and `test_span_screen.py` pass.
- Repository gates: `git diff --check`, `npm run secret-scan:diff`, and `npm run verify` pass.

The regression is non-vacuous: removing the authenticated episode aggregate makes the targeted
selftest fail before a powered row can be accepted. Missing or duplicated settlement summaries
remain represented as incomplete evidence rather than disappearing from the result stream.
