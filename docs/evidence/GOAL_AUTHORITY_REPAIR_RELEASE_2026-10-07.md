# Goal authority repair release — 7 October 2026

This release contains the existing-schema reliability repair only. Its isolated branch
starts at upstream `d336a3257f34aa30ea60f50670b31ee95ca8d8c6`. It does not include the seven
subsequent local commits, ZSTD evidence changes, or the proposed goal-system redesign.

## Behavior and interfaces

- A process lock covers goal read-modify-write, including direct writes and cancellation.
- Invalid, oversized, unsupported, foreign, inaccessible, and dangling-link authority is
  preserved. Mutation callbacks never receive damaged authority as an empty goal slot.
- `loadGoalLedger` returns explicit load outcomes. `writeGoal` requires the previously read
  `goalRevision` for replacement; `mutateGoal` is the preferred update API.
- Inspection cursors bind the complete goal revision and section, and reject split Unicode
  character boundaries. Old ephemeral cursors must restart their section.
- Numeric ledger schema v2 and live activation settings stay unchanged. A killed writer
  leaves its lock intact. Recovery requires every writer using that scope to be stopped,
  inspection of `goal-v2.json.lock/owner.json`, and removal of only that lock directory.
  Preserve the ledger. All processes sharing a scope must load the repaired code.

## Qualification

The original five defect regressions failed before the repair. Additional regressions cover
cross-process pause before a waiting update, killed-writer recovery, oversized authority,
revision comparison, dangling links, and fail-closed deployment process inspection.

The installed Pi 1.0.4 staged-copy qualification loaded 32 live extensions, including the
existing local-only chaos extension and its dependencies. Five real AgentSession lifecycle
cases each used exactly one scripted provider request; there were zero network requests.
The qualifier copies only code and resources into temporary state, and never reads live
credentials into a model runtime or invokes a real provider.

Full `npm run verify` is the release gate. Its first run passed five stages and rejected an
owner identifier named `token` as a credential assignment. The identifier was renamed
`nonce`; the independent secret scan then passed. A subsequent run caught an existing Hashline race-test ordering failure; its targeted rerun
passed all 22 tests. A later context-handoff assertion exposed its fixed event-loop-tick wait
after goal reads gained additional asynchronous filesystem checks. Qualification fixtures now
wait for the actual continuation and accept either valid Hashline queue-entry order, while
still requiring exactly one stale-tag rejection. No unrelated runtime code was changed.
Final verification output and
both Pi version qualification outputs accompany the deployment receipt. The final full gate
passed all six stages: 951 harness tests, TypeScript, health, installed-package smoke, 65
optimizer shutdown checks, and secret scanning. Staged qualification passed under both
Pi 0.80.6 and installed Pi 1.0.4, each with five inactive-state cases and zero network requests.

## Restricted deployment and recovery

`harness/scripts/deploy-goal-repair.mjs` accepts `prepare`, `apply`, `check`, and `rollback`.
It permits only goal-state.ts, plan-runner.ts, and private-state-lock.ts inside the existing
live package. It does not run the whole-checkout mirror or change the live package manifest.

Run from a clean, published `codex/goal-authority-repair` branch:

```sh
node harness/scripts/deploy-goal-repair.mjs prepare /Users/Albert.Wessels/.pi/agent /Users/Albert.Wessels/LLM/goal-repair-backup-2026-10-07 d336a3257f34aa30ea60f50670b31ee95ca8d8c6
node harness/scripts/deploy-goal-repair.mjs apply /Users/Albert.Wessels/LLM/goal-repair-backup-2026-10-07/receipt.json
node harness/scripts/deploy-goal-repair.mjs check /Users/Albert.Wessels/LLM/goal-repair-backup-2026-10-07/receipt.json
node --experimental-strip-types harness/scripts/qualify-goal-repair.mjs /Users/Albert.Wessels/.pi/agent /opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent --deployed
```

Preparation verifies exact baseline hashes and helper absence, saves original code with its
permissions, and records a private inventory of surrounding code, configuration, and goal
ledgers. Application requires a published source commit, unchanged baseline inventory, and
successful process inspection proving Pi writers are stopped. It stages all three files and
renames them while writers remain stopped. Failed application automatically restores code
where possible. Process inspection failure is a blocking error, never evidence of no writers.

If subsequent loading fails, keep sessions stopped and run:

```sh
node harness/scripts/deploy-goal-repair.mjs rollback /Users/Albert.Wessels/LLM/goal-repair-backup-2026-10-07/receipt.json
```

Rollback verifies backup hashes, refuses unknown replacements, restores only approved code,
and verifies the original inventory. It never restores or deletes goal data. A deployment
interrupted between file renames also requires this rollback before sessions restart.

The private receipt binds the published commit, baseline, before/after file hashes, modes,
and rollback location. The accompanying release verification record binds source and loaded
surface hashes. Whole-checkout drift remains separately reported because unrelated source
changes are intentionally not part of this repair release. No global zero-drift or real-model
performance claim is made.
