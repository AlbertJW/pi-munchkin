# Fixture review: equil

- Schema: `pi.fixture/v1`
- Cohort: `2026-07`
- Version: `2026-07.1`
- Expires: `set on approval`

## Canonical prompt

Implement equilibria(arr) in src/index.js. Return an array of every index i where the sum
of the elements BEFORE i equals the sum of the elements AFTER i (the element at i is
excluded from both sides), in ascending order. Endpoints count: at index 0 the left side is
empty (sum 0); at the last index the right side is empty (sum 0). The array may contain
negatives and zeros. Examples: equilibria([1,1,1,3,1,1,1]) -> [3];
equilibria([0,-3,5,-4,-2,3,1,0]) -> [0,3,7]. Run node --test until all tests pass.

## Hidden expectation sufficiency

- **endpoints count** — Implement equilibria(arr) in src/index.js. Return an array of every index i where the sum
of the elements BEFORE i equals the sum of the elements AFTER i (the element at i is
excluded from both sides), in ascending order. Endpoints count: at index 0 the left side is
empty (sum 0); at the last index the right side is empty (sum 0). The array may contain
negatives and zeros. Examples: equilibria([1,1,1,3,1,1,1]) -> [3];
equilibria([0,-3,5,-4,-2,3,1,0]) -> [0,3,7]. Run node --test until all tests pass.
- **left endpoint only** — Implement equilibria(arr) in src/index.js. Return an array of every index i where the sum
of the elements BEFORE i equals the sum of the elements AFTER i (the element at i is
excluded from both sides), in ascending order. Endpoints count: at index 0 the left side is
empty (sum 0); at the last index the right side is empty (sum 0). The array may contain
negatives and zeros. Examples: equilibria([1,1,1,3,1,1,1]) -> [3];
equilibria([0,-3,5,-4,-2,3,1,0]) -> [0,3,7]. Run node --test until all tests pass.

## Equivalent perturbations

### equivalent-1

Complete the following repository task. Preserve existing behavior and verify the tests.

Implement equilibria(arr) in src/index.js. Return an array of every index i where the sum
of the elements BEFORE i equals the sum of the elements AFTER i (the element at i is
excluded from both sides), in ascending order. Endpoints count: at index 0 the left side is
empty (sum 0); at the last index the right side is empty (sum 0). The array may contain
negatives and zeros. Examples: equilibria([1,1,1,3,1,1,1]) -> [3];
equilibria([0,-3,5,-4,-2,3,1,0]) -> [0,3,7]. Run node --test until all tests pass.

### equivalent-2

Repository change request:
Implement equilibria(arr) in src/index.js. Return an array of every index i where the sum
of the elements BEFORE i equals the sum of the elements AFTER i (the element at i is
excluded from both sides), in ascending order. Endpoints count: at index 0 the left side is
empty (sum 0); at the last index the right side is empty (sum 0). The array may contain
negatives and zeros. Examples: equilibria([1,1,1,3,1,1,1]) -> [3];
equilibria([0,-3,5,-4,-2,3,1,0]) -> [0,3,7]. Run node --test until all tests pass.

Use the smallest correct change and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining all stated edge cases:

Implement equilibria(arr) in src/index.js. Return an array of every index i where the sum
of the elements BEFORE i equals the sum of the elements AFTER i (the element at i is
excluded from both sides), in ascending order. Endpoints count: at index 0 the left side is
empty (sum 0); at the last index the right side is empty (sum 0). The array may contain
negatives and zeros. Examples: equilibria([1,1,1,3,1,1,1]) -> [3];
equilibria([0,-3,5,-4,-2,3,1,0]) -> [0,3,7]. Run node --test until all tests pass.

## Automated admission

- Passed: `True`
- Checked: `2026-07-14T18:48:31Z`

## Human decision

- Reviewer: `pending`
- Approved: `False`
