# Fixture review: ling-path-evidence

- Schema: `pi.fixture/v1`
- Cohort: `2026-08`
- Version: `2026-08.1`
- Expires: `set on approval`

## Canonical prompt

Repair the package's public `normalizeTicket(value)` API. Locate its owning implementation from `package.json`, `src/index.js`, and the tests rather than assuming a similarly named source file is live. Valid ticket IDs contain a project prefix, a hyphen, and decimal digits. Trim surrounding whitespace, remove internal whitespace, uppercase the prefix, and canonicalise the numeric part by removing leading zeroes (`000` becomes `0`). Reject malformed values with `TypeError`. Keep the public export intact and run `npm test`.

## Hidden expectation sufficiency

- **normalises whitespace and leading zeroes through the public export** — Repair the package's public `normalizeTicket(value)` API. Locate its owning implementation from `package.json`, `src/index.js`, and the tests rather than assuming a similarly named source file is live. Valid ticket IDs contain a project prefix, a hyphen, and decimal digits. Trim surrounding whitespace, remove internal whitespace, uppercase the prefix, and canonicalise the numeric part by removing leading zeroes (`000` becomes `0`). Reject malformed values with `TypeError`. Keep the public export intact and run `npm test`.
- **accepts alphabetic project prefixes and decimal digits only** — Repair the package's public `normalizeTicket(value)` API. Locate its owning implementation from `package.json`, `src/index.js`, and the tests rather than assuming a similarly named source file is live. Valid ticket IDs contain a project prefix, a hyphen, and decimal digits. Trim surrounding whitespace, remove internal whitespace, uppercase the prefix, and canonicalise the numeric part by removing leading zeroes (`000` becomes `0`). Reject malformed values with `TypeError`. Keep the public export intact and run `npm test`.
- **the package export owns the repaired implementation** — Repair the package's public `normalizeTicket(value)` API. Locate its owning implementation from `package.json`, `src/index.js`, and the tests rather than assuming a similarly named source file is live. Valid ticket IDs contain a project prefix, a hyphen, and decimal digits. Trim surrounding whitespace, remove internal whitespace, uppercase the prefix, and canonicalise the numeric part by removing leading zeroes (`000` becomes `0`). Reject malformed values with `TypeError`. Keep the public export intact and run `npm test`.

## Equivalent perturbations

### equivalent-1

Complete the following repository task. Preserve existing behavior and verify the tests.

Repair the package's public `normalizeTicket(value)` API. Locate its owning implementation from `package.json`, `src/index.js`, and the tests rather than assuming a similarly named source file is live. Valid ticket IDs contain a project prefix, a hyphen, and decimal digits. Trim surrounding whitespace, remove internal whitespace, uppercase the prefix, and canonicalise the numeric part by removing leading zeroes (`000` becomes `0`). Reject malformed values with `TypeError`. Keep the public export intact and run `npm test`.

### equivalent-2

Repository change request:
Repair the package's public `normalizeTicket(value)` API. Locate its owning implementation from `package.json`, `src/index.js`, and the tests rather than assuming a similarly named source file is live. Valid ticket IDs contain a project prefix, a hyphen, and decimal digits. Trim surrounding whitespace, remove internal whitespace, uppercase the prefix, and canonicalise the numeric part by removing leading zeroes (`000` becomes `0`). Reject malformed values with `TypeError`. Keep the public export intact and run `npm test`.

Use the smallest correct change and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining all stated edge cases:

Repair the package's public `normalizeTicket(value)` API. Locate its owning implementation from `package.json`, `src/index.js`, and the tests rather than assuming a similarly named source file is live. Valid ticket IDs contain a project prefix, a hyphen, and decimal digits. Trim surrounding whitespace, remove internal whitespace, uppercase the prefix, and canonicalise the numeric part by removing leading zeroes (`000` becomes `0`). Reject malformed values with `TypeError`. Keep the public export intact and run `npm test`.

## Automated admission

- Passed: `True`
- Checked: `2026-08-13T12:47:30Z`

## Human decision

- Reviewer: `pending`
- Approved: `False`
