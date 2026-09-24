# Hashline Edit 2.0: research and implementation plan

- **Status:** implemented and installed as the controlled Hashline 2.0 overlay; no model-performance qualification
- **Date:** 2026-09-24
- **Repository state inspected:** `9a4415d` (`docs: finalize Phase 4-5 harness closeout`), clean at start, `main` 11 commits ahead of `origin/main`
- **Runtime source:** the Hashline source inspected is from that repository state. Re-pin the runtime source surface before implementation if any source changes land.
- **Implementation worktree:** `codex/hashline-edit-2-0`, based on `9a4415d`; this copy preserves the original checkout's uncommitted planning file.
- **Candidate package-source SHA-256:** `e8bf006093853a6da4b40eab16248b76da8c71810879f84f49ecb134224ed197` from `npm run surface:hash:source`, refreshed after the terminal-surrogate review fix.
- **Correctness evidence:** after the terminal-surrogate fix, focused Hashline unit/integration tests passed 32/32, `npm run typecheck` passed, and the current pre-commit `npm run verify` passed all six stages (136.3s, serial). No inference or performance evaluation was run.
- **Upstream inspected:** [`YuGiMob/pi-hashline-edit-pro`](https://github.com/YuGiMob/pi-hashline-edit-pro) at `8f027ca1c2a0796ccf1c15bd5a0d12db5d9fb9f0` (visible `master` head, 2026-08-29, “Relax pathological-slowdown timing guards in grep tests”). The upstream package declares **MIT**; see [LICENSE](https://github.com/YuGiMob/pi-hashline-edit-pro/blob/8f027ca1c2a0796ccf1c15bd5a0d12db5d9fb9f0/LICENSE) and its [README at the inspected revision](https://github.com/YuGiMob/pi-hashline-edit-pro/blob/8f027ca1c2a0796ccf1c15bd5a0d12db5d9fb9f0/README.md). Upstream is design input, not a dependency or target architecture.

## Recommendation

The implementation candidate builds the smallest coherent v2 around **strict, byte-bound file snapshots**: retain the existing `read` and `edit` tool names, schemas, numbered-line display, and text-patch grammar; replace the weak normalized 32-bit file tag with a SHA-256 digest of the exact UTF-8 file bytes; refuse a patch whenever its digest does not match the live bytes; remove content-based stale relocation. Keep the file digest and absolute line numbers as the only anchors. No line-anchor registries, persistent stores, tools, settings, commands, or automatic retry behavior were added.

This trades the current convenience of sometimes relocating a stale patch for a clear safety rule: a request applies to precisely the file bytes that `read` showed. Repeated text remains addressable by absolute line number. The digest must include bytes that the present normalization hides (BOM, CR/LF form, trailing whitespace), or it is not a byte-bound snapshot.

This is a behavior change, but **not a model-facing tool-surface expansion**. Preserve tool names and JSON schemas exactly. The digest width and stale-patch behavior alter the textual read/edit protocol; document and test that compatibility change. Hashline is already on by default when the extension is loaded (`HASHLINE` unset or any value other than exact `off`); v2 should preserve this setting and default, not broaden activation.

## Evidence: current behavior

### Tool surface and activation

| Tool name | Current schema | Model-visible contract | Activation |
| --- | --- | --- | --- |
| `read` | Object `{ path: string, offset?: number >= 1, limit?: number >= 1 }` | For UTF-8 text, returns `[display-path#TAG]`, then absolute `N:content` lines, optionally a truncation/continuation note. Default line cap is 2,000 and output cap is 50 KiB. Images in PNG/JPEG/GIF/WebP return image blocks (up to 4 MiB). | Registered by `harness/extensions/hashline.ts` unless `HASHLINE === "off"`; same-named extension tool overrides Pi built-in. |
| `edit` | Object `{ input: string }`; `_input` is accepted as an internal argument-preparation shim but is not in the declared schema. | One textual patch can contain one or more `[path#TAG]` sections; `replace`, `insert before/after/head/tail`, and `delete` hunks use 1-based line numbers. New content is `+`-prefixed; the response returns a new file tag and nearby numbered lines. | Same as `read`; when disabled, this extension does not register either tool and Pi built-ins remain. |

The extension's `read` shape resembles Pi's built-in `read`. Its `edit` shape does **not** match Pi's built-in `edit`: the installed SDK schema uses `{ path, edits: [{oldText,newText}, ...] }` plus a legacy single-edit form. Thus disabling Hashline restores a distinct built-in edit contract. Do not repeat the old ADR's “same-param-signature” claim; compatibility is with harness consumers and names, not the built-in edit schema.

The exact Hashline `read` description says it returns a `[path#TAG]` header and `N:content` lines, that the tag is required for edit, and that offset/limit preserve absolute numbering. Its snippet is `read(path, offset?, limit?): file as [path#TAG] + numbered lines; TAG needed by edit.` The `edit` description shows the optional `*** Begin Patch`/`*** End Patch` wrapper; a placeholder `[<RELATIVE/PATH>#<TAG>]`; `replace`, `insert`, `delete`; `+`-prefixed final-content rows (bare `+` means blank); and warns never to reuse the example path/tag/numbers. It requires the real path/tag and latest numbers, tight ranges, and multiple file sections. Its snippet is `edit(input): hashline patch — replace/insert/delete by line number under a [path#TAG] header.` Its prompt guideline says the success response contains the new tag and renumbered nearby lines and old tags/numbers are dead. V2 should preserve this instructional shape while updating tag length, stale rejection, same-position insert rules, repeated-path grouping, and the UTF-8/newline constraints.

The activation/profile layer treats `read` and `edit` as core names. Hashline itself decides whether to register the overrides at module initialization from `HASHLINE`; it has no runtime toggle. If off, the built-ins remain available under their native schemas.

### Read, tags, snapshots, and edit application

- `normalizeText` removes an initial UTF-8 BOM from the view and normalizes CRLF and CR to LF. `fileTag` then strips trailing spaces, tabs, and CR per line and hashes normalized display text using xxHash32 (8 uppercase hex characters). Consequently the current tag does not distinguish files that differ only in BOM, newline encoding, or trailing whitespace.
- `read` stores up to four normalized snapshots per path, across the 50 most recently read paths, retaining only files under 2 MiB. Snapshot state is module/process scoped, not session scoped. A read tag can therefore outlive a session, but can also be evicted. Reads of files over the configured 16 MiB default fail before loading; output is bounded separately. Offset reads still tag/snapshot the whole file.
- `edit` serializes in-process mutation by realpath-canonicalized path locks. It reads each target, compares the current normalized tag, and if stale attempts relocation from a retained snapshot: each hunk uses its target plus/minus two context lines; one uniquely nearest exact context window can relocate, ties or no hit fail. Head/tail insertions have no context anchor and pass through unchanged. This can accept a stale patch and makes proximity part of correctness. The ±2 context test exists specifically because ±1 could target the surviving copy of a repeated block.
- The patch is parsed and all sections are planned in memory before writes. Consecutive same-path/same-tag sections merge; later sections for the same file chain against the in-memory intermediate if their tag matches it or can be relocated from a snapshot. Hunks are sorted by position, overlaps are rejected, and writes are serialized bottom-up. Same-position zero-width insertions are not explicitly rejected or given a documented ordering contract.
- Multi-file validation is all-before-write. The write phase writes files sequentially; on a write failure it tries to restore every target from its original UTF-8 string. Rollback is best-effort, and an incomplete rollback is reported. This is not a filesystem-level atomic multi-file transaction. The injected I/O failure integration test covers rollback. The queue only serializes this extension's in-process callers; it does not protect against an external editor/process changing a target between read and write.
- The edit path decodes via `readFile(..., "utf8")`, normalizes the content for application, detects BOM and whether any CRLF exists, then writes UTF-8 with a single inferred LF/CRLF style. A UTF-8 BOM and ordinary all-LF/all-CRLF style are restored, but CR-only and mixed line endings are not preserved exactly; invalid UTF-8 is decoded with replacement characters and can be rewritten as UTF-8. Existing files are written in place with `writeFile`, preserving the inode path behavior but not offering a crash-safe temp-and-rename commit.
- Successful output includes the updated tag plus ±3 lines around edits; it does not return a full re-read. Failure strings teach a reread on stale/ambiguous relocation. There is no automatic retry.

### Related read formatting and edit consumers

- `harness/extensions/active-tool-prompts.ts` supplies snippets/guidelines from active tools; the Hashline descriptions themselves define the patch grammar. Keep those prompt bytes aligned with the v2 textual contract.
- `harness/extensions/tool-activation.ts` keeps `read` and `edit` in the core roster and honors Pi/user-selected active-tool surfaces. `HASHLINE=off` changes which implementations register, not their names in the activation policy.
- `harness/extensions/verify-gate.ts`, `plan-runner.ts`, `context-inlet.ts`, `loop-breaker.ts`, and related harness observers key on the tool names and/or mutation classification. They do not need new tool names. Verify any assumptions about `edit` arguments or result error text before changing those fields.
- `harness/lib/teach-hints.ts` and `harness/lib/chaos-policy.ts` contain patch/stale-error guidance; the latter has a deterministic stale-tag fixture string. Update these with the contract while retaining stable error classification substrings where feasible.
- `harness/extensions/span-tools.ts` returns numbered bounded slices (`read_span`) for large-file access; it is separate from the Hashline override. Do not silently claim span reads mint a Hashline whole-file tag unless implementation proves that.
- Search found no production parser of successful `[path#TAG]` or `N:content` output beyond Hashline and tests; consumers mostly observe the stable `read`/`edit` names. Treat output as model-facing API regardless.

## Upstream adopt / adapt / reject

| Upstream capability | Decision | Reason for this harness |
| --- | --- | --- |
| Reject stale or ambiguous anchors and tell the model to reread; do not “closest-match” stale content | **Adopt** | This directly addresses the local relocation risk. Use a strict whole-file byte digest with current line numbers; do not import its anchor ownership model. |
| Stronger unique per-line anchors, stable untouched anchors, collision allocation, and persistent SQLite/session ownership | **Reject for v2** | Requires a new read format, state lifecycle, persistence/security/eviction behavior, and more model concepts. It is not needed to make the existing patch safe under strict whole-file versioning. Revisit only if stale reread cost is later shown to be material. |
| Separate `replace`, `insert`, `anchor_grep`, `undo_last_change`, plus disablement of built-in `edit` | **Reject** | Violates the hard no-tool-surface-increase constraint and widens implementation and evaluation scope. |
| Auto-read/full anchor refresh after writes; configurable behavior and toggle commands | **Reject** | Adds prompt/context volume and persistent settings. Current compact post-edit local grounding is adequate for the retained contract. |
| Temp-file/rename writes with symlink/hard-link handling and durable undo | **Adapt later, not in first v2 slice** | Atomic single-file replacement and identity-preserving path handling are valuable but are an independent filesystem subsystem. First specify and test honest validation atomicity and best-effort multi-file rollback; do not claim crash atomicity. |
| Explicit error taxonomy, shape validation, NUL/binary rejection, encoding-aware reads | **Adapt selectively** | Use actionable stable stale/ambiguous/conflict errors and reject undecodable/binary targets if required to guarantee byte preservation. A broad parser/autocorrection/error-code framework is unnecessary. |

The upstream source is MIT licensed. Any later code reuse must retain the upstream copyright/license notices and undergo normal dependency/security review; this plan proposes no code copying.

## Proposed v2 contract

### External surface

The registered names and TypeBox schemas remain exactly `read({path, offset?, limit?})` and `edit({input})`. Keep images, byte/line read caps, absolute line numbers, the `[path#TAG]` envelope, and the current patch operations. `TAG` becomes a full uppercase 64-hex SHA-256 digest of the exact file bytes returned from a strict UTF-8 read; the digest includes BOM, EOL bytes, whitespace, and final-newline state. The digest is a version token, not an authorization secret.

No new tools, params, flags, settings, storage, prompts outside the existing active-tool descriptions, or runtime toggles. This leaves the existing `HASHLINE=off` behavior untouched. The longer header costs more context; deterministic byte-count tests quantify the delta, but no model-performance claim follows from them.

### Validation and stale reads

1. Parse the complete patch before I/O. Reject malformed headers/tags, duplicate/canonical-path confusion, invalid ranges, empty replacement bodies, and malformed text input without writes.
2. Resolve paths using current cwd/realpath rules and take the same in-process ordered locks. Read raw bytes once per target. Reject unsupported/binary or invalid UTF-8 instead of replacement-decoding and silently rewriting it.
3. Compare the supplied digest to SHA-256 of current raw bytes. A mismatch is an unconditional stale-read error: **do not relocate by content or proximity, do not edit any file, and do not automatically retry**. The message must state that nothing was applied, request a fresh `read`, and ask the model to reconstruct and resubmit the entire multi-file patch. If safe within existing output limits, include current tag plus a bounded relevant preview; never imply that the old hunk was applied.
4. Recheck each original digest immediately before commit to detect external changes during planning. If any differs, abort before writing any target. Document the residual portable-filesystem TOCTOU window; the in-process queue is not a cross-process lock.

### Repeated lines, ranges, and multi-edit ordering

- Line numbers address positions in the exact tagged snapshot. Identical line text at different positions is never deduplicated or searched for; the number is the address. A stale digest invalidates every number, even if the target content still appears unique.
- Every hunk in a section is interpreted against that section's exact source-stage snapshot, not against earlier hunks in the same stage. Sort for application only after validation. Reject overlapping ranges and two zero-width insertions at the same position; the model must combine same-position inserted lines in one body to avoid an undocumented order.
- Multi-file patches keep one-or-more sections. Resolve each section to its canonical target path, then maintain an ordered stage list per target. A stage is the current consecutive source version for that target: sections with its tag may join that stage even when sections for other target paths intervene. A new tag closes the current stage and may start a later stage only if it equals the exact digest of the preceding stage's planned result. Once a stage is closed, a later return to its tag is rejected as an ambiguous return to an earlier source stage, even if the digest value happens to repeat. Same-tag hunks are simultaneous against that stage's original bytes. Preserve per-target input order between stages and output files in first-seen order. No fuzzy chaining or implicit stale relocation.
- Preserve current bottom-up application semantics for distinct hunks and stable output ordering by first appearance of each file. Ensure post-edit line ranges reflect the final composed result. Repeated-path rules must be explicit in the tool description and tests.

### Failure atomicity and truthful receipts

- Parse, read, digest-check, validate all hunks, calculate all final byte buffers, enforce size limits, and perform the pre-commit digest recheck for every target before the first write.
- Validation/stale/conflict failure guarantees zero target writes. Do not return success text until every planned target write completes.
- Keep the current in-place write strategy for the first coherent slice so symlink/hard-link identity semantics do not change. Track the write-attempt set by adding each target immediately before its write call. If a write throws, restore and verify only targets in that set, including the failing target because it may have been partially modified; do not rewrite or restore targets whose write was never attempted. Return an error that distinguishes “all attempted targets restored; unattempted targets untouched” from “rollback incomplete; inspect these paths.” This is validation atomicity plus best-effort I/O rollback, not a true atomic multi-file filesystem transaction. An external writer may still race after the final digest recheck and before/during a write; the queue is process-local. A process crash or power loss during the sequential commit may leave a partial multi-file result; crash/power-loss atomicity and durable undo remain deferred.
- Before writing, capture exact original bytes. Rollback must restore bytes, not a decoded string that may lose BOM, newline, or invalid-byte distinctions. V2 should reject undecodable encodings before planning, so the expected domain remains valid UTF-8 plus optional BOM.

### Newline and encoding preservation

- Decode UTF-8 strictly; preserve an existing UTF-8 BOM, exact final-newline presence, and the original EOL sequence of unchanged lines, including mixed and CR-only files. Model a file as content lines each carrying its exact terminator (`LF`, `CRLF`, `CR`, or no terminator); a final terminator does not create a phantom editable line. Dominant EOL means the most frequent nonempty terminator in the original stage snapshot, with ties resolved by the first occurrence from file start; if there are no terminators, fallback is LF.
- Replacement: replacement body lines inherit the most frequent EOL among removed lines, with ties resolved by first removed-line occurrence. If removed lines have no terminator, inherit the nearest nonempty EOL outside the range by distance, preferring the preceding line on a tie; then use dominant EOL, then LF. The final replacement line keeps the removed range's final line terminator exactly, including no terminator at EOF, so replacing the final line preserves final-newline state. Internal replacement lines use the selected inherited EOL.
- Insert before N or at head: inserted lines use line N's terminator (head uses the first line); if that terminator is empty, use dominant EOL then LF. Insert after N: inserted lines use the next original line's terminator when one exists; at EOF, use the existing final line's terminator when nonempty, otherwise dominant EOL then LF. If appending after an unterminated final line, the existing final line acquires this selected separator and the last inserted line remains unterminated. Thus tail insertion into `a` with `+b` yields `a\nb`; tail insertion into `a\n` with `+b` yields `a\nb\n`. Head/tail insertion into empty bytes or BOM-only bytes adds no final newline, preserving the original empty file's no-final-newline state.
- Empty bytes and BOM-only bytes both have zero logical lines; BOM-only retains the BOM. `insert head` of one line `x` yields `x` for empty bytes and `BOM + x` for BOM-only. Deleting every logical line yields empty bytes without a BOM, or exactly the original BOM bytes when a BOM was present; no final newline remains. Replacing the final line preserves that line's original terminator: `a\n` -> replace line 1 with `b` yields `b\n`; `a` -> `b` yields `b`. These byte outcomes are normative and require exact-byte tests.
- Reject UTF-16/UTF-32, NUL-containing files, and invalid UTF-8 with a recovery message to use a suitable external conversion workflow. Do not normalize these into UTF-8 implicitly.
- Digest exact empty/BOM-only bytes. The rules above fully define empty, BOM-only, delete-all, final-line replacement, and tail insertion behavior; `insert head` remains the documented creation operation.

### Recovery messages

Keep stable `stale tag` text for current observers, then give one next action. Example: `stale tag: this patch was built from [path#OLD], but the current file is [path#NEW]. Nothing in this patch was applied. Read the file again, rebuild the complete patch with the new tag and current line numbers, and resubmit once.` For multi-file failure, state explicitly that **no files were written** for validation failures. For incomplete I/O rollback, list affected paths and require inspection before another edit. Never recommend retrying the same patch unchanged.

## Compatibility and migration

- **Tool schemas:** preserve exactly. A contract test should snapshot tool names, parameter keys/types/requiredness, and activation. This proposal does not change the fact that Hashline `edit({input})` differs from Pi built-in `edit({path, edits})`; users switching `HASHLINE=off` still change edit dialect.
- **Read output:** preserve path header, absolute numbered rows, paging, truncation, and image behavior; only tag width/meaning changes. Any saved prompt, old transcript, or copy/pasted old 8-hex patch becomes stale and should fail closed. There is no migration of in-memory snapshots because v2 no longer uses relocation snapshots.
- **Edit callers:** keep tool name, `input` string, existing return text shape, counts, and useful details. Update the edit description, prompt snippet/guideline, bad-patch hint, stale chaos fixture, tests, and comments. Inspect verify-gate/plan-runner/context-inlet/loop-breaker paths for assumptions before implementation; source search indicates they key primarily on tool names and mutation status.
- **Rollout boundary:** runtime/tool-description changes alter the harness source surface and invalidate any runtime source hash bound to the pre-v2 build. Update the applicable surface-boundary row and regenerate the runtime hash as part of a future implementation task. Do not mix this change with documentation-only identity or Hashline experiment/qualification records.

## Bounded implementation plan

Implement only after this plan is reviewed. One owner should implement each phase; no parallel edits to shared parser/extension files.

| Phase / owner | Files | Work and exit evidence |
| --- | --- | --- |
| 1. Core model | `harness/lib/hashline-core.ts`, `harness/tests/hashline.test.ts` | Add strict UTF-8 byte digest, line-ending-preserving representation/apply, exact stale comparison helpers, range/overlap/same-position validation, and deterministic serialization. Remove or retire relocation helpers only after no production references remain. Unit tests cover stable vectors, byte differences, encoding rejection, repeated lines, ordering, BOM/EOL/final newline. |
| 2. Tool transaction | `harness/extensions/hashline.ts`, `harness/tests/hashline.integration.test.ts` | Keep `read`/`edit` names and schemas; emit new digest, fail closed on stale snapshots, implement same-tag grouping/chained digest rules, recheck immediately before writes, preserve exact byte rollback, and keep actionable partial-rollback messages. Add contract/schema assertion and failure injection proving validation failure writes zero targets. |
| 3. Observer/prompt compatibility | `harness/lib/chaos-policy.ts`, `harness/lib/teach-hints.ts`, `harness/extensions/hashline.ts` prompt strings, targeted observer tests only if needed | Align stale/bad-patch guidance and preserve stable classifier substrings. No new tool names or activation changes. Update comments/ADR claims that no longer match implementation. |
| 4. Verification and source record | focused Hashline unit/integration tests; applicable full `npm run verify`; `docs/SURFACE_BOUNDARIES.md` and runtime source identity | Run focused tests, then all six standard verification stages. Verify schema/name/activation baseline, read caps/images, Pi tool replacement, no unrelated source drift, updated surface hash, and clean diff. Correct the old ADR's built-in edit-signature statement in a follow-on documentation update. No inference or model performance claim is part of correctness acceptance. |

Suggested regression matrix:

1. Same bytes yield same full tag; changing only CRLF↔LF, BOM, final newline, trailing blanks, or any byte changes the tag.
2. A fresh exact tag applies; a stale tag after insertion/deletion/edit, including when identical target text remains elsewhere, rejects without any file write.
3. Duplicate/repeated lines at distinct numbered positions edit only the requested position under the matching digest; stale repeated-block cases never relocate.
4. Multi-hunk distinct ranges are position-independent; overlap, same-point insert, bad later hunk, and bad later file fail before any write. Same-tag sections group; chained sections require the exact intermediate digest; ordering and output lines are deterministic.
5. Inject write failure at each file position; verify byte-exact restoration or truthful incomplete-rollback path list. No false success receipt.
6. Round-trip BOM, LF, CRLF, CR-only, mixed EOL, trailing-newline/no-final-newline, blank lines, non-ASCII, and emoji without invalid surrogate/UTF-8 output. Invalid UTF-8, NUL, UTF-16/32 reject before writing.
7. Mutate a file externally between planning and commit; the pre-commit recheck rejects before writes. Retain a test/documented limit for the irreducible race after the recheck.
8. Schema/surface contract: exactly `read` and `edit` under Hashline, same declared parameters and types, no additional tool or parameter, same default/on and exact-off registration behavior, native built-ins when off.

## Correctness evidence versus model-performance claims

Passing deterministic tests establishes parser/anchor/transaction/encoding invariants for the tested paths only. It does **not** establish higher model edit success, fewer retries, lower token cost, lower latency, or benefit on Q2/Qwen/Occamy. Do not reuse upstream benchmark percentages as local evidence. Any later model comparison is separate work: preregister tasks, models/serving identity, exact baseline and treatment surface, independent grading, cost/latency measures, and approval before inference. It is not required to merge a correctness-only implementation and cannot be implied by it.

## Rollout and rollback

1. Keep the optimizer mothballed. Keep SoL-Pi work and replay separate. Possible future integration seams are only the stable `read`/`edit` names, mutation classification, and replay's file-state capture; neither compatibility nor safety is established by this plan. Do not install, wire, or infer compatibility with either.
2. Before implementation, capture the clean source commit/hash and baseline tool-schema/surface receipt. Implement on an isolated branch or worktree; do not change runtime defaults or the live mirror during qualification.
3. Require focused tests plus all six `npm run verify` stages, reviewed diff, exact schema/activation invariants, updated source hash, and explicit implementation review. Any failed/incomplete verification blocks promotion.
4. Promotion requires a separate explicit approval after the candidate and receipts are reviewable. If approved, snapshot and hash every live selected and nonselected file, install only the reviewed Hashline runtime overlay, verify selected hashes and nonselected identity, then run fresh Pi smoke sessions with default activation and `HASHLINE=off` to prove the override and built-in fallback paths.
5. On any install/hash/smoke failure, restore the pre-promotion package from the captured receipt and verify every restored hash. Do not change activation defaults. No push is implied.

## Copy-paste implementation prompt

```text
Implement the reviewed Hashline Edit 2.0 plan in
/Users/Albert.Wessels/LLM/pi-munchkin-harness-live-findings. First read
repository instructions and verify the source commit/hash and clean state
against docs/evidence/HASHLINE_EDIT_2_0_PLAN_2026-09-24.md. This is runtime
implementation only; do not run model inference, benchmarks, qualification,
live mirroring, or promotion.

Hard constraint: do not increase the model-facing tool surface. Preserve the
registered tool names `read` and `edit`, and preserve their declared TypeBox
schemas exactly (`read({path, offset?, limit?})`, `edit({input})`). Preserve
HASHLINE activation behavior: unset/on-like values register the overrides;
only exact `HASHLINE=off` leaves native Pi tools untouched. Do not add tools,
parameters, settings, commands, or persistent stores.

Implement the plan's strict byte-bound snapshot contract: SHA-256 over exact
file bytes; strict UTF-8 validation; stale tags reject with zero writes and
no relocation; repeated lines remain addressed by absolute line number;
define and enforce same-tag grouping, chained intermediate digest, overlap,
same-position insertion and deterministic ordering; recheck original digests
before commit; keep multi-file validation all-before-write and make rollback
byte-exact and truthful; preserve BOM, exact existing line endings (including
mixed/CR-only), and final-newline state. If any contract clause cannot be
implemented safely while keeping the declared tool schemas fixed, stop and
report the blocker rather than weakening or silently expanding the contract.

Own changes in small ordered steps: core plus unit tests; tool transaction
plus integration tests; stale/bad-patch observer guidance and narrowly
needed compatibility tests. Update comments and the stale Hashline ADR claims
that your implementation invalidates. Keep the diff limited to those files
and required source-boundary/status evidence; preserve all unrelated work.

Add deterministic regressions from the plan, especially byte-only tag
changes, stale duplicate-block rejection, interleaved source-stage grouping,
ambiguous stage returns, chained digests, zero-write validation failures,
attempt-scoped injected failure/rollback, exact empty/BOM/delete-all/final-line/
tail-insert outputs, EOL inheritance ties, invalid encodings, and an external
edit before commit. First show expected old-behavior failures separately from
test setup/import errors, then pass them.
Run focused Hashline tests and the repository's full `npm run verify`; report
exact commands/results, changed files, schema/activation comparison, source
hash, remaining risks, and any tests not run. Do not claim model-performance
benefit from deterministic correctness tests. Do not commit, push, mirror, or
promote unless a later instruction explicitly asks for it.
```

## Deferred work

- Per-line allocated anchors, persistence across restarts, SQLite/session ownership, and anchor-Grep.
- Separate `replace`/`insert`/undo tools, auto-read, settings UI, toggle commands, and automatic patch repair/retries.
- Crash-safe/durable multi-file transactions, cross-process locking, portable compare-and-swap, and durable undo. The first v2 slice must state the remaining boundaries honestly.
- Binary/image capability expansion, large-file grammar operations, tree-sitter/block editing, and tokenizer-specific anchor tuning.
- Model A/B screens, token/latency studies, claims of quality improvement, SoL-Pi, replay wiring, optimizer work, live mirroring, default changes, and push.

## Independent review fixes — 2026-09-24

Four independently reproduced correctness findings were fixed on this candidate:

1. Simultaneous replacement of an unterminated final line and tail insertion now inserts the required separator while preserving the original final-newline state. Regression coverage includes replacement/deletion combined with tail insertion, empty and BOM-only files, delete-all, and terminated/unterminated final lines.
2. UTF-8 decoding now uses `ignoreBOM: true` after separately recognizing the optional initial byte BOM. A second U+FEFF is retained as content and round-trips byte-for-byte.
3. Serialization rejects NUL and unpaired surrogate content before any target write. Extension-level tests assert zero write attempts and unchanged original bytes for NUL, lone high-surrogate, and lone low-surrogate proposals.
4. Chained-stage receipts now sum operation counts and remap earlier changed-line locations through later hunks. Regression coverage checks aggregate replace/insert counts, `firstChangedLine`, and the prior change's final numbered preview.

The regressions failed before the fixes and passed afterward. The final focused run was `node --experimental-strip-types --test --test-concurrency=1 harness/tests/hashline.test.ts harness/tests/hashline.integration.test.ts` (31/31), followed by clean typecheck and all six `npm run verify` stages. The refreshed hash above identifies this exact source candidate. These are deterministic correctness results only; no model-performance improvement is claimed. The candidate remains uncommitted, repository-only, unqualified, and not promoted.

### Terminal high-surrogate follow-up — 2026-09-24

The earlier surrogate validator compared `charCodeAt(i + 1)` against the low-surrogate range but did not reject `NaN` when a high surrogate ended the string. It now explicitly rejects a missing low surrogate before checking its range. Regressions cover an isolated high surrogate, a terminal high surrogate in ordinary text, one at the end of a non-final patch body line, valid surrogate pairs, and extension-level zero-write behavior for single-file and multi-file patches with the invalid proposal last. The new cases failed before the guard and pass now. Focused Hashline tests pass 32/32, typecheck is clean, and the final `npm run verify` passed all six stages (117.5s, serial). The source hash above includes this fix.

## Controlled installation record and release handoff — 2026-09-24

Candidate commit: `76a0e84c3069f543539c261e2d14ab2bc80c94d7`. Package-source hash: `e8bf006093853a6da4b40eab16248b76da8c71810879f84f49ecb134224ed197`. Before installation, focused Hashline tests were 32/32, typecheck and `git diff --check` passed, and all six `npm run verify` stages passed (136.3s, serial). These are deterministic correctness results, not model-performance evidence. The committed installation receipt with full inventories and hashes is [HASHLINE_EDIT_2_0_LIVE_RELEASE_2026-09-24.json](HASHLINE_EDIT_2_0_LIVE_RELEASE_2026-09-24.json).

### Proposed live overlay

Install only these four changed runtime files as one reviewed set:

- `harness/extensions/hashline.ts`
- `harness/lib/hashline-core.ts`
- `harness/lib/chaos-policy.ts`
- `harness/lib/teach-hints.ts`

The latter three are runtime dependencies of the changed Hashline contract: the core provides byte tags/strict encoding and EOL operations; `chaos-policy.ts` and `teach-hints.ts` carry stale-edit recovery wording and classification compatibility. The test files, ADR, source-boundary ledger, and this evidence document are repository evidence, not live overlay files. Preserve all other installed files.

### Compatibility and release procedure

Old short tags are incompatible: patches carrying the prior short tag fail the strict 64-hex tag parser. Content-based stale relocation is removed; any stale digest fails without moving the edit. Users must read again and reconstruct the complete patch. Keep the registered names (`read`, `edit`), declared schemas (`read({path, offset?, limit?})`, `edit({input})`), and activation behavior unchanged: only exact `HASHLINE=off` leaves native Pi tools unshadowed.

Under the user's explicit 2026-09-24 approval, the release procedure was executed as follows:

1. Bind the package tree and all selected candidate files to the approved source hash and commit. Record a complete live-package inventory with SHA-256 for every selected and nonselected file, and confirm the live baseline has not changed since that receipt.
2. Create a timestamped full-package backup outside the live package. Hash the backup and verify every backup file against the pre-install inventory before changing anything.
3. Copy only the four overlay files above. Hash the installed selected files against the candidate; hash every nonselected live file again and require an exact match to the pre-install inventory.
4. Start a fresh default-activation Pi session. Confirm Hashline `read`/`edit` load with the declared schemas, read a fixture to obtain the new full digest, make a reversible fixture edit, and confirm a subsequent stale tag fails closed. Start a second fresh session with `HASHLINE=off`; confirm Hashline overrides are absent and native Pi tools are available.
5. Record both smoke receipts, installed hashes, loaded surface hash, backup location/hash, and rollback result. On any mismatch or failed smoke, restore the full backup and verify every restored file against the baseline inventory before continuing.

Installation result: all four selected files match the candidate; all 121 nonselected package entries match the pre-install inventory; the backup was verified; default and `HASHLINE=off` fresh-process direct-call checks passed with no inference. A post-install `npm run verify` also passed all six stages (127.5s, serial), and the receipt JSON/source hash rechecks passed. The installed agent-dir surface hash is `2e189c9934d2e60a037c34903ad002c7f85c0d53df7bff2f3c72ab06f1a4a26a`. The `HASHLINE=off` native-tool availability check used seeded native-tool doubles and verifies non-shadowing behavior; it was not a full interactive Pi host session.

This remains a best-effort in-place multi-file commit. A separate process can write after the pre-commit digest check, and a crash or power loss during sequential writes can leave a partial update. Do not describe the overlay as cross-process locked or crash-atomic. Deterministic tests and the zero-inference runtime checks do not authorize or substitute for any model inference, benchmark, or model-performance claim; those require separate explicit approval and a preregistered screen. Defaults remain unchanged; no optimizer restart, SoL-Pi install, merge, or push occurred.
