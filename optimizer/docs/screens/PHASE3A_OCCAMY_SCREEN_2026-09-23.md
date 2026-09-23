# Phase 3A Occamy safety/recovery screen — 2026-09-23

Status: **11/11 PASS; six verification stages PASS; PROMOTED LIVE, OPT-IN.**
This qualification uses Occamy and the revision-3 preregistration. The earlier
revision-2 live attempt failed its exact case-2 reason-class assertion and is
recorded separately; it is not pooled with this result.

## Frozen identity

- Candidate source commit: `632409ddbc12085064f4953b1c1eaec73999ba91`
- Revision-3 preregistration: `9fddf1b`; source surface SHA-256:
  `121bd19bf1203f89493c782635b3275bb02e75d4d310d059dabd17c6f827086c`
- Model: `local-llamacpp/occamy`, served alias `occamy`, artifact
  `occamy-1.0.Q3_K_M.gguf`; SHA-256
  `e1c4179e1ae3b8545a6e8d7858009e499e1fa58136b2e4b0d08a1e620fbe7be5`.
- Serving profile: text-only, 131,072 context, 128 output reserve. The normal
  router on 8080 was unavailable; the screen used an isolated Occamy server on
  8098 and shut it down afterward.
- `npm run verify`: all six stages passed on the frozen implementation
  candidate, including test, typecheck, health, pack smoke, optimizer mothball
  check, and secret scan.

## Case results

Cases 1–2 were live Pi requests through the private forwarding proxy. The run
passed both: one normal request was admitted and forwarded once; the oversized
request was rejected as `aggregate_budget_exceeded` and forwarded zero times.
The run ID was `db23a461-ed9a-4ba2-885d-50b35d00140d`.

Cases 3–11 were deterministic fault-injection tests run individually, with no
fault elicited from the model. All 26 exact test executions passed:

| Case | Coverage | Result |
|---:|---|---|
| 3 | Estimated/unavailable usage provenance and exact-request confidence | PASS, 4/4 |
| 4 | Retained overflow across missing usage and compaction generation | PASS, 2/2 |
| 5 | Stale serving/window epochs and reservation invalidation | PASS, 4/4 |
| 6 | Output allowance and concurrent reservation accounting | PASS, 4/4 |
| 7 | Single failed-compaction attempt and corrected-request cancellation | PASS, 2/2 |
| 8 | Unavailable/insufficient recovery, no false success, pending preservation | PASS, 5/5 |
| 9 | Recovery survives settlement and later injects once | PASS, 2/2 |
| 10 | Manual delivery failure receipt and user-visible status | PASS, 1/1 |
| 11 | Byte-compatible flag-off path and inactive-by-default behavior | PASS, 2/2 |

Full per-test names, exit/count summaries, and source hashes are in
`docs/evidence/PHASE3A_OCCAMY_DETERMINISTIC_REV3_2026-09-23.json`. The live
probe receipt is
`docs/evidence/PHASE3A_OCCAMY_LIVE_REV3_2026-09-23.json`.

## Revision-2 failure and correction

The first Occamy attempt correctly blocked the oversized request before
dispatch, but classified it as `observed_budget_exceeded`; the frozen screen
requires `aggregate_budget_exceeded` because the aggregate payload itself was
over the window. A red/green regression then fixed reason precedence so an
independently over-budget aggregate remains explicit while
`usage_relation: over` is retained. Observation-only overflow still reports
`observed_budget_exceeded`. The failed run is preserved at
`docs/evidence/PHASE3A_OCCAMY_REV2_STOP_2026-09-23.json`; its receipts were not
pooled into revision 3.

## Promotion and post-install checks

Only these four runtime files were installed:
`extensions/context-admission.ts`, `extensions/run-capsule.ts`,
`lib/context-accounting.ts`, and `lib/telemetry-catalog.ts`. Each installed hash
matches the candidate. All 115 nonselected files match the pre-install
inventory; the full 119-file inventory and verified rollback copy are recorded
in `docs/evidence/PHASE3A_LIVE_INVENTORY_2026-09-23.json`. Rollback package:
`/Users/Albert.Wessels/LLM/phase3a-live-backup-20260923`.

Fresh post-install enabled Pi smoke passed both live cells from the installed
files (one admission/one dispatch, one aggregate rejection/zero dispatch):
`docs/evidence/PHASE3A_OCCAMY_INSTALLED_ON_SMOKE_2026-09-23.json`. A separate
fresh `CONTEXT_ADMISSION=off` session passed with one normal dispatch, zero
admission receipts, and a matching surface receipt:
`docs/evidence/PHASE3A_OCCAMY_INSTALLED_OFF_SMOKE_2026-09-23.json`.
Installed loaded surface SHA-256:
`d74ec2ddc07aa1e7ca40091c26634be9bb9db375959bb9c5f1366367ee3f3f1e`.

`CONTEXT_ADMISSION` remains opt-in and off by default. Phase 3B behavior and
legacy isolation were preserved; the optimizer remains mothballed. No push or
default change occurred.
