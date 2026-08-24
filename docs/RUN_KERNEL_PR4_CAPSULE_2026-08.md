# Run Kernel PR 4: private run capsule

Status: written as a dark persistence implementation; **`recovery` is the DEFAULT since
2026-08-24** (Albert-approved judgment adoption — the AVO resume-from-state pillar; see
`docs/HARNESS_CALL_GRAPH.md`). `RUN_CAPSULE=shadow` restores the posture this document
describes. The storage contract and authority model below are unchanged and still authoritative.

## Authority and storage

`RUN_CAPSULE=shadow` checkpoints the closed `RunStateV1` contract outside the project at:

`${PI_CODING_AGENT_DIR}/artifacts/run-capsules/<sha256(cwd)>/<run-uuid>/`

Directories owned by the capsule are `0700`; `state-v1.json` and `capsule.md` are `0600`.
Each write uses unique temporary files and publishes the Markdown projection before atomically
renaming the structured JSON authority. Ordinary updates coalesce to the newest state. Phase
transitions are flushed at the next same-Pi boundary, while settlement and shutdown await the
queue. Failed writes leave in-memory RunState untouched and emit only a safe failure class and
bounded byte counts.

A bounded `run_state_v1` Pi custom entry is appended once per settled state. Resume and fork
prefer the latest valid custom entry and fall back to the newest valid private JSON file. Restore
accepts only the exact closed schema, seeds the event sequence above restored history, preserves
the logical run identity, and refreshes current session, surface, provider, and capability
metadata. Malformed, oversized, partial, or ambiguous retention sets fail closed. Existing
blackboard and plan files are neither deleted nor rewritten; their existing stores remain the
deployed enforcement authority while Run Kernel observes their typed projections.

## Markdown and command surface

`capsule.md` is deterministic, bounded to 24 KiB, and explicitly labelled private untrusted audit
data. It contains fixed sections, safe enums/counts, shortened hashes, and at most 16 recent phase
transitions. It is never parsed as authority. Labels are clamped and scrubbed for control
characters, fence delimiters, likely credentials, URLs, and absolute paths.

`/run-status` exposes a bounded read-only state summary without an artifact path, URL, raw
argument, command, output, error, provider endpoint, or credential. The capsule extension has no
`context` or `before_agent_start` handler and sends no model-visible message in `shadow` or
`recovery` mode. `RUN_CAPSULE=off` registers no handlers, subscriber, or command.

## Semantic settlement

Pi lifecycle settlement and task completion remain distinct. A settled accepted plan is complete
only with zero open items. An active failure wall pauses the run, and a source mutation without a
later valid gate records `unverified`. A blocked plan remains blocked. Direct text-only work can
complete when there is no unverified mutation. Therefore `agent_settled` cannot manufacture task
completion.

## Limits and rollback

Structured state is capped at 64 KiB and custom entries at 48 KiB. Restore considers at most 64
private run directories; retention is manual in this release, and a larger set causes private
fallback restore to return no candidate rather than selecting stale state. `RUN_CAPSULE=off` is
the rollback. `recovery` currently preserves the same non-injecting behavior as `shadow`; PR 5 is
the separately gated recovery integration.

Measurements from different harness surface hashes are not pooled.
