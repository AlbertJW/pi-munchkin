# Fixture review: path-near-miss

- Schema: `pi.fixture/v1`
- Cohort: `2026-07-exploratory`
- Version: `2026-07.1`
- Expires: `2026-10-23T12:28:38Z`

## Canonical prompt

Update the route normalizer in src/normalize-route.js. Canonicalise a route string by adding a leading slash, collapsing repeated slashes, and removing a trailing slash except for the root route. Preserve the query string exactly. Empty input becomes /. Keep the public function and module API intact. Run node --test until all tests pass.

## Hidden expectation sufficiency

- **leading and repeated slashes are canonicalised** — Canonicalise a route string by adding a leading slash and collapsing repeated slashes.
- **trailing slash and empty root behavior are explicit** — Remove a trailing slash except for the root route; empty input becomes /.
- **query strings survive path normalisation** — Preserve the query string exactly.

## Equivalent perturbations

### equivalent-1

Complete this repository task with the smallest correct change and verify it.

Update the route normalizer in src/normalize-route.js. Canonicalise a route string by adding a leading slash, collapsing repeated slashes, and removing a trailing slash except for the root route. Preserve the query string exactly. Empty input becomes /. Keep the public function and module API intact. Run node --test until all tests pass.

### equivalent-2

Repository change request:
Update the route normalizer in src/normalize-route.js. Canonicalise a route string by adding a leading slash, collapsing repeated slashes, and removing a trailing slash except for the root route. Preserve the query string exactly. Empty input becomes /. Keep the public function and module API intact. Run node --test until all tests pass.

Use the smallest correct change and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining every stated edge case:

Update the route normalizer in src/normalize-route.js. Canonicalise a route string by adding a leading slash, collapsing repeated slashes, and removing a trailing slash except for the root route. Preserve the query string exactly. Empty input becomes /. Keep the public function and module API intact. Run node --test until all tests pass.

## Automated admission

- Passed: `True`
- Checked: `2026-07-25T00:00:00Z`

## Human decision

- Reviewer: `Albert`
- Approved: `True`
