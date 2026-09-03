# Run Kernel PR 5 QA ledger

Scope: `codex/run-kernel-pr5-recovery`. No live mirror, adoption, gate round, or default flip was
performed.

## Counterfactual regressions

| Restored defect | Targeted proof | Expected distinction |
|---|---|---|
| Allow a settled run to retain a retry window | provider-retry fixture followed by `agent_settled` | the ordinary post-settlement context contains no recovery brief |
| Inject on every context call | compaction fixture with two context requests | only the first request carries `recovery_reason=compaction` |
| Start a model turn from manual resume | `/run-resume` and `/loop-resume` integration fixture | both append a custom message with `triggerTurn=false`; no `sendUserMessage` occurs |
| Keep failure walls after manual resume | RunState reducer fixture | active/exposed counts clear and a `manual-resume` transition is recorded |
| Parse or trust generated recovery text | deterministic brief/sanitization fixture | fixed fences, hashes, enums, counts, and no raw paths/URLs/secrets |
| Let shadow mode acquire recovery handlers | shadow registration fixture | no context handler or `run-resume` command appears by default |
| Deliver a provider brief after semantic settlement | unsettled-provider + settlement fixture | settlement clears the pending retry window before the next context call |

The temporary reversions were executed and restored before acceptance. The always-inject
counterfactual exited non-zero with the compaction fixture observing 2 messages instead of 1 and
the provider fixture observing 1 message after settlement instead of 0. The `triggerTurn=true`
counterfactual exited non-zero in `recovery resume commands append one brief without starting a
model turn` because the no-provider assertion became false. No raw command, path, endpoint, or
secret was recorded in this artifact.

## Verification lanes

| Lane | Result |
|---|---|
| recovery brief/capsule/kernel focused tests | green: 35/35 |
| Pi 0.80.6 lower-bound typecheck | green |
| canonical test runner | green: 492/492 |
| deterministic package smoke | green: 125 files; 31 extension entry points and 2 skills loaded |
| full `npm run verify` | green |
| packed consumers Pi 0.80–0.83 | green: typecheck and 31 extensions/2 skills loaded on 0.80, 0.81, 0.82, and 0.83 |
| peer range boundaries | green: below-lower rejected, lower accepted, interior accepted, upper rejected |
| non-echoing secret scan | green: 453 added lines inspected; no matches |
| temporary Pi 0.83 live-surface load | green: 104 first-party files match; local-only additions ignored; live `~/.pi/agent` untouched |
| deterministic source surface | `9c76302193f461f17f08c3483359aa2dfe57d2cbf86dd65a6ade67ead3b2e391` |
| protected paths | no `context-pressure*` path changed |
