# Private artifact retention

Established 2026-10-19. This is a manual operating policy; it installs no timer,
deletion job, or model call. The latest inventory and release evidence are in
`docs/evidence/RELEASE_AND_VISION_2026-10-19.md`.

## Recovery capsules

Capsules live under the agent directory at
`artifacts/run-capsules/<workspace-hash>/<capsule-id>/`. Treat a capsule directory
as a unit: its JSON is recovery authority; its Markdown is only a view.

Keep every capsule referenced by retained Pi session history. Also keep capsules
associated with active, paused, blocked, unverified, or unknown work, and any capsule
whose ownership or reference status cannot be established. Keep at least the two
newest capsules per workspace and all capsules modified within 90 days.

A capsule may be archived only when it is older than 90 days, its run is terminal,
no retained session references it, and its goal/research work is also terminal or
explicitly retired. Inspect those conditions with Pi stopped. Record the capsule
identity and file digests before moving the entire directory into a private archive
outside the active `run-capsules` tree. Verify the archived bytes. Do not permanently
delete the archive in the same maintenance pass.

The metadata-free recovery fallback refuses to scan more than 64 capsule directories
in one workspace and refuses ambiguous candidates. The 19 October inventory found
one workspace with 93 directories. This is a recovery limitation, not permission to
guess a capsule or delete referenced history. Prefer the exact capsule identity
from the session. If that identity is unavailable, leave recovery refused and use
explicit inspection rather than raising the traversal cap.

## Cockpits

`artifacts/session-cockpits/<workspace-hash>.html` is a replaceable human-readable
view, one current file per workspace. It is not restore authority. Cockpits for
workspaces unused for 90 days may be moved into a private archive while Pi is
stopped; preserve current or uncertain workspace ownership. A later session can
regenerate its cockpit.

## Receipts, backups, and excluded state

Keep the current release backup and at least the two preceding release backups.
Keep release inventories, qualification receipts, prepared manifests, and the
scripts needed to interpret them for at least 90 days and while their releases
remain supported. Preserve evidence cited by a published decision until that
decision is superseded and its archive location is recorded.

Evaluation images must come from approved fixtures or explicitly authorized
captures. Keep them private with their source and content digests; do not place
personal screenshots, raw model transcripts, or private session contents in Git.

This policy does not prune Pi sessions, goal ledgers, research aggregates, evidence
ledgers, observation archives, or optimizer history. Those stores have different
authority and reference rules. Permission modes remain 0700 for private directories
and 0600 for private artifacts.

## Maintenance trigger

Run a read-only inventory during release review, or when recovery reports a scan
limit or storage pressure. Report counts, bytes, age bands, and workspaces over the
scan limit without printing private paths or content. Establish archive eligibility
before moving anything. The 19 October inventory had no files older than 90 days;
no archival or deletion was warranted under this policy.
