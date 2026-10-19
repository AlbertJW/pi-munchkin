# Munchkin: current decisions and next work

This is the current operational roadmap as of 2026-10-19. It supersedes the
unfinished-work lists in the 7–9 October research drafts and the 12 October
modernization note. Preserve those documents as dated research, not as a queue of
still-unfixed defects. Evidence for this release is in
`docs/evidence/RELEASE_AND_VISION_2026-10-19.md`.

## Completed baseline

Pi 1.1.0 is qualified. Continuations have aggregate bounds and respect aborts;
explicit tool selection is authoritative; interactive telemetry carries selected
model identity. Goal 80/20 settlement requires user acceptance, goal brief injection
is revision-aware, and paused research suppresses goal continuation. Planner item
dependencies and the progressive research skill are implemented. See
`docs/HARNESS_MODERNIZATION_2026-10.md` for the earlier implementation decisions.

The October trace follow-up added complete tagged unified edits and a deferred
plain screenshot tool. Fresh QA then repaired incomplete-hunk interpretation,
context validation/EOL preservation, crop validation, and cropped SAM geometry.
The integrated source passes 1,038 harness tests, all six verification stages, and
the installed-Pi host qualification. Release review, merge, push, and live mirror
verification were authorized and executed on 19 October.

## Primary next goal: qualify LFM tool execution

The user's latest testing priority is the newest locally registered LFM:
`local-llamacpp/lfm25-24b`, LFM2.5-24B-A2B Q4_0. It advertises text input and
a 126,976-token window. Prioritize its tool execution, goal stopping, and context
behavior in future bounded task screens. Its current route must refuse image
requests cleanly. Do not change the daily-driver setting or infer image support
from a model name. A vision-capable LFM route can be qualified when one is actually
registered and available.

The first LFM anchored-edit smoke timed out after three malformed edit refusals
and further edits that failed the final byte oracle. The existing native edit path
(`HASHLINE=off`) then passed the same file/verification oracle in 29.721 seconds
with zero tool errors, while missing the requested uppercase final response marker.
Keep both observations; they are single exploratory cases, not an adoption study.
Trace replay found no unexplained edit/disk mismatch: LFM supplied five executable
but semantically wrong edits. Treat this as a harness/model compatibility issue,
not a reason to guess malformed patches or infer that LFM cannot perform the task.

The next concrete goal is a small frozen LFM editing-compatibility screen comparing
native and anchored edit modes in fresh sessions. Include a one-line replacement,
a multi-line change, stale-source refusal, unchanged unrelated content, verification
after mutation, and safe recovery from one malformed edit. Declare modes and time/
request/tool limits before execution, randomize matched arm order, preserve every
failed/timed-out cell, and do not weaken integrity checks to help a model pass.
Accept a mode only if exact intended bytes and the declared safety requirements
pass. Use the existing native edit switch for further exploratory LFM work; leave
the live default unchanged until a separate adoption decision.

## Visual qualification and remaining experiments

Use plain screenshots on short, controlled observation tasks. Success means the
model receives the intended image and supports its answer from that image within
a preregistered request/time budget. A full frame and a cropped view of one frozen
dialog provide a narrow qualification; they do not establish general OCR,
navigation, clicking, or long-running task quality.

Keep perceptual caching, automatic visual checkpoints, and SAM-assisted targeting
behind their existing opt-ins. Their next evaluation should compare against plain
fresh images, exercise small but meaningful UI changes, and measure missed changes,
answer support, model calls, image/context volume, and elapsed time. Geometry must
map through crop, resize, and display scale. Actions still require an independent
fresh-target check. Do not install another vision service or flip a default merely
because the fixture screen passes.

## Next evidence goal: review ordinary use after release

Review the first available post-release coding and visual sessions using counts,
safe failure classifications, and the exact loaded surface identity. Check edit
format failures, subsequent whole-file writes, screenshot delivery, continuation
stops, and elapsed time. Keep release-smoke sessions separate from ordinary task
evidence. The trace files inspected on 19 October contained no new ordinary
sessions dated 16–19 October; the 14–15 October sample is only a diagnostic baseline.
There is no measured before/after model-quality improvement yet.

## Later bounded code package: stronger goal evidence

The broader Goal System V2 draft remains a proposal. Existing transaction safety,
active-only lifecycle, user-owned 80/20 acceptance, and continuation bounds are
already implemented. The useful next increment is criterion-linked deferral records
and references to harness-observed verification, with explicit handling of manual
attestations. Current deferral records still contain value/risk/rationale without a
criterion ID; goal evidence is still text rather than a trusted observation link.
Do not label those broader V2 properties complete or start a goal-schema rewrite
as part of this release.

Execution/session bindings, goal–plan relationships, and uncertain-delivery
reconciliation can follow only when their acceptance cases justify the additional
state. Reuse the existing authorities rather than adding a second task store.

## Operational housekeeping

Follow `docs/ARTIFACT_RETENTION.md`. Inventory before archival, protect referenced
recovery state, and keep release backups. One workspace exceeds the metadata-free
capsule fallback scan limit; exact session references remain the preferred restore
path. No destructive cleanup or background maintenance was enabled.

The uncommitted goal-design, harness-audit, and Pi-structure documents were reviewed
as dated proposals. Their original content, the older ZSTD evidence edits, and other
unrelated work remain in the findings worktree. They were not swept into this
release. The tracked roadmap records which recommendations remain relevant.

The optimizer remains mothballed. Working memory, research/planner experiments,
Jina fallback, and other dark candidates retain their existing defaults. This
release makes no adoption decision for them.
