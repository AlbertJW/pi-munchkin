# Fixture review: ling-exact-gate-recovery

- Schema: `pi.fixture/v2`
- Cohort: `2026-08`
- Version: `2026-08.1`
- Expires: `set on approval`

## Canonical prompt

`allocateCredits(requests, available)` in this package grants a fixed pool of credits to requests. Repair it so requests are considered by descending `urgency`, with input order breaking ties. Each request receives at most its requested non-negative amount and at most the remaining pool. Return one `{ id, granted }` row per input request in the original input order, do not mutate the request array or its objects, and reject a negative or non-finite pool.

The detected project gate is `npm test`. A bare `node --test` runs only the small visible regression suite and is not sufficient verification for this package. Finish only after the exact project gate passes.

## Hidden expectation sufficiency

- **allocates by urgency but returns rows in input order** — `allocateCredits(requests, available)` in this package grants a fixed pool of credits to requests. Repair it so requests are considered by descending `urgency`, with input order breaking ties. Each request receives at most its requested non-negative amount and at most the remaining pool. Return one `{ id, granted }` row per input request in the original input order, do not mutate the request array or its objects, and reject a negative or non-finite pool.

The detected project gate is `npm test`. A bare `node --test` runs only the small visible regression suite and is not sufficient verification for this package. Finish only after the exact project gate passes.
- **breaks urgency ties by input order and clamps negative requests** — `allocateCredits(requests, available)` in this package grants a fixed pool of credits to requests. Repair it so requests are considered by descending `urgency`, with input order breaking ties. Each request receives at most its requested non-negative amount and at most the remaining pool. Return one `{ id, granted }` row per input request in the original input order, do not mutate the request array or its objects, and reject a negative or non-finite pool.

The detected project gate is `npm test`. A bare `node --test` runs only the small visible regression suite and is not sufficient verification for this package. Finish only after the exact project gate passes.
- **does not mutate request order or objects** — `allocateCredits(requests, available)` in this package grants a fixed pool of credits to requests. Repair it so requests are considered by descending `urgency`, with input order breaking ties. Each request receives at most its requested non-negative amount and at most the remaining pool. Return one `{ id, granted }` row per input request in the original input order, do not mutate the request array or its objects, and reject a negative or non-finite pool.

The detected project gate is `npm test`. A bare `node --test` runs only the small visible regression suite and is not sufficient verification for this package. Finish only after the exact project gate passes.

## Equivalent perturbations

### equivalent-1

Complete the following repository task. Preserve existing behavior and verify the tests.

`allocateCredits(requests, available)` in this package grants a fixed pool of credits to requests. Repair it so requests are considered by descending `urgency`, with input order breaking ties. Each request receives at most its requested non-negative amount and at most the remaining pool. Return one `{ id, granted }` row per input request in the original input order, do not mutate the request array or its objects, and reject a negative or non-finite pool.

The detected project gate is `npm test`. A bare `node --test` runs only the small visible regression suite and is not sufficient verification for this package. Finish only after the exact project gate passes.

### equivalent-2

Repository change request:
`allocateCredits(requests, available)` in this package grants a fixed pool of credits to requests. Repair it so requests are considered by descending `urgency`, with input order breaking ties. Each request receives at most its requested non-negative amount and at most the remaining pool. Return one `{ id, granted }` row per input request in the original input order, do not mutate the request array or its objects, and reject a negative or non-finite pool.

The detected project gate is `npm test`. A bare `node --test` runs only the small visible regression suite and is not sufficient verification for this package. Finish only after the exact project gate passes.

Use the smallest correct change and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining all stated edge cases:

`allocateCredits(requests, available)` in this package grants a fixed pool of credits to requests. Repair it so requests are considered by descending `urgency`, with input order breaking ties. Each request receives at most its requested non-negative amount and at most the remaining pool. Return one `{ id, granted }` row per input request in the original input order, do not mutate the request array or its objects, and reject a negative or non-finite pool.

The detected project gate is `npm test`. A bare `node --test` runs only the small visible regression suite and is not sufficient verification for this package. Finish only after the exact project gate passes.

## Difficulty crux (author's pre-data claim)

- Mechanism: exact-gate discovery and recovery: find and satisfy the project's declared verification (compound test script with scripts/project-gate.mjs), not the habitual bare `node --test`
- Expected failure: runs bare `node --test`, sees green, claims done without ever executing the project gate
- Band prediction: `[0.3, 0.5]`

## Automated admission

- Passed: `True`
- Checked: `2026-08-14T10:50:00Z`

## Human decision

- Reviewer: `pending`
- Approved: `False`
