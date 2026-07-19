# Fixture review: saddle

- Schema: `pi.fixture/v1`
- Cohort: `2026-07`
- Version: `2026-07.1`
- Expires: `set on approval`

## Canonical prompt

Implement saddlePoints(matrix) in src/index.js. matrix is an array of rows (arrays of
numbers). A saddle point is a cell that is the MAXIMUM in its row and the MINIMUM in its
column. Return an array of { row, col } objects with 1-BASED indices, in row-major order
(row by row, left to right). An empty matrix returns []. There may be zero, one, or many
saddle points. Run node --test until all tests pass.

## Hidden expectation sufficiency

- **no saddle point** — Implement saddlePoints(matrix) in src/index.js. matrix is an array of rows (arrays of
numbers). A saddle point is a cell that is the MAXIMUM in its row and the MINIMUM in its
column. Return an array of { row, col } objects with 1-BASED indices, in row-major order
(row by row, left to right). An empty matrix returns []. There may be zero, one, or many
saddle points. Run node --test until all tests pass.
- **empty matrix** — Implement saddlePoints(matrix) in src/index.js. matrix is an array of rows (arrays of
numbers). A saddle point is a cell that is the MAXIMUM in its row and the MINIMUM in its
column. Return an array of { row, col } objects with 1-BASED indices, in row-major order
(row by row, left to right). An empty matrix returns []. There may be zero, one, or many
saddle points. Run node --test until all tests pass.
- **row-major single** — Implement saddlePoints(matrix) in src/index.js. matrix is an array of rows (arrays of
numbers). A saddle point is a cell that is the MAXIMUM in its row and the MINIMUM in its
column. Return an array of { row, col } objects with 1-BASED indices, in row-major order
(row by row, left to right). An empty matrix returns []. There may be zero, one, or many
saddle points. Run node --test until all tests pass.

## Equivalent perturbations

### equivalent-1

Complete the following repository task. Preserve existing behavior and verify the tests.

Implement saddlePoints(matrix) in src/index.js. matrix is an array of rows (arrays of
numbers). A saddle point is a cell that is the MAXIMUM in its row and the MINIMUM in its
column. Return an array of { row, col } objects with 1-BASED indices, in row-major order
(row by row, left to right). An empty matrix returns []. There may be zero, one, or many
saddle points. Run node --test until all tests pass.

### equivalent-2

Repository change request:
Implement saddlePoints(matrix) in src/index.js. matrix is an array of rows (arrays of
numbers). A saddle point is a cell that is the MAXIMUM in its row and the MINIMUM in its
column. Return an array of { row, col } objects with 1-BASED indices, in row-major order
(row by row, left to right). An empty matrix returns []. There may be zero, one, or many
saddle points. Run node --test until all tests pass.

Use the smallest correct change and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining all stated edge cases:

Implement saddlePoints(matrix) in src/index.js. matrix is an array of rows (arrays of
numbers). A saddle point is a cell that is the MAXIMUM in its row and the MINIMUM in its
column. Return an array of { row, col } objects with 1-BASED indices, in row-major order
(row by row, left to right). An empty matrix returns []. There may be zero, one, or many
saddle points. Run node --test until all tests pass.

## Automated admission

- Passed: `True`
- Checked: `2026-07-14T18:49:00Z`

## Human decision

- Reviewer: `pending`
- Approved: `False`
