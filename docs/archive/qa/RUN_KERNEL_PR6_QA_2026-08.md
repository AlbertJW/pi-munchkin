# Run Kernel PR 6 QA ledger

Scope: `MUNCHKIN_TOOL_ACTIVATION=phase` is dark. Dynamic, ambient, and all
model-visible defaults remain unchanged. No live mirror or adoption occurred.

## Regression coverage

- Phase startup defers only the optional capability tools while retaining
  `plan_write` and `web_search`.
- Accepted plans activate `plan_go`; bounded file refusals activate both span
  tools; successful search selection activates `web_read`; multi-item execution
  activates `subagent`; the context threshold activates `compact_context`.
- Activations are additive, attempted once, and do not restore a later manual
  disable.
- Explicit narrowed selections and incomplete registries are preserved.
- Signals reject extra fields and raw-looking data.
- Surface accounting measures only active schemas/guidelines; inactive tools
  contribute zero bytes.
- Existing dynamic activation tests remain green and ambient remains inert.

## Counterfactual regression

The phase deferral implementation was temporarily replaced with an empty
deferred set. The focused `tool-activation.test.ts` run exited non-zero (9/10;
the phase-start assertion observed `plan_go` still active). The implementation
was restored and the targeted phase tests returned green. The temporary run
recorded no prompts, commands, paths, endpoints, or secrets.

## Verification lanes

| Lane | Result |
|---|---|
| phase/dynamic activation tests | green |
| canonical test runner | green: 495/495 |
| typecheck | green |
| package smoke | green: 128 files; 31 extension entry points and 2 skills |
| Pi 0.80–0.83 packed consumers | green: typecheck and 31 extensions/2 skills loaded on 0.80, 0.81, 0.82, and 0.83 |
| peer boundaries | green: below-lower rejected, lower accepted, interior accepted, upper rejected |
| temporary Pi 0.83 live-surface load | green: 105 first-party files match; local-only additions ignored; live `~/.pi/agent` untouched |
| secret scan | pending final staged scan |
| protected paths | no `context-pressure*` path changed |

Source surface hash: `0bf088709cf3b0f20c155e238865e2262c4429d7b4ddbf5ba992e86c787b97d9`.

## Measurement gate

The candidate's eventual primary outcome must be preregistered as either
unavailable-tool attempts per exposed session or calls before first useful
mutation. Prompt/schema bytes, repeat calls, errors, turns, tokens, latency,
and correctness are secondary. Ambient is the rollback; no default flip occurs
without a powered replicated result and explicit human approval.
