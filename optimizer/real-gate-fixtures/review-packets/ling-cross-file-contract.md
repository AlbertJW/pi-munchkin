# Fixture review: ling-cross-file-contract

- Schema: `pi.fixture/v2`
- Cohort: `2026-08`
- Version: `2026-08.1`
- Expires: `set on approval`

## Canonical prompt

Add a `blocked` job status between `queued` and `running`. `STATUS_ORDER` in `src/policy.js` is the single source of truth and must become `queued, blocked, running, done`; `canTransition` must continue to allow only the next status in that order. Remove the duplicate status vocabulary in `src/parse-job.js` so parsing accepts exactly the shared statuses. `parseJob` must still trim and lower-case its input and reject unknown statuses. Existing behavior for the original three statuses must remain intact. Run `npm test` when the coordinated change is complete.

## Hidden expectation sufficiency

- **blocked is present in the shared status order** — Add a `blocked` job status between `queued` and `running`. `STATUS_ORDER` in `src/policy.js` is the single source of truth and must become `queued, blocked, running, done`; `canTransition` must continue to allow only the next status in that order. Remove the duplicate status vocabulary in `src/parse-job.js` so parsing accepts exactly the shared statuses. `parseJob` must still trim and lower-case its input and reject unknown statuses. Existing behavior for the original three statuses must remain intact. Run `npm test` when the coordinated change is complete.
- **transitions follow the new adjacent order** — Add a `blocked` job status between `queued` and `running`. `STATUS_ORDER` in `src/policy.js` is the single source of truth and must become `queued, blocked, running, done`; `canTransition` must continue to allow only the next status in that order. Remove the duplicate status vocabulary in `src/parse-job.js` so parsing accepts exactly the shared statuses. `parseJob` must still trim and lower-case its input and reject unknown statuses. Existing behavior for the original three statuses must remain intact. Run `npm test` when the coordinated change is complete.
- **the parser derives its vocabulary from STATUS_ORDER** — Add a `blocked` job status between `queued` and `running`. `STATUS_ORDER` in `src/policy.js` is the single source of truth and must become `queued, blocked, running, done`; `canTransition` must continue to allow only the next status in that order. Remove the duplicate status vocabulary in `src/parse-job.js` so parsing accepts exactly the shared statuses. `parseJob` must still trim and lower-case its input and reject unknown statuses. Existing behavior for the original three statuses must remain intact. Run `npm test` when the coordinated change is complete.
- **the parser still rejects statuses outside the shared order** — Add a `blocked` job status between `queued` and `running`. `STATUS_ORDER` in `src/policy.js` is the single source of truth and must become `queued, blocked, running, done`; `canTransition` must continue to allow only the next status in that order. Remove the duplicate status vocabulary in `src/parse-job.js` so parsing accepts exactly the shared statuses. `parseJob` must still trim and lower-case its input and reject unknown statuses. Existing behavior for the original three statuses must remain intact. Run `npm test` when the coordinated change is complete.

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

## Difficulty crux (author's pre-data claim)

- Mechanism: cross-file contract coordination: one semantic change (add 'blocked') requires STATUS_ORDER in policy.js to stay the single source of truth AND the parser to derive from it
- Expected failure: edits only policy.js (or adds 'blocked' to both vocabularies independently), visible suite stays green, claims done
- Band prediction: `[0.2, 0.4]`

## Automated admission

- Passed: `True`
- Checked: `2026-08-14T10:50:03Z`

## Human decision

- Reviewer: `pending`
- Approved: `False`
