# Release, vision qualification, and LFM focus — 2026-10-19

## Release outcome

The user authorized the release, bounded model checks, trace review, and operational
housekeeping. `codex/vision` was fast-forwarded into `main` at
`de19f27e50c320a0ff0ac9aa5418b0bc6579fe54`; both branches were pushed. A clean
release worktree preserved unrelated changes in the findings worktree.

The first mirror attempt correctly refused an open Pi session. After the user
closed it, `mirror:apply` completed and `mirror:check` confirmed **154/154** managed
files match, with no unmanaged extensions or package orphans. A before/after
inventory verified the seven reviewed changes and the unchanged bytes of the other
147 managed files. Verified backups of the seven old files are retained privately.

Package-source SHA-256:
`e449bf3a84997dd7ae23c08d0e8442f6cbbd786bee21c63bc7f13f62fa38d0e3`.
Installed and smoke-observed loaded-surface SHA-256:
`836c990fe9950fe437ebde43a0b32c4e6557b5ea7d4b809c7e7bfa6c278a76fc`.
This supersedes the pending-release status in the fresh QA record. Earlier boundary
rows remain historical; their model evidence is not pooled with this release.

The source's final aggregate verification passed all six stages in 136.4 seconds,
including 1,038 harness tests, typecheck, health, package smoke, 65 optimizer
shutdown checks, and secret scan. This release adds only operational evidence and
documentation after those verified code commits.

## Installed-host and live-load checks

The actual installed Pi **1.1.0** stack was copied into a temporary host fixture:
37 extensions loaded; all six goal states passed; two sessions remained isolated
across three reloads; observation packing round-tripped all UTF-8 bytes over five
pages and rejected corruption; tree/reopen and native scripted compaction passed.
Network and real provider requests in that host check were zero.

The registered tool roster contains `screenshot`; it remains deferred until the
vision capability is activated. `VISION=off` still controls the advanced observation
tools, while plain screenshots are registered independently.

A fresh real Ling smoke (`local-llamacpp/ling3-tiny-fast`, thinking off, scratch cwd)
exited 0 in **15.195 s**, returned exactly `OK`, and produced **zero stderr bytes**.
All **72** telemetry rows carried the loaded hash above, with one surface receipt
and zero unstamped rows. Provider/model stamps matched Ling. This establishes live
load/provenance, not coding quality.

## Bounded vision screen

The screen used the existing account-settings HTML fixture, rendered by Chrome,
with its Confirm-button rectangle independently read from the DOM. A failed
preparation using a dedicated Chrome profile returned no DOM; it made no inference.
The verified headless invocation then prepared the frozen image and its hashes.

Preparation bound the source commit, loaded surface, runner, capture helper,
renderer, fixture, image, model aliases, question, and limits. Approval SHA-256:
`990c3e78e1a20c137973b824f5971498855795073645d380023b07d3ae9d0315`.
The four requests ran sequentially, with no retries, 256 output tokens per request,
120 seconds per request, and a 420-second screen ceiling. Temperature was zero;
the same request format disabled template thinking for both models. These are
single observations, not repeated or statistically independent quality trials.

Production installed tools supplied the images: `screenshot` used a scripted capture
executable returning the frozen full frame, and `visual_observe` materialized the
crop. Thus this is a browser-fixture/tool-output/provider check. It does not measure
autonomous tool selection, live screen tracking, or computer-use actions.

| Requested registered alias | View | Supported answer | HTTP | Elapsed including loading | Prompt/output tokens |
|---|---|---|---|---|---|
| `gemma4-e4b-fast` | Full 640×360 | Yes | 200 | 7.071 s | 128 / 2 |
| `gemma4-e4b-fast` | Cropped 160×72 | Yes | 200 | 0.463 s | 102 / 2 |
| `qwen36-35b-iq3s-vision` | Full 640×360 | Yes | 200 | 13.783 s | 247 / 2 |
| `qwen36-35b-iq3s-vision` | Cropped 160×72 | Yes | 200 | 0.368 s | 37 / 2 |

All four final answers matched the fixed `GREEN` oracle and stopped normally.
The aliases were checked against both Pi's registry and the router inventory; the
screen did not establish an independent backend build/weight fingerprint. Do not
use these observations as optimizer/adoption evidence or rank the models by them.

Mechanism controls passed without extra model calls: text-model refusal, exact
cache reuse, fresh image after model selection, and fresh image after compaction.
The advanced tools were enabled only inside the probe process; live defaults did
not change. SAM segmentation was not invoked or promoted.

A separate real macOS `screenshot` call succeeded in **1.027 s**, captured
**3456×2234** device pixels, and resized to **1568×1014**. Its image is private.
It made no model request and has no semantic/content-validation claim.

## LFM testing priority

The user then selected the newest LFM as the primary focus for further checks.
The available route is `local-llamacpp/lfm25-24b`, named
**LFM2.5-24B-A2B QAD Q4_0**, with text input, a declared 126,976-token window, and
16,384 maximum output tokens. This is the newest registered local LFM, not an
assertion about all upstream releases. The earlier LFM 3B VLM route is absent from
the current registry/router; its historical result is not current qualification.

The first live LFM tool smoke **failed**. It used only `read,edit`, thinking off,
a disposable two-line fixture, an exact byte oracle, and a 180-second execution
limit. The session recorded 14 assistant messages and 13 tool calls before the
timeout. Three edits were correctly refused: an unsupported line-tag diff shape,
an unprefixed copied context line, and an out-of-bounds line. Later edits executed
but the final bytes did not satisfy the requested one-line change; there was no
verified final delivery. The process exited 143 after the deadline; receipt and
postprocessing completed in 189.441 seconds. All 108 telemetry rows were stamped
with the release's loaded surface. Screenshot refusal for the text route passed.

