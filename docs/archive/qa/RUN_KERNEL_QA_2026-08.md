# Run Kernel PR 1 QA ledger

Scope: `codex/run-kernel-shadow`, source review only. This ledger contains no command arguments,
tool output, credentials, endpoints, project-private paths, or model-run results. No live mirror or
gate round was performed.

## Counterfactual regressions

The following fixed behaviors were temporarily changed one at a time with `apply_patch`; the named
test was run; the expected failure was observed; and the production fix was immediately restored.
Only the safe assertion delta is recorded here.

| Counterfactual restored | Targeted regression | Result before restoring fix |
|---|---|---|
| Treat an execution error without `tool_result` as merely missing instead of rejected | `validation rejection without tool_result remains an observable failure` | failed: actual `missing_result`, expected `rejected` |
| Validate a gate by its end sequence instead of requiring its start after mutation completion | `only a verifier started after the latest successful mutation is valid` | failed: overlapping verifier was incorrectly valid |
| Treat every operational settlement as semantic completion | `operational settlement is distinct from semantic completion` | failed: actual `complete`, expected `paused` |
| Leave every accepted structured plan permanently paused, ignoring exported zero open items | `a fully closed structured plan can complete without conflating settlement` | failed: actual `paused`, expected `complete` |
| Carry the completed-call dedupe set across retry/compaction cycles | `retry cycles retain one run and only the final settlement closes it` | failed: second-cycle reuse of the call ID was suppressed; actual 1 receipt, expected 2 |
| Concatenate all result text and truncate only after allocation | `failure text reader exits at its prefix bound without touching later blocks` | safe legacy fixture would access a throwing post-limit block; fixed reader returns exactly 2 KiB without touching it |

The closed event-union counterfactual is expressed as a safe in-test legacy predicate rather than
weakening production validation: `legacy prefix-only event validation would admit the rejected
counterfactual` proves that the former header-only shape would accept an unknown event and an
extra raw command field. The installed schema rejects unknown names, missing/nonsensical fields,
extra fields, malformed hashes, and unsafe nested receipt payloads.

## Mechanism and neutrality checks

- Pi 0.80.6 typecheck validates the shared structural lifecycle API; no 0.83-only named event type
  leaks into the lower-bound build.
- Start/result/end events produce one receipt; duplicate ends produce none.
- Missing-start and missing-result observations remain explicit.
- Failure classification reads at most the required 2 KiB prefix and exits before later blocks.
- Successful read-only output containing failure-looking prose stays successful and the prose is
  never retained.
- Source mutation followed by an overlapping gate is unverified; a later-started exact gate is
  valid; a subsequent source mutation invalidates it.
- `agent_settled` produces operational `idle` exactly once per cycle, independent of semantic
  `paused`, `unverified`, or `complete`.
- A completed plan is distinguished by the parent plan runner's numeric open-item aggregate; the
  kernel does not reconstruct the total.
- Objective text is hashed at `before_agent_start` and discarded. Retry and compaction preserve
  run identity; a new objective after completion resets it.
- `RUN_KERNEL=off` registers no handlers or event-bus subscriber.
- Shadow mode registers no tools or commands, sends no messages, appends no session entries,
  changes no active tools, and persists no state.
- Run events, RunState, telemetry, and documentation contain no raw prompts, arguments, commands,
  output, errors, URLs, endpoints, credentials, or paths.

## Final lanes

| Lane | Result |
|---|---|
| `git diff --check` | green |
| targeted Run Kernel/project-gate tests | green |
| `npm run typecheck` | green against locked Pi 0.80.6 |
| `npm test` through canonical isolated runner | 432 passed, 0 failed |
| `npm run secret-scan:diff` | clean; non-echoing scan inspected added lines |
| `npm run compat:peers` | 0.80.5 rejected; 0.80.6 accepted; 0.83.99 accepted; 0.84.0 rejected |
| `npm run pack:smoke` | 103 files; all 27 extensions and 2 skills loaded from local tarball |
| `npm run verify` | green, including optimizer integrity battery; the first sandboxed invocation could not create its temporary optimizer fixture inside the checkout, then the identical approved invocation passed |
| isolated packed consumers | Pi 0.80, 0.81, 0.82, and 0.83 each typechecked and loaded 27 extensions plus 2 skills |
| temporary agent directory | package and compatibility loaders used disposable agent/home directories; `~/.pi/agent` was not mirrored or loaded |
| deterministic package-source surface | `765b6d787334b76635384fb05aa11eac437fba43acb9bfc273cb2d4977ee355b` |
| protected files | no path matching `context-pressure*` changed |
