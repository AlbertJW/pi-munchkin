# Qwen 35B planner completion screen v7 — audit (2026-09-03)

**INCOMPLETE MECHANISM — SCREEN STOPPED.** The V7 preregistration was
revalidated against source surface
`d1b17fd8dbe1114e5185f68c36809d80ed1d4160c9822c2f1b0faf8ad4db0f18`, loaded
surface `d83baa71d3eb6d9d79afac7d1adda2b2cf08f96e92c1f7c7785b524bae6fdc09`,
candidate/control configuration digests, and all four admitted fixture
manifests. Two candidate sessions were run in the fixed randomized order; the
first two observations make the preregistered acceptance gate impossible, so
the remaining ten sessions were not run.

## Safe receipts

| session | fixture | arm | outcome | graph classification |
|---|---|---|---|---|
| 01 | `password-expiration-guidance` | candidate | output cap, exit 143, 91.176s, 350,000 bytes, stderr 0 | one `research-start`; two pending depth-one branches; no merge or settlement |
| 02 | `sqlite-postgres-selection` | candidate | wall timeout, exit -9, 181.014s, 310,377 bytes, stderr 0 | one `research-start`; two `branch-failed(child_failed)` events; one pending and two blocked depth-one branches; no merge or settlement |

Both launcher summaries carried the pinned Qwen subject, candidate config
digest, and exact loaded surface hash. Telemetry remained payload-free and all
raw streams remain under the private run root
`~/.pi/planner-screens/qwen35b-planner-v7-20260903-122432/`.

Session 01's 94 telemetry rows show ten leased tools and a graph start before
the output cap. Session 02's four per-process session IDs show the parent and
three `research-planner` children. The children repeatedly called
`branch_plan`; two were still active when the parent wall terminated them. No
child report, source lead, budget usage, or parent evidence was accepted.

## Interpretation

The V7 gate requires at least six of eight candidate starts, at least three
validated merges, at least three terminal parent settlements, and no candidate
branch failure. The observed starts are 2/2 among the two sessions actually
run, but merges and settlements are 0/2 and the second session has child
failures. The screen therefore cannot qualify, and its observations are
incomplete lifecycle diagnostics rather than planner-quality or adoption
evidence. No control sessions were started and no rows may be pooled with V5 or
V6.

The failure is consistent with a contract mismatch rather than graph-state
corruption: every depth-one planner was instructed to create scouts even for a
single bounded gap. Commit `97629b5` changes that model-visible instruction so
direct terminal branch reports are allowed and scout expansion is conditional.
The targeted contract test was red before the edit and green afterward. V8 is
prepared against the resulting source boundary; both planner flags remain
dark.