This is a valid negative protocol/task observation. It does not establish a new
parser defect: the refused forms were incomplete/invalid, and accepting guessed
edits would reintroduce the integrity problem fixed in this release. A single
fresh-session control uses the existing `HASHLINE=off` switch, the same task and
allowlist, and the same execution bound. Its result is recorded separately below;
it is exploratory, not a randomized efficacy study or adoption decision.
Daily-driver configuration is not changed by selecting an evaluation focus.

The native-edit control **passed the file/verification oracle in 29.721 s**: exit 0,
zero stderr, exact expected file bytes with the unrelated line preserved, and
successful `read → edit → read` calls with zero tool errors. It recorded five
assistant messages; all 52 telemetry rows carried the release hash. The requested
uppercase final `DONE` marker was not observed, so this is a task/tool-path pass
with a response-format miss, not perfect instruction compliance. The receipt's
`provider_requests` field in both exploratory probes is derived from assistant
message counts, not an independently authenticated backend request counter.

Both results support making native-versus-anchored editing the next bounded LFM
compatibility screen. They do not justify auto-selecting a tool mode by model name,
loosening patch integrity checks, or changing the live `HASHLINE` default. Future
LFM experiments should declare the edit mode explicitly, preregister multiple
small cases, and enforce an execution budget. Keep their outcomes separate from
the four image observations; this LFM route advertises text input only.

A no-inference replay then checked the anchored trace: all three rejected edits
also reject during replay; all five successful edits returned exactly the replayed
file digest; all five intervening reads matched the current digest; and the final
disk bytes matched the completed edit sequence, with no pending edit outcome.
None of those five requested transformations satisfied the task oracle. There is
no observed source/version corruption or unexplained parser result in this trace.
The immediate task failure is the model's use of the contract; the harness-level
problem is compatibility and recovery cost when that contract is the default for
this model. Preserve the strict guard and evaluate an easier existing contract.

## Trace review and housekeeping

No ordinary Pi session files dated/modified 16–19 October were found in the
inspected session tree before these probes. The latest prior coding sample remains
14–15 October. The newly created load/protocol smoke is controlled evidence, not
ordinary use. There is no measured before/after reduction in edit failures or
latency; the counterfactual regressions establish the specific repairs only.

The reviewed goal-design, harness-audit, and Pi-structure drafts are dated research.
`docs/NEXT_STEPS_2026-10-19.md` now records completed repairs, deliberate decisions,
remaining goal-evidence gaps, and the LFM-first testing priority. The original
uncommitted drafts and unrelated ZSTD evidence changes remain preserved.

The read-only inventory before the LFM probes found **1,012 capsule files / 1,891,931 bytes** across
226 workspaces, and **167 cockpits / 181,619 bytes**. No file was older than 90 days.
One workspace has 93 capsule directories, above the metadata-free fallback's
64-directory cap; exact-reference recovery remains available. No archival/deletion
was performed. `docs/ARTIFACT_RETENTION.md` establishes a conservative manual
policy with session-reference protection, 90-day retention, and release backups.

## Private evidence and rollback

The release's private root is
`~/.pi/releases/munchkin-2026-10-19-de19f27/`. It contains the before/after inventories,
seven-file backup, installed-host receipt, load-smoke session/telemetry, frozen
vision manifest/results, actual capture receipt, retention inventory, and probe
scripts. Artifacts are private; raw transcripts and desktop images are not in Git.

| Receipt, relative to private root | File SHA-256 |
|---|---|
| `inventory-before.json` | `246e94f763724b0edd1f77d2788c1b4a578338b2394a89e00e4eec756135120a` |
| `inventory-after.json` | `6f3f4d7fab009962278860422bed47b1a283f8f447f080b05a61b3ccdf5c87ba` |
| `installed-host.json` | `21583e1800aac1f635ef2a80e92ac678112d4d4357f2d4a0af4c1fff6afcdfb5` |
| `live-smoke/receipt.json` | `c0dc44da8d48052c573b486971119eb708355941210aa6b66a5edb4df2c2811f` |
| `vision-screen/manifest.json` | `55cc80af8d69b11002d0db262f490062c7f5195587087e42a433ca3e7e50f1ef` |
| `vision-screen/result.json` | `8a9c077dd9e2a7e4ce4e72ad730183308c8f2dea3bee113b2cf526f81bb10a33` |
| `desktop-capture-receipt.json` | `08687f82a55db6e4142e71de7a1db2e3c4da588c9dd0e32dec4d140805113922` |
| `retention-inventory.json` | `df521177ac50ac15aab31006daf7053317399e7f3741bc4b0575b1e74e546736` |
| `lfm-protocol/receipt.json` | `b1374b6a09321c8567781183aefca0b480bf4e2145bc2023ed61683ac920e677` |
| `lfm-native-control/receipt.json` | `04dc673c58d0ca1a10da1e340af7ede1ccc53a81d90a5e41fd1a2ee4138ad6c2` |

Rollback requires Pi stopped. Use the recorded seven-file inventory and verified
backup to restore the prior live bytes, or deploy a reviewed source revert. Reverting
the repairs also restores the documented bugs. Do not overwrite settings, model
registrations, third-party packages, or recovery ledgers as part of that rollback.
