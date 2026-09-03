# Dark structured working memory

Status: implemented but dark. `WORKING_MEMORY=off` is the default. Enabling, measuring,
adopting, and mirroring this candidate are separate human decisions.

## Contract and ownership

`working_memory` is a deliberately small notebook for model-authored hypotheses, invariants,
decisions, observations, next probes, and risks. It is not chain-of-thought storage. It does not
alter the plan, verification state, failure episodes, evidence, control arbitration, or the run
outcome. Every returned record is framed as `UNTRUSTED_MODEL_NOTE`.

The tool supports explicit `upsert`, `resolve`, and `list` actions. `upsert` may supersede one
active record; `list` returns only active records in creation order. V1 never injects records into
the model context automatically. When the option is off, the extension returns before registering
the tool, command, lifecycle handlers, schemas, snippets, or prompt guidance.

## Bounds and private storage

The authoritative file is `working-memory-v1.json` beside the matching run capsule under the
agent artifact directory. `working-memory.md` is a generated human-readable projection whose
edits are ignored. The shared private-artifact writer uses `0700` directories, `0600` files,
exclusive staging files, rename publication, and failed-temporary cleanup. It publishes the
projection first and JSON authority last.

The fixed ceilings are 240 UTF-8 bytes per note, 12 active records, 32 records per run, four
evidence hashes per record, 8 KiB for authoritative JSON, and 4 KiB per tool result. Writes are
serialized, so concurrent calls cannot lose records or race past a capacity check. A note is
refused if sanitization removes everything or persistence cannot complete safely.

Sanitization strips terminal controls, replaces private absolute paths and URLs, removes
credential-shaped values, normalizes whitespace, and clamps at a code-point boundary. Private
JSON may contain the resulting bounded note; telemetry contains only record hashes, counts,
booleans, and byte totals. Neither the tool nor `/working-memory-status` exposes an artifact path.

## Identity and lifecycle

A new run starts empty. Resume or fork restores only when the project, capsule UUID, and run hash
all match the run capsule's exact identity. There is no directory walk or ambiguous fallback.
Compaction preserves the state without injecting it. Settlement and shutdown await the final
queued write. A run-identity rotation binds a fresh empty store, and cross-project or cross-run
memory is prohibited.

The tool depends on an active run-capsule identity. `WORKING_MEMORY=on` with `RUN_CAPSULE=off`
therefore leaves the tool visible but safely unavailable; calls fail with a fixed redacted
persistence error instead of inventing a second session identity.

## Measurement gate

No benefit claim follows from implementation. Before an A/B, a separately approved `n=6`
candidate-only mechanism screen must show notes in at least 20% of sessions and later list,
resolve, or supersede activity in at least half of note-writing sessions. The future authenticated
study row must report exposure and token overhead without note text. Working memory must be tested
separately from plateau enforcement and replicated on a second eligible fixture/model cell before
any default change.
