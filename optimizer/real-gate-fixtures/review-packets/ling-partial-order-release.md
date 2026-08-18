# Fixture review: ling-partial-order-release

- Schema: `pi.fixture/v2`
- Cohort: `2026-08`
- Version: `2026-08.1`
- Expires: `2026-11-16T09:19:56Z`

## Canonical prompt

Implement `scheduleJobs(jobs)` in `src/release-plan.js`. Every job has a unique string `id`, an optional `after` array of prerequisite job IDs, and an optional numeric `urgency` (default 0). Return the IDs in a valid dependency order. Whenever several jobs are currently available, choose higher urgency first and use original input order as the final tie-breaker. Reject duplicate IDs, unknown prerequisite IDs, and dependency cycles. Do not mutate the jobs or their `after` arrays. Preserve the existing behavior for independent jobs, then run `npm test`.

## Hidden expectation sufficiency

- **dependencies outrank urgency until they are satisfied** — Implement `scheduleJobs(jobs)` in `src/release-plan.js`. Every job has a unique string `id`, an optional `after` array of prerequisite job IDs, and an optional numeric `urgency` (default 0). Return the IDs in a valid dependency order. Whenever several jobs are currently available, choose higher urgency first and use original input order as the final tie-breaker. Reject duplicate IDs, unknown prerequisite IDs, and dependency cycles. Do not mutate the jobs or their `after` arrays. Preserve the existing behavior for independent jobs, then run `npm test`.
- **chooses among newly available jobs by urgency then input order** — Implement `scheduleJobs(jobs)` in `src/release-plan.js`. Every job has a unique string `id`, an optional `after` array of prerequisite job IDs, and an optional numeric `urgency` (default 0). Return the IDs in a valid dependency order. Whenever several jobs are currently available, choose higher urgency first and use original input order as the final tie-breaker. Reject duplicate IDs, unknown prerequisite IDs, and dependency cycles. Do not mutate the jobs or their `after` arrays. Preserve the existing behavior for independent jobs, then run `npm test`.
- **rejects malformed dependency graphs** — Implement `scheduleJobs(jobs)` in `src/release-plan.js`. Every job has a unique string `id`, an optional `after` array of prerequisite job IDs, and an optional numeric `urgency` (default 0). Return the IDs in a valid dependency order. Whenever several jobs are currently available, choose higher urgency first and use original input order as the final tie-breaker. Reject duplicate IDs, unknown prerequisite IDs, and dependency cycles. Do not mutate the jobs or their `after` arrays. Preserve the existing behavior for independent jobs, then run `npm test`.
- **does not mutate jobs or dependency arrays** — Implement `scheduleJobs(jobs)` in `src/release-plan.js`. Every job has a unique string `id`, an optional `after` array of prerequisite job IDs, and an optional numeric `urgency` (default 0). Return the IDs in a valid dependency order. Whenever several jobs are currently available, choose higher urgency first and use original input order as the final tie-breaker. Reject duplicate IDs, unknown prerequisite IDs, and dependency cycles. Do not mutate the jobs or their `after` arrays. Preserve the existing behavior for independent jobs, then run `npm test`.

## Equivalent perturbations

### equivalent-1

Complete the following repository task. Preserve existing behavior and verify the tests.

Implement `scheduleJobs(jobs)` in `src/release-plan.js`. Every job has a unique string `id`, an optional `after` array of prerequisite job IDs, and an optional numeric `urgency` (default 0). Return the IDs in a valid dependency order. Whenever several jobs are currently available, choose higher urgency first and use original input order as the final tie-breaker. Reject duplicate IDs, unknown prerequisite IDs, and dependency cycles. Do not mutate the jobs or their `after` arrays. Preserve the existing behavior for independent jobs, then run `npm test`.

### equivalent-2

Repository change request:
Implement `scheduleJobs(jobs)` in `src/release-plan.js`. Every job has a unique string `id`, an optional `after` array of prerequisite job IDs, and an optional numeric `urgency` (default 0). Return the IDs in a valid dependency order. Whenever several jobs are currently available, choose higher urgency first and use original input order as the final tie-breaker. Reject duplicate IDs, unknown prerequisite IDs, and dependency cycles. Do not mutate the jobs or their `after` arrays. Preserve the existing behavior for independent jobs, then run `npm test`.

Use the smallest correct change and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining all stated edge cases:

Implement `scheduleJobs(jobs)` in `src/release-plan.js`. Every job has a unique string `id`, an optional `after` array of prerequisite job IDs, and an optional numeric `urgency` (default 0). Return the IDs in a valid dependency order. Whenever several jobs are currently available, choose higher urgency first and use original input order as the final tie-breaker. Reject duplicate IDs, unknown prerequisite IDs, and dependency cycles. Do not mutate the jobs or their `after` arrays. Preserve the existing behavior for independent jobs, then run `npm test`.

## Difficulty crux (author's pre-data claim)

- Mechanism: algorithm-class upgrade under a partial order: a comparator cannot express dependency constraints; the fix demands a topological scheduler with tie-breaks and rejection guards
- Expected failure: keeps the urgency sort and patches around it; dependency ordering never holds
- Band prediction: `[0.3, 0.6]`

## Automated admission

- Passed: `True`
- Checked: `2026-08-18T09:19:09Z`

## Human decision

- Reviewer: `albert`
- Approved: `True`
