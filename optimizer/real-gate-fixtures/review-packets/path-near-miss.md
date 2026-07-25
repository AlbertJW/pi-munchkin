# Fixture review: path-near-miss

- Schema: `pi.fixture/v1`
- Cohort: `2026-07-exploratory`
- Version: `2026-07.1`
- Human approval: pending (exploratory calibration only)

## Canonical prompt

The prompt deliberately names `src/normalize-route.js`; the checkout contains exactly one nearby real path, `src/normalise-route.js`. The hidden grader evaluates route canonicalisation, trailing-root behavior, empty input, and query preservation. It does not inspect the model's exploration sequence.

## Sufficiency

- Leading and repeated slashes are covered.
- Trailing slash and empty-root behavior are covered.
- Query-string preservation is covered.

## Automated admission

`fixture_admission.py verify path-near-miss` passes the pristine, gold, and shortcut-mutant matrix. This packet is not a human approval record; do not invoke `fixture_admission.py approve` without explicit authorization.
