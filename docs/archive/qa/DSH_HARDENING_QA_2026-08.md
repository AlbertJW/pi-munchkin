# DSH candidate hardening QA

This bounded record covers the final adversarial review of the prepared
protocol-diagnostic and minimal-surface work. It contains no raw exceptions,
commands from model sessions, endpoints, credentials, or private paths.

## Executed counterfactuals

| Boundary | Restored defect | Targeted regression that failed before repair |
|---|---|---|
| Prompt/tool coherence | A minimal tool surface still derived prompt behavior only from the activation mode. | `prompt mode has explicit active and ambient rollback semantics` |
| Compaction errors | Callback and synchronous exceptions were returned verbatim to the UI, tool result, and continuation details. | `compact_context resumes after failure because Pi already aborted the turn`; `synchronous compact failure releases the shared slot` |
| Subagent rendering | Single-result expanded and collapsed views rendered the raw child error instead of the bounded diagnostic. | `single-result TUI rendering uses the same redacted failure diagnostic` |
| Protocol vocabulary | Arbitrary custom API metadata was emitted as the API family. | `unknown provider metadata fails closed instead of echoing it`; `doctor reports a closed API family instead of arbitrary custom API metadata` |
| Settlement attribution | Protocol telemetry used a once-per-session latch and omitted later settled agent runs. | `provider timings are numeric, observational, and emitted once only after agent_settled` |
| Model-switch attribution | Before the newly selected model had run, the doctor combined its label with the prior model's settled stream shape. | `provider timings are numeric, observational, and emitted once only after agent_settled` |
| Reflect errors | Reviewer exceptions were interpolated into a user-visible notification. | `reflect failure notices expose only the fixed failure class` |

Each regression was added and observed failing against the prior behavior, then
rerun successfully after the minimal repair. The repairs do not enable the
minimal surface, alter loop enforcement, mirror the live harness, or start a
measurement round.

## Acceptance

- The canonical verifier passes all five stages, including 634 harness tests,
  typechecking, health, deterministic package smoke, and optimizer/Seatbelt
  verification.
- The packed artifact loads 31 ordered extension entry points and both skills.
- Peer-boundary checks pass, and isolated packed consumers pass on Pi 0.80,
  0.81, 0.82, 0.83, and 0.84.
- Diff whitespace and the non-echoing secret scan pass. No file matching
  `context-pressure*` was touched.
- The prepared source surface hash is
  `c8a55e5edef749f57aad72e5e10c9d077b9500c88690b439fa46ed573847b768`.
- The source remains uncommitted and the live harness remains unmodified; both
  actions require their own explicit approval.
