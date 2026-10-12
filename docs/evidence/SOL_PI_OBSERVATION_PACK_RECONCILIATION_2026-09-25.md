# ObservationPack installation reconciliation and release record

**Date:** 2026-09-25

**Harness source:** `main` at `535db7bcc27ec3b30d505971029d51f675d8c01f` (four commits ahead of `origin/main` at inspection)

**Installed Pi:** `0.87.1`

**Scope:** inspect and record the already-enabled ObservationPack; no live files, package settings, or mechanism flags were changed.

## Current state and identities

ObservationPack is currently **installed and enabled** in the user's Pi configuration. The other three SoL-Pi mechanisms remain disabled. The package code in the installed checkout is the local adaptation commit `5fc5c983f94da9aa2da876db6c74b58e0833fd9e`, whose parent is upstream commit `1559b5cb12c72da4a485bc50fe326586b216fb19`. Pi's package registry still names the parent commit, so the registry pin does not describe the working installed source. No push or package-setting repoint was made.

| Item | Identity at inspection |
|---|---|
| Harness HEAD | `535db7bcc27ec3b30d505971029d51f675d8c01f` |
| Harness runtime source-surface hash (`npm run surface:hash:source`) | `3036caf58245ac7e26b50279b20946812793c1a26064504ea18dbe03708c58d7` |
| Hashline 2.0 source hash in its release receipt | `e8bf006093853a6da4b40eab16248b76da8c71810879f84f49ecb134224ed197`; Hashline files were not changed by this work |
| Current harness `tool-activation.ts` SHA-256 | `4a11a04176bfe19df84ae2504b2e1ed0198fd0c6f2401a1e6f8a99ae2dc253de` |
| Live `tool-activation.ts` SHA-256 | `8c1837e0b6d0981cebcdab55f47eae2ca5dc8de7bdb242f811783b01da7c5c62` |
| Installed SoL-Pi HEAD | `5fc5c983f94da9aa2da876db6c74b58e0833fd9e` on local branch `codex/observation-pack-adaptation` |
| Installed ObservationPack `index.ts` SHA-256 | `daede6c69ce8aede0f7d1adfe4a620d62762a5339ad32bedbc28ab8f03cc9688` |
| Installed ObservationPack `observation.ts` SHA-256 | `a4adba8b15f951261033811554044e65253b4b916ffdcc903f477bfa2887f341` |
| Installed SoL-Pi entrypoint `index.ts` SHA-256 | `a9cc7b4b05724a672428288381211838dafa668ba6031d777d5fb4b912609758` |
| Pi user package settings SHA-256 | `a4cc39746f06bbed38a4d150f7679f24be21d8a1f0672ac55df64fd9a27b69a5` |
| Effective `sol-pi.json` SHA-256 | `595af44685ce8e1d65e1a410dedc54bd2120373c89cff9dde19155685a6549a8` |
| Effective mechanism flags | `observationPack=true`; Action Fusion, Evidence Preserving Reducer, and Online Context Compact are `false` |
| Existing SoL-Pi `package-lock.json` worktree change SHA-256 | `9391e590bb91356abd05daf46355229235463241ea4942f4776aa3120703bab4` |

The pre-existing `package-lock.json` modification remains uncommitted and untouched. It removes stale/extraneous package-lock entries, including the prior `@opentelemetry/api`, `zod`, `packages/server`, `packages/storage/sqlite-node`, and `packages/tui` records. The adaptation commit itself changes five source/test files and does not include that lockfile edit. The SoL-Pi checkout remains on `codex/observation-pack-adaptation` with only that lockfile modification in its worktree.

The old feasibility snapshot's claim that all four mechanisms were off and that implementation was not authorized was true for that snapshot only. It is superseded by this record; the historical document is retained unchanged apart from a status banner.

## Activation source versus live file

The current harness source at `535db7b` and the live file share the ObservationPack behavior, but the complete files differ and must not be copied over one another wholesale.

The live file's preserved pre-edit version differs from its current live version in two ObservationPack-specific edits: `obs_recall` was added to `CORE_NAMES`, and a zero-delay callback checks for a tool registered during `session_start`, preserves explicit CLI selection, and activates `obs_recall` if registered. Those are the intended behavioral changes; the current source contains them as well.

