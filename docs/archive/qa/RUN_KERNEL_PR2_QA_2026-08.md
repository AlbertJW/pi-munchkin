# Run Kernel PR 2 QA ledger

Scope: `codex/run-kernel-pr2-correctness`. No live mirror, gate round, or
default adoption was performed.

## Counterfactual regressions

| Restored behavior | Targeted proof | Expected distinction |
|---|---|---|
| Transcript order stands in for execution order | overlapping same-turn verifier fixture | legacy accepts mutation-then-gate transcript; execution clock rejects a gate that actually started before mutation completion |
| Read/compute/write occurs outside Pi's file queue | executable legacy unqueued race plus concurrent same-file hashline fixture | the unqueued control loses one edit; the queued transaction preserves both |
| Ambient APPEND_SYSTEM guidance remains in active mode | active-only prompt fixture | inactive plan, compact, span, and subagent names remain visible instead of contributing zero bytes |
| Missing verifier start is treated as green evidence | missing-start execution fixture | wrap-up incorrectly passes instead of remaining armed |
| A started mutation with no completion event is treated as harmless | missing-end execution fixture | wrap-up incorrectly trusts the earlier gate instead of failing closed |
| A mixed test-and-mutate Bash call verifies itself | mutating-verifier fixture | wrap-up incorrectly passes instead of requiring a later exact gate |

The queue test also proves that overlapping targets wait while disjoint targets
enter before the first is released. The prompt test runs in a fresh process so
the environment-selected module surface cannot be satisfied by a cached
legacy import.

## Verification lanes

Final command results are recorded immediately before review and commit; the
commands, rather than a stale hard-coded test inventory, are authoritative.

| Lane | Result |
|---|---|
| targeted correctness tests | green |
| typecheck at Pi 0.80.6 lower bound | green |
| canonical test runner | 446 passed, 0 failed |
| deterministic package smoke | 108 files; 28 extensions and 2 skills loaded |
| peer boundary checks | green |
| full `npm run verify` | green, including optimizer integrity and seatbelt self-tests |
| packed consumers Pi 0.80–0.83 | each typechecked and loaded 28 extensions plus 2 skills with active prompt definitions |
| prompt surface probe | ambient append 1,461 bytes; active invariant 664 bytes; 797 ambient bytes removed; inactive tool contribution exactly zero |
| all-six-active definition surface | 349 snippet bytes, 1,282 guideline bytes, 3,560 schema bytes, 2,159 description bytes |
| non-echoing secret scan | clean; 855 added lines inspected without matched-text output |
| deterministic source surface | `01990f1cfc2018f203fab0f7eae8d63a1f6e096aed9736d2599104c8183f91f3` |
| protected paths | no `context-pressure*` path changed |
