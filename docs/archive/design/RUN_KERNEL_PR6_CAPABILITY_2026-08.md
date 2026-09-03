# Run Kernel PR 6 — phase-aware capability surface

PR6 is a dark, independently reversible candidate. It keeps the deployed
`MUNCHKIN_TOOL_ACTIVATION=dynamic` behavior unchanged and adds
`MUNCHKIN_TOOL_ACTIVATION=phase` for later measurement. No live mirror, default
flip, adoption, or gate round is part of this change.

## Contract

Phase mode starts from Pi's complete registry, then removes only optional
capabilities: `plan_go`, `search_spans`/`read_span`, `subagent`,
`compact_context`, and `web_read`. `plan_write` and `web_search` remain available
so the model can create a plan or select public research results. A narrowed
explicit `--tools` selection is preserved byte-for-byte; a later manual
`/tools` disable is never reversed. Each automatic capability activation is
attempted once and is additive.

Activations consume structured evidence, never prompt keyword matching:

| Capability | Evidence trigger |
|---|---|
| `plan_go` | accepted `plan/write` signal |
| span tools | stat-backed large-file refusal or context-inlet refusal |
| `subagent` | multi-item execution, second plan-gate failure, or loop tier two |
| `compact_context` | first 60% context crossing or recovery trigger |
| `web_read` | successful search result selection |

The research ledger remains dark and is never auto-enabled. The phase manager
publishes only bounded tool/reason activation telemetry. Its surface sample
counts active schema and guideline bytes; inactive tools contribute zero. The
envelope binds rows to the harness surface hash.

## Rollback and limitations

- `MUNCHKIN_TOOL_ACTIVATION=ambient` leaves Pi's initial selection untouched.
- `MUNCHKIN_TOOL_ACTIVATION=dynamic` is the deployed compatibility path.
- `MUNCHKIN_TOOL_ACTIVATION=phase` is a candidate only; no efficacy claim is made.
- If Pi exposes an incomplete registry or an explicit selection, the manager
  fails open and preserves the selection.
- A capability trigger cannot resurrect a tool that a user manually removed.
- Phase inference is event-driven and does not inspect prompts, commands,
  arguments, URLs, or file contents.
