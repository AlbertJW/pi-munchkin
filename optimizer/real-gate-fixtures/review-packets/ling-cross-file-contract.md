# Fixture review: ling-cross-file-contract

- Schema: `pi.fixture/v1`
- Cohort: `2026-08`
- Version: `2026-08.1`
- Expires: `set on approval`

## Canonical prompt

Add a `blocked` job status between `queued` and `running`. `STATUS_ORDER` in `src/policy.js` is the single source of truth and must become `queued, blocked, running, done`; `canTransition` must continue to allow only the next status in that order. Remove the duplicate status vocabulary in `src/parse-job.js` so parsing accepts exactly the shared statuses. `parseJob` must still trim and lower-case its input and reject unknown statuses. Existing behavior for the original three statuses must remain intact. Run `npm test` when the coordinated change is complete.

## Hidden expectation sufficiency

- **blocked is present in the shared status order** — Add a `blocked` job status between `queued` and `running`. `STATUS_ORDER` in `src/policy.js` is the single source of truth and must become `queued, blocked, running, done`; `canTransition` must continue to allow only the next status in that order. Remove the duplicate status vocabulary in `src/parse-job.js` so parsing accepts exactly the shared statuses. `parseJob` must still trim and lower-case its input and reject unknown statuses. Existing behavior for the original three statuses must remain intact. Run `npm test` when the coordinated change is complete.
- **parser consumes the shared blocked vocabulary** — Add a `blocked` job status between `queued` and `running`. `STATUS_ORDER` in `src/policy.js` is the single source of truth and must become `queued, blocked, running, done`; `canTransition` must continue to allow only the next status in that order. Remove the duplicate status vocabulary in `src/parse-job.js` so parsing accepts exactly the shared statuses. `parseJob` must still trim and lower-case its input and reject unknown statuses. Existing behavior for the original three statuses must remain intact. Run `npm test` when the coordinated change is complete.
- **transitions follow the new adjacent order** — Add a `blocked` job status between `queued` and `running`. `STATUS_ORDER` in `src/policy.js` is the single source of truth and must become `queued, blocked, running, done`; `canTransition` must continue to allow only the next status in that order. Remove the duplicate status vocabulary in `src/parse-job.js` so parsing accepts exactly the shared statuses. `parseJob` must still trim and lower-case its input and reject unknown statuses. Existing behavior for the original three statuses must remain intact. Run `npm test` when the coordinated change is complete.
- **the parser has no private duplicate status list** — Add a `blocked` job status between `queued` and `running`. `STATUS_ORDER` in `src/policy.js` is the single source of truth and must become `queued, blocked, running, done`; `canTransition` must continue to allow only the next status in that order. Remove the duplicate status vocabulary in `src/parse-job.js` so parsing accepts exactly the shared statuses. `parseJob` must still trim and lower-case its input and reject unknown statuses. Existing behavior for the original three statuses must remain intact. Run `npm test` when the coordinated change is complete.

## Equivalent perturbations

### equivalent-1

Complete the following repository task. Preserve existing behavior and verify the tests.

Add a `blocked` job status between `queued` and `running`. `STATUS_ORDER` in `src/policy.js` is the single source of truth and must become `queued, blocked, running, done`; `canTransition` must continue to allow only the next status in that order. Remove the duplicate status vocabulary in `src/parse-job.js` so parsing accepts exactly the shared statuses. `parseJob` must still trim and lower-case its input and reject unknown statuses. Existing behavior for the original three statuses must remain intact. Run `npm test` when the coordinated change is complete.

### equivalent-2

Repository change request:
Add a `blocked` job status between `queued` and `running`. `STATUS_ORDER` in `src/policy.js` is the single source of truth and must become `queued, blocked, running, done`; `canTransition` must continue to allow only the next status in that order. Remove the duplicate status vocabulary in `src/parse-job.js` so parsing accepts exactly the shared statuses. `parseJob` must still trim and lower-case its input and reject unknown statuses. Existing behavior for the original three statuses must remain intact. Run `npm test` when the coordinated change is complete.

Use the smallest correct change and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining all stated edge cases:

Add a `blocked` job status between `queued` and `running`. `STATUS_ORDER` in `src/policy.js` is the single source of truth and must become `queued, blocked, running, done`; `canTransition` must continue to allow only the next status in that order. Remove the duplicate status vocabulary in `src/parse-job.js` so parsing accepts exactly the shared statuses. `parseJob` must still trim and lower-case its input and reject unknown statuses. Existing behavior for the original three statuses must remain intact. Run `npm test` when the coordinated change is complete.

## Automated admission

- Passed: `True`
- Checked: `2026-08-13T12:54:20Z`

## Human decision

- Reviewer: `pending`
- Approved: `False`
