# RUNBOOK — Phase 3B live promotion (revised 2026-09-23)

Status: **QUALIFICATION ATTEMPT INCOMPLETE — NO LIVE INSTALL**. This runbook covers the Phase 3B parent
research surface. The installed agent is still behind the repository. A package
copy or a fresh-session load does not pass the ten-case promotion screen.

2026-09-23 attempt: the isolated candidate imported successfully and had
loaded surface hash `f0546aeab78d63c8c61a6579ae1cf1c65e79f788cff7bd041fb261cc6c6701d8`.
The Qwen Q2 direct-parent case was **INCOMPLETE** because the upstream exited
before any research tool ran. A separate eight-token chat request returned
HTTP 500 while router health remained OK. The live installation was not
changed. The exact candidate and rollback file hashes are in
`docs/evidence/PHASE3B_LIVE_CANDIDATE_2026-09-23.json`.

## Freeze and preflight

1. Record the implementation commit, `npm run surface:hash:source`, all six
   `npm run verify` results, and the router-served Qwen 3.8 27B Q2 identifier,
   artifact/template fingerprints, context window, and output reserve. Revise
   the promotion screen to this implementation commit before execution; retain
   its ten cases and fail rules.
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
4. Bind the candidate's loaded surface hash. Run the frozen ten-case screen
   with `PLAN_GRAPH=on`, `DEEP_RESEARCH_PLANNING=on`, `RESEARCH_LEDGER=on`, and
   `RESEARCH_WORKFLOW=parent` in isolated candidate sessions. Include the
   model-backed Qwen arm and every deterministic fault/restart case. Record
   per-case results. `INCOMPLETE` or any fail rule prevents promotion.

## Install after the screen passes

1. Wait for all Pi processes using the installed agent directory to exit.
   Do not stop a user's session for the rollout or copy underneath one.
2. Recheck the installed package against the rollback receipt, then install
   the exact qualified candidate package. Keep the rollback copy. Record the
   installed hashes and loaded surface hash; each selected file must match
   the qualified candidate, and every nonselected file must match its prior
   receipt.
3. Smoke-test a fresh Pi session with the four parent research flags and the
   router-served Qwen Q2 model. Check extension loading, one bounded parent
   research turn, and `research_finish` or `/research-result`. Run a separate
   fresh session with `RESEARCH_WORKFLOW` unset for the legacy route. Record
   both session receipts and the loaded hash in `docs/SURFACE_BOUNDARIES.md`.

`npm run mirror:check` checks all 138 declared files against the entire current
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