The current source adds the newer diagnostic path around late registration: it avoids a redundant `setActiveTools` call when already active, records the `tool-activation/activated` event with reason `late-core-registration`, publishes the `core-late-tool-registration` state, and refreshes surface telemetry. The live callback has the earlier, simpler behavior and does not emit those receipts. The real-host smoke below confirms registration occurs after the core startup snapshot and the delayed activation succeeds on Pi 0.87.1.

Other source/live differences are unrelated to ObservationPack: current source includes the opt-in native `grep`/`find` family and the `vision` capability family; live has neither. The reconciliation must preserve the live file's existing non-ObservationPack choices and splice only the reviewed ObservationPack activation block from current source. Replacing the live file with current `main` would silently introduce unrelated behavior.

**Intended activation version:** current harness source `535db7b` is the reviewed reference for the ObservationPack core allowlist and late-registration behavior. A live reconciliation should transplant only that feature's `CORE_NAMES` entry and current late-registration block, leaving unrelated live/source divergence intact. Explicit `--tools` selection must remain authoritative. No such transplant was performed here.

## Adaptation preservation and reproducible reference

The installed local SoL-Pi commit is now preserved in this harness repository as a mail-format source patch:

- [`SOL_PI_OBSERVATION_PACK_ADAPTATION_5FC5C98.patch.gz`](SOL_PI_OBSERVATION_PACK_ADAPTATION_5FC5C98.patch.gz)
- Compressed patch SHA-256: `df0c9235db499f8e80fbb09fe0b734a950f820a6d4af47b6e83fd00a79df9fb3`
- Base: `1559b5cb12c72da4a485bc50fe326586b216fb19`
- Local adapted commit: `5fc5c983f94da9aa2da876db6c74b58e0833fd9e`

The decompressed patch was checked for applicability against a clean archive of the exact base commit with `gzip -dc SOL_PI_OBSERVATION_PACK_ADAPTATION_5FC5C98.patch.gz | git apply --check -`. It excludes the existing `package-lock.json` worktree change. This makes the code delta durable and reproducible from the harness repository even though the local SoL-Pi commit is not currently advertised by its configured remote.

**Proposed future Pi package reference:** after the SoL-Pi adaptation commit is published to a fetchable repository and separately reviewed, change the package source to `git:github.com/NVlabs/SoL-Pi@5fc5c983f94da9aa2da876db6c74b58e0833fd9e`. Until that commit is fetchable, retain the current package setting and installed checkout; do not claim that the setting itself reproduces the working tree. A future install should verify the full commit, the three source hashes above, and the patch hash before starting Pi. This record does not publish or repoint anything.

## Actual-host, zero-inference checks

The committed runner [`observation-pack-host-smoke.mjs`](../../harness/scripts/observation-pack-host-smoke.mjs) starts fresh isolated Pi RPC 0.87.1 processes with temporary agent, project, and session directories, `PI_OFFLINE=1`, and a temporary SoL-Pi configuration that enables only ObservationPack. It loads the real harness activation source and imports the real installed SoL-Pi entrypoint. Its RPC slash command directly invokes the captured production tool definition and context/lifecycle handlers; it does not ask a model to act. Pi extension-load errors fail the runner.

The successful run established:

| Check | Result |
|---|---|
| Late `obs_recall` registration, expected description/schema, default core activation | PASS |
| Explicit `--tools read,bash` exclusion | PASS; Pi exposes no `obs_recall` tool, and the context handler leaves the full result intact with no placeholder |
| Direct recall of a 41,250-byte UTF-8 fixture | PASS; five pages reconstruct exact original text |
| UTF-8 interior-byte offset rejection | PASS |
| Corrupted archived object rejection | PASS; digest mismatch rejected |
| Manual deactivation through Pi's real `setActiveTools` API | PASS; no placeholder emitted while `obs_recall` is inactive |
| Branch counter invalidation | PASS for the actual registered `session_before_tree` handler invoked in the real Pi process; the next projection returns the full result |
| Same session identity reopened in a fresh Pi process | PASS using `--session-id`; the archived object remained recallable |
| Different session identity | PASS; the prior observation ID is unknown in that session |
| Deduplication followed by packing | PASS; the later identical `read` becomes a back-reference to message `#1`, which is the earlier message subsequently packed at the same index |
| Source/dependency load | PASS; both real package sources loaded with no extension errors |

