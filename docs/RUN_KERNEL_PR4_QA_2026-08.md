# Run Kernel PR 4 QA ledger

Scope: `codex/run-kernel-pr4-capsule`. No live mirror, gate round, recovery injection, or default
adoption was performed.

## Counterfactual regressions

| Restored defect | Targeted proof | Expected distinction |
|---|---|---|
| Parse `capsule.md` as authority | edited-Markdown restore fixture | editing the projection cannot change restored phase or outcome |
| Treat `agent_settled` as completion | open-plan, active-wall, and unverified-mutation reducer fixtures | settlement yields paused, blocked, or unverified until the semantic predicate is satisfied |
| Write the capsule under CWD | private-write integration fixture | the project directory remains byte-for-byte artifact-free |
| Accept an open or extensible restore schema | raw-field and invalid-bound fixture | unknown fields, raw data, invalid percentages, and impossible tool counts are rejected |
| Restore the newest file without validation | corrupt-newest fixture | malformed newest JSON is ignored and the next valid authority wins |
| Traverse unbounded history | retention-budget fixture | more than 64 candidate run directories fails closed without reading state bodies |
| Inject the capsule in default mode | registration and integration fixtures | no context hook, before-start hook, or model message is present |
| Publish JSON before its Markdown projection | atomic-write fixture | a visible new authority never references an unpublished projection |
| Reuse one directory for concurrent runs | concurrent-run fixture | unique UUID directories restore independently |

## Verification lanes

Final command output immediately before review and commit is authoritative. Counts below are
updated only after the final staged diff passes.

| Lane | Result |
|---|---|
| focused capsule/kernel tests | green: 16 capsule regressions plus kernel state/event coverage |
| canonical test runner | 485/485 green |
| Pi 0.80.6 lower-bound typecheck | green |
| deterministic package smoke | 122 files; 31 extensions and 2 skills loaded |
| full `npm run verify` | green: tests, typecheck, health, package smoke, optimizer verification |
| packed consumers Pi 0.80–0.83 | green on 0.80, 0.81, 0.82, and 0.83; 31 extensions and 2 skills loaded per consumer |
| peer range boundaries | green: below-lower and at-upper rejected; lower and inside-upper accepted |
| temporary Pi 0.83 agent directory | green; 103/103 first-party mirror files match; live agent untouched |
| non-echoing secret scan | pending final staged scan |
| deterministic source surface | `3cee33fc7a093f3449a8aca5623ac13917e3780865ae91b4edab0e287bcf6809` |
| protected paths | no `context-pressure*` path changed |
