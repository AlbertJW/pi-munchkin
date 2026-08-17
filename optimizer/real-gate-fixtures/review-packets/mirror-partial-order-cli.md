# Fixture review: mirror-partial-order-cli

- Schema: `pi.fixture/v3`
- Cohort: `2026-08-mirror-mini`
- Version: `2026-08.1`
- Expires: `set on approval`

## Canonical prompt

Upgrade the release CLI from urgency sorting to dependency-aware scheduling. A job may name prerequisite IDs in `after`; emit only jobs whose prerequisites are already emitted, choosing among ready jobs by urgency and then original input order. Reject duplicate IDs, unknown dependencies, and cycles without mutating the input or dependency arrays. Preserve the JSON stdin/stdout interface and existing independent-job behavior. Run `npm test` when complete.

## Hidden expectation sufficiency

- **dual:dependencies schedule a changed multi-hop chain** — Upgrade the release CLI from urgency sorting to dependency-aware scheduling. A job may name prerequisite IDs in `after`; emit only jobs whose prerequisites are already emitted, choosing among ready jobs by urgency and then original input order. Reject duplicate IDs, unknown dependencies, and cycles without mutating the input or dependency arrays. Preserve the JSON stdin/stdout interface and existing independent-job behavior. Run `npm test` when complete.
- **dual:dependencies schedule a changed fork and join** — Upgrade the release CLI from urgency sorting to dependency-aware scheduling. A job may name prerequisite IDs in `after`; emit only jobs whose prerequisites are already emitted, choosing among ready jobs by urgency and then original input order. Reject duplicate IDs, unknown dependencies, and cycles without mutating the input or dependency arrays. Preserve the JSON stdin/stdout interface and existing independent-job behavior. Run `npm test` when complete.
- **dual:ready-set uses urgency after a dependency unlocks** — Upgrade the release CLI from urgency sorting to dependency-aware scheduling. A job may name prerequisite IDs in `after`; emit only jobs whose prerequisites are already emitted, choosing among ready jobs by urgency and then original input order. Reject duplicate IDs, unknown dependencies, and cycles without mutating the input or dependency arrays. Preserve the JSON stdin/stdout interface and existing independent-job behavior. Run `npm test` when complete.
- **dual:ready-set uses original input order after an urgency tie** — Upgrade the release CLI from urgency sorting to dependency-aware scheduling. A job may name prerequisite IDs in `after`; emit only jobs whose prerequisites are already emitted, choosing among ready jobs by urgency and then original input order. Reject duplicate IDs, unknown dependencies, and cycles without mutating the input or dependency arrays. Preserve the JSON stdin/stdout interface and existing independent-job behavior. Run `npm test` when complete.
- **dual:integrity rejects unknown and duplicate identifiers** — Upgrade the release CLI from urgency sorting to dependency-aware scheduling. A job may name prerequisite IDs in `after`; emit only jobs whose prerequisites are already emitted, choosing among ready jobs by urgency and then original input order. Reject duplicate IDs, unknown dependencies, and cycles without mutating the input or dependency arrays. Preserve the JSON stdin/stdout interface and existing independent-job behavior. Run `npm test` when complete.
- **dual:integrity rejects cycles without mutating input** — Upgrade the release CLI from urgency sorting to dependency-aware scheduling. A job may name prerequisite IDs in `after`; emit only jobs whose prerequisites are already emitted, choosing among ready jobs by urgency and then original input order. Reject duplicate IDs, unknown dependencies, and cycles without mutating the input or dependency arrays. Preserve the JSON stdin/stdout interface and existing independent-job behavior. Run `npm test` when complete.

## Equivalent perturbations

### equivalent-1

Complete the following repository task. Preserve existing behavior and verify the tests.

Upgrade the release CLI from urgency sorting to dependency-aware scheduling. A job may name prerequisite IDs in `after`; emit only jobs whose prerequisites are already emitted, choosing among ready jobs by urgency and then original input order. Reject duplicate IDs, unknown dependencies, and cycles without mutating the input or dependency arrays. Preserve the JSON stdin/stdout interface and existing independent-job behavior. Run `npm test` when complete.

### equivalent-2

Repository change request:
Upgrade the release CLI from urgency sorting to dependency-aware scheduling. A job may name prerequisite IDs in `after`; emit only jobs whose prerequisites are already emitted, choosing among ready jobs by urgency and then original input order. Reject duplicate IDs, unknown dependencies, and cycles without mutating the input or dependency arrays. Preserve the JSON stdin/stdout interface and existing independent-job behavior. Run `npm test` when complete.

Use the smallest correct change and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining all stated edge cases:

Upgrade the release CLI from urgency sorting to dependency-aware scheduling. A job may name prerequisite IDs in `after`; emit only jobs whose prerequisites are already emitted, choosing among ready jobs by urgency and then original input order. Reject duplicate IDs, unknown dependencies, and cycles without mutating the input or dependency arrays. Preserve the JSON stdin/stdout interface and existing independent-job behavior. Run `npm test` when complete.

## Difficulty crux (author's pre-data claim)

- Mechanism: algorithm-class change from a comparator to a dependency-aware ready-set scheduler behind a JSON CLI
- Expected failure: patches local ordering examples or uses depth-first traversal without the required ready-set priority
- Band prediction: `[0.2, 0.8]`

## Weighted behavioural contract

- `dependency-order` (40%): all prerequisites precede dependants across changed graph shapes
- `ready-priority` (30%): ready jobs use urgency and then original input order
- `graph-integrity` (30%): invalid graphs are rejected and inputs remain unchanged

## Visible/hidden duals

- `dependency-order`: `visible: orders independent jobs by urgency through the CLI` → `dual:dependencies schedule a changed multi-hop chain`, `dual:dependencies schedule a changed fork and join`
- `ready-priority`: `visible: preserves input order for independent urgency ties` → `dual:ready-set uses urgency after a dependency unlocks`, `dual:ready-set uses original input order after an urgency tie`
- `graph-integrity`: `visible: preserves input order for independent urgency ties` → `dual:integrity rejects unknown and duplicate identifiers`, `dual:integrity rejects cycles without mutating input`

## Oracle boundary

- Execute-only entry: `real-gate-fixtures/oracles/mirror-partial-order-cli.mjs`
- Budget: `32` queries; timeout `2000 ms`; output cap `4096 bytes`
- Source is admission-hashed but never staged, installed as an overlay, or included in one-shot context.
- Model snapshot boundary: Ling Tiny fleet snapshot predates this fixture generation

## Automated admission

- Passed: `True`
- Checked: `2026-08-17T16:15:00Z`

## Human decision

- Reviewer: `pending`
- Approved: `False`