For the simple payload, the deterministic JSON byte count fell from 43,046 bytes to 1,624 bytes after packing. For the repeated-read fixture, the deduplicated-and-packed messages serialized to 2,113 bytes. These are fixture byte counts only, not token or quality claims.

Two boundaries remain explicitly unproven. First, branch rewind called the real registered `session_before_tree` handler directly; this no-inference process did not drive Pi's interactive tree navigator with a persisted branch transcript. Same-ID fresh-process reopening verifies the archive's session-derived storage key, not restoration of a nonempty chat transcript. Second, `ctx.getContextUsage()` before a provider request is not the final request's accounting. Final tokenizer/provider accounting and post-transform request construction require a provider request; they remain untested to honor the no-inference constraint. The check is deterministic integration evidence for the production handlers, not a benefit or model-use evaluation.

See [`SOL_PI_OBSERVATION_PACK_HOST_CHECK_2026-09-25.json`](SOL_PI_OBSERVATION_PACK_HOST_CHECK_2026-09-25.json) for a concise machine-readable receipt. The runner is intentionally manual, outside `npm run verify`; it requires Pi 0.87.1 and the installed SoL-Pi path.

## Reconciliation and rollback proposal

No runtime release has been completed: the installed adapted package, package registry source pin, and live activation file still disagree. For a separately approved reconciliation:

1. Capture a complete file inventory and verified backup of the live SoL-Pi package, package settings, `sol-pi.json`, and Munchkin `tool-activation.ts`. Preserve the existing `package-lock.json` bytes and its current modification.
2. Decide whether the local adaptation may be published to a fetchable ref. If not, keep the configured `1559b5c` source label and document that the local checkout is a patch overlay; do not write an unavailable commit into Pi's settings.
3. Reconcile only the ObservationPack-specific activation hunk in the live file. Keep the live omission of unrelated `grep`/`find` and vision features. Re-run the actual-host smoke with default and explicit tool exclusion, plus real Pi tree navigation and transcript resume when a no-inference fixture can exercise those APIs.
4. If package source is changed, first verify the new fetchable commit against the committed patch and source hashes. Keep `observationPack=true` only if all installed files match the reviewed adaptation; otherwise disable ObservationPack before restoring upstream `1559b5c`, because that unadapted version lacks the branch reset and recall-time digest/UTF-8 safeguards.
5. On any mismatch, restore the captured live activation, package, settings, and config inventories and verify every file hash. Do not roll back by copying the current harness file wholesale or by overwriting the pre-existing package-lock modification.

The next approval, if desired, is for a **live-file reconciliation proposal only**: whether to publish/pin the SoL-Pi adaptation and apply the narrow activation hunk. Actual provider accounting or model benefit evaluation requires separate authorization.

## Controlled reconciliation completed (2026-09-25)

This section supersedes the preceding proposal and its “no runtime release” status. The adapted package is now registered from a stable local checkout, and the live activation callback is reconciled. ObservationPack remains enabled only because the pre-existing `observationPack=true` setting was preserved; the other three mechanisms remain disabled. This is installation and deterministic safety evidence, not evidence of model benefit.

Pi 0.87.1 supports a local package directory through `pi install <absolute-path> --approve`; a disposable `HOME` test confirmed Pi writes and resolves the local path without copying it. The live setting now contains `../../LLM/local-packages/sol-pi-observationpack`, which resolves to `/Users/Albert.Wessels/LLM/local-packages/sol-pi-observationpack`. `pi list --approve` shows that exact local source. The checkout is a standalone Git repository on branch `local/observationpack-5fc5c98`, commit `5fc5c983f94da9aa2da876db6c74b58e0833fd9e`, with no configured remote. The archived adaptation patch and the three recorded source hashes match this checkout; the patch applies cleanly to the exact upstream base. The local commit is not advertised through NVIDIA's remote.

