# RUNBOOK — live mirror rollout to `~/.pi/agent` (2026-09-22)

Human-gated rollout of `main` @ `3de98d0` into the live agent directory.
Prepared 2026-09-22 after the Phase 3B hardening tail (commits `1b3473a`,
`3de98d0`). The live mirror currently sits at `78b5afc` (2026-09-09);
`npm run mirror:check` reports **22 of 138 files differ** (plus manifest-only
files such as `visual-observe.ts`, `sam2-tiny.ts`, `context-admission-screen.ts`,
`local-llamacpp.ts`).

## Preconditions (verified 2026-09-22)

- [x] `main` @ `3de98d0` pushed to origin; working tree clean.
- [x] `npm run verify` green (all 6 stages, incl. secret scan).
- [x] `npm run mirror:check` run; drift inventory understood (22/138).
- [x] No live default changes in the new surface: everything new is dark
      behind env flags (`RESEARCH_WORKFLOW=parent`, `DEEP_RESEARCH_PLANNING=on`,
      `CONTEXT_ADMISSION=on`, `VISION=on`, `LOOP_EPISODE_MODE=semantic`,
      `RUN_KERNEL=on`, `RUN_CAPSULE=on`, `WORKING_MEMORY=on`,
      `CONTEXT_DISCOVERY=on`, `CONTEXT_HANDOFF=on`, `GOALS=on`,
      `PLAN_GRAPH=on`). The only live-visible changes are the ordered
      extension list, the two skills, and package version 0.2.0.

## Procedure

Run from `~/LLM/pi-munchkin-harness-live-findings` (or any clean checkout of
the same commit).

1. **Stop every running pi session** — including this one. The apply script
   refuses while a pi process is running (a mid-copy load would see a mixed
   surface). `--force` is for deliberate experiments only; do not use it for
   a normal rollout.
2. Apply:

   ```sh
   node harness/scripts/live-mirror-apply.mjs
   ```

   Expected: `N first-party artifacts written to ~/.pi/agent; zero drift`.
   Per-file staging + rename means a crash leaves intact previous versions,
   never torn files.
3. If it reports **orphans** (files a prior mirror left that the manifest no
   longer declares): review the list, then re-run with `--prune`. `mirror:check`
   fails until they are gone.
4. Prove it:

   ```sh
   npm run mirror:check        # expect: 0 files differ
   ```
5. Record the loaded surface hash:

   ```sh
   node --experimental-strip-types harness/scripts/surface-hash.ts ~/.pi/agent
   ```

   Append a boundary row to `docs/SURFACE_BOUNDARIES.md` (loaded hash, commit,
   date), commit, push.
6. Smoke-test in a fresh pi session: confirm session-bootstrap loads first
   (surface hash present in the system prompt), one verify-gate turn, and
   that no new extension throws on load.

## Rollback

The previous live surface is `78b5afc`, which is pushed. To roll back:

```sh
git worktree add /tmp/munchkin-rollback 78b5afc
cd /tmp/munchkin-rollback
node harness/scripts/live-mirror-apply.mjs   # same gates apply
git worktree remove /tmp/munchkin-rollback
```

Then re-record the surface hash boundary row.

## Related

- Promotion screen `optimizer/docs/screens/PREREG_PARENT_RESEARCH_PHASE3B_PROMOTION_2026-09-22.md`
  is pinned to `317707f` / `765b13e8…`; commit `1b3473a` supersedes that pin.
  **Re-pin the screen to `1b3473a` and the new source hash before executing
  the screen** — the preregistration itself is not rewritten.
- Dark-flag defaults: see `docs/SURFACE_BOUNDARIES.md` (Phase 3B row, 2026-09-22)
  and `optimizer/docs/DARK_CANDIDATE_VERDICTS_2026-09-10.md`.
