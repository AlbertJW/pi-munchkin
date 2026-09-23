# RUNBOOK — Phase 3B live promotion (revised 2026-09-23)

Status: **PROMOTED LIVE — OCCAMY QUALIFIED**. The six-file Phase 3B overlay is
installed, selected-file parity and nonselected-file preservation passed, and
fresh parent-mode and legacy-mode Pi smokes passed. Parent research remains
opt-in.

2026-09-23 attempt: the isolated candidate imported successfully and had
loaded surface hash `f0546aeab78d63c8c61a6579ae1cf1c65e79f788cff7bd041fb261cc6c6701d8`.
The Qwen Q2 direct-parent case was **INCOMPLETE** because the upstream exited
before any research tool ran. A separate eight-token chat request returned
HTTP 500 while router health remained OK. The live installation was not
changed. The exact candidate and rollback file hashes are in
`docs/evidence/PHASE3B_LIVE_CANDIDATE_2026-09-23.json`.

The requested Occamy qualification is recorded separately in
`docs/evidence/PHASE3B_OCCAMY_PROMOTION_2026-09-23.json` and
`optimizer/docs/screens/PHASE3B_OCCAMY_SCREEN_2026-09-23.md`. It uses commit
`0ae16e71c4e6e676f2bad92661f5c34571a58695`, source surface hash
`8a9e5e7d2989c17a74ea0393d90ae4a93bec17f177423af0525e77b3ef148c89`, and
Occamy `occamy-1.0.Q3_K_M.gguf` (SHA-256
`e1c4179e1ae3b8545a6e8d7858009e499e1fa58136b2e4b0d08a1e620fbe7be5`). The
fresh model-backed case passed; the separate under-specified diagnostic run
and the earlier Qwen attempt remain recorded and are not pooled into this
screen.

Live promotion completed 2026-09-23. Installed surface hash:
`0f032911df7e4bc7907a465d19c5c4c981e56d013f965151d9a18240f4e93bfb`. The
parent-mode smoke settled run `research-plan-2026-09-23T13-24-02-200Z` at
aggregate revision 8 and matched its compatibility graph/ledger projection.
The separate `RESEARCH_WORKFLOW`-unset smoke returned `LEGACY_OK` and used the
same installed surface hash. All six selected hashes match the qualified
candidate; all 113 nonselected inventory hashes match the pre-install receipt.
The rollback package remains at
`/Users/Albert.Wessels/LLM/phase3b-live-backup-20260923/extensions/pi-munchkin`.
Full install and smoke receipts are in
`docs/evidence/PHASE3B_OCCAMY_PROMOTION_2026-09-23.json`.

## Freeze and preflight

1. Pin the implementation commit and source hash above. Record all six
   `npm run verify` results, plus the router-served Occamy identifier,
   artifact fingerprint, context window, and output reserve in the Occamy
   receipt. Keep the original ten cases and failure rules unchanged; the
   Occamy addendum supersedes only the original model-arm choice.
2. Inventory the exact source/live differences and copy the current installed
   package to a private rollback directory. Record SHA-256 for every source,
   installed, and rollback file. Check that rollback matches the installation
   before changing anything.
3. Use a candidate agent directory to qualify the reviewed overlay. Copy the
   installed package first, then replace only these Phase 3B files from
   `harness/` in the repository:

   ```text
   extensions/ketch.ts
   extensions/plan-runner.ts
   lib/plan-graph.ts
   lib/research-aggregate.ts
   lib/research-round.ts
   vendor/pi-subagent/index.ts
   ```

   Preserve the installed package manifest and every other file. Confirm the
   entry points import against the preserved dependencies. If another
   dependency must change, review and add it explicitly to a new overlay
   receipt before continuing. The current `tool-activation.ts` and
   `runner-env.js` differences contain unrelated opt-ins.
4. Bind the candidate's loaded surface hash. The Occamy screen uses
   `PLAN_GRAPH=on`, `DEEP_RESEARCH_PLANNING=on`, `RESEARCH_LEDGER=on`, and
   `RESEARCH_WORKFLOW=parent` in isolated candidate sessions. All ten cases
   passed as recorded in the Occamy receipt. `INCOMPLETE` or any failure in a
   future qualification attempt prevents promotion.

## Install after the screen passes

1. Wait for all Pi processes using the installed agent directory to exit.
   Do not stop a user's session for the rollout or copy underneath one.
2. Recheck the installed package against the rollback receipt, then install
   the exact qualified candidate package. Keep the rollback copy. Record the
   installed hashes and loaded surface hash; each selected file must match
   the qualified candidate, and every nonselected file must match its prior
   receipt.
3. Smoke-test a fresh Pi session with the four parent research flags and the
   router-served Occamy model. Check extension loading, one bounded parent
   research turn, and `research_finish` or `/research-result`. Run a separate
   fresh session with `RESEARCH_WORKFLOW` unset for the legacy route. Record
   both session receipts and the loaded hash in `docs/SURFACE_BOUNDARIES.md`.

The steps above were completed for this promotion. `npm run mirror:check`
checks all 138 declared files against the entire current
repository. It will show unrelated context-admission, recovery, and vision
drift after a Phase 3B-only overlay; **0/138 is not the parity criterion for
this rollout**. Do not use whole-tree `live-mirror-apply.mjs` here.

## Rollback

With all Pi processes using the installation stopped, restore the captured
installed-package copy, verify its file hashes and loaded surface hash against
the pre-rollout receipt, and start a fresh legacy session. Keep failed screen
results; do not rewrite the frozen acceptance cases. A detached Git worktree
is not a runnable rollback for `live-mirror-apply.mjs`, because that script
requires an upstream branch and a pushed HEAD.