Only the old SoL-Pi array item in user `settings.json` changed. The package list's other four entries, model settings, retry settings, and observational-memory settings are byte-for-byte preserved semantically; the `sol-pi.json` hash is unchanged and still has ObservationPack on with Action Fusion, Evidence-Preserving Reducer, and Online Context Compact off. The old cached SoL-Pi checkout was captured before using Pi's package-management commands. Pi's `remove` command deleted that cache directory as a side effect, so it was restored from the verified backup archive immediately afterward. It remains unreferenced by Pi's package list at its original commit and retains its original dirty `package-lock.json`; that file and its diff were also saved separately.

The live Munchkin file was changed by an exact, single-block replacement of the ObservationPack late-registration callback from current harness main. The existing `CORE_NAMES` entry was already present and was not edited. The live file's unrelated omission of native `grep`/`find` and vision remains intact. The settings and activation diffs were checked against their captured baselines.

The recorded process-table checks found no interactive Pi process immediately before the live changes; none was terminated. The controlled live changes and hashes are in [`SOL_PI_OBSERVATION_PACK_LIVE_RELEASE_2026-09-25.json`](SOL_PI_OBSERVATION_PACK_LIVE_RELEASE_2026-09-25.json). A full package tar, 65-file source inventory, settings, config, live activation, package-lock bytes, and package-lock diff are retained at `/Users/Albert.Wessels/LLM/observationpack-reconciliation-backup-20260925-01`.

The new [`observation-pack-reconciliation-host.mjs`](../../harness/scripts/observation-pack-reconciliation-host.mjs) uses Pi 0.87.1's real `DefaultResourceLoader`, `AgentSession`, `ExtensionRunner`, and `SessionManager`. It observed the actual combined order (Hashline, read deduplication, tool activation, SoL-Pi) and ran context transformation through `ExtensionRunner.emitContext`, without imposing an order or invoking a model. The run passed default recall activation/schema, exact UTF-8 recall paging, corrupted-archive rejection, explicit tool exclusion with no inaccessible placeholder, and the Hashline read/edit description contract. It navigated a real session tree through Pi's API, appended a deterministic fixture so Pi persisted the selected branch pointer, reopened the nonempty transcript with `SessionManager.open`, and confirmed the abandoned branch was absent. The reopen used a fresh AgentSession and SessionManager in the same isolated Node process; it was not a separate operating-system process. Detailed output is preserved in [`SOL_PI_OBSERVATION_PACK_ACTUAL_HOST_2026-09-25.json`](SOL_PI_OBSERVATION_PACK_ACTUAL_HOST_2026-09-25.json). No model request was sent.

The SoL-Pi compatibility probe passed against installed Pi 0.87.1. Its full `npm ci` and `npm run check` suite could not run: registry DNS returned `ENOTFOUND` for the pinned Pi 0.85.1 `pi-tui` tarball, which is absent from the offline cache. This limitation is recorded as incomplete suite evidence; the actual Pi 0.87.1 loader and the requested package behaviors were exercised directly. The harness repository's final six-stage `npm run verify` passed: 939/939 tests, typecheck, health, pack smoke, optimizer mothball check, and secret scan (clean), 115.9 seconds total. An earlier full run had a test-stage failure; the standalone test rerun passed 939/939, and the final full run passed all six stages. Harness verification does not substitute for SoL-Pi's unavailable package test suite.

Rollback is exact and local: after confirming no interactive Pi process is running, restore the saved `settings.json`, `sol-pi.json`, and `tool-activation.ts`; if needed, restore `installed-sol-pi.tar.gz` to its captured cache path. Verify the original hashes and the restored `5fc5c98` checkout plus package-lock hashes before starting Pi. The local checkout remains untouched by rollback. No inference, new mechanism, optimizer restart, push, or default change occurred.

## Validation and exclusions

The actual-host runner and patch applicability check passed. The final full repository `npm run verify` passed all six stages: test (939/939; 95.0 seconds), typecheck, health, pack smoke, optimizer mothball-check, and secret scan; total 109.1 seconds. Additional checks were `node --check harness/scripts/observation-pack-host-smoke.mjs`, JSON parsing for the host receipt, `git diff --check`, and `git apply --check` against a clean archive of upstream base `1559b5c`. No inference, benchmark, new mechanism, optimizer action, live-file edit, package/config edit, merge, push, Hashline change, or SoL-Pi checkout mutation was performed. The existing lockfile edit remains preserved.
