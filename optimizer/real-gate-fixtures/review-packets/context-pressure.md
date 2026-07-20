# Fixture review: context-pressure

- Schema: `pi.fixture/v1`
- Cohort: `2026-07-context`
- Version: `2026-07.1`
- Expires: `2026-10-18T17:04:40Z`

## Canonical prompt

Run `npm test` once to establish the failing baseline; this also materializes eight deterministic evidence files. Inspect every `evidence/part-1.txt` through `part-8.txt` using bounded reads or targeted searches, retaining each exact `AUTHORITATIVE KEY=value` identifier. Fix only `src/capsule.js` so the visible and hidden tests pass. Preserve every exact identifier and constraint across any context compaction. Do not edit tests, evidence, package scripts, or generated files. Finish by running `npm test`, and report the changed path and passing command.

## Hidden expectation sufficiency

- **reads eight bounded evidence partitions and retains exact identifiers** — The prompt names all eight evidence files and requires every exact AUTHORITATIVE KEY=value identifier to survive compaction.
- **performs a mutation after a failing baseline and recovers to a deterministic passing test** — The prompt requires npm test before the one-file repair and again after it.
- **changes only src/capsule.js and preserves immutable fixture material** — The prompt explicitly forbids edits to tests, evidence, package scripts, and generated files.

## Equivalent perturbations

### equivalent-1

Establish the red baseline with `npm test`, then inspect all eight generated evidence parts with bounded reads. Retain every exact `AUTHORITATIVE KEY=value` pair across compaction. Change only `src/capsule.js`, do not modify tests or evidence, and finish with a passing `npm test` plus changed-path evidence.

### equivalent-2

This is a long-horizon retention repair. Run `npm test`; examine `evidence/part-1.txt` through `part-8.txt` without dumping them wholesale; keep all exact authoritative identifiers. Make the smallest fix in `src/capsule.js`, preserve constraints through compaction, and verify `npm test` passes without changing tests or generated data.

### equivalent-3

Reproduce the failure first. Use bounded inspection across each of the eight evidence files and remember every authoritative key/value exactly. Repair only `src/capsule.js`; tests, scripts, and evidence are immutable. After any compaction, retain the identifiers and constraints, then prove the final filesystem state with `npm test` and the changed path.

## Automated admission

- Passed: `True`
- Checked: `2026-07-20T17:41:16Z`

## Human decision

- Reviewer: `Albert Wessels (implementation-plan approval)`
- Approved: `True`
