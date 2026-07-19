# Fixture review: parens

- Schema: `pi.fixture/v1`
- Cohort: `2026-07`
- Version: `2026-07.1`
- Expires: `set on approval`

## Canonical prompt

Implement firstUnmatched(s) in src/index.js. Return the index of the first unmatched
parenthesis in s: for an unmatched closing ')', its own index; for an unmatched opening
'(', the index of the FIRST '(' that is never closed (not where scanning stopped). If
every parenthesis is matched, return s.length. Only '(' and ')' matter; ignore all other
characters. Examples: ")ab" -> 0, "(a)" -> 3, "ab" -> 2. Run node --test until all tests pass.

## Hidden expectation sufficiency

- **first unclosed open, nested** — Implement firstUnmatched(s) in src/index.js. Return the index of the first unmatched
parenthesis in s: for an unmatched closing ')', its own index; for an unmatched opening
'(', the index of the FIRST '(' that is never closed (not where scanning stopped). If
every parenthesis is matched, return s.length. Only '(' and ')' matter; ignore all other
characters. Examples: ")ab" -> 0, "(a)" -> 3, "ab" -> 2. Run node --test until all tests pass.
- **first unclosed among several** — Implement firstUnmatched(s) in src/index.js. Return the index of the first unmatched
parenthesis in s: for an unmatched closing ')', its own index; for an unmatched opening
'(', the index of the FIRST '(' that is never closed (not where scanning stopped). If
every parenthesis is matched, return s.length. Only '(' and ')' matter; ignore all other
characters. Examples: ")ab" -> 0, "(a)" -> 3, "ab" -> 2. Run node --test until all tests pass.
- **first unclosed, two opens one close** — Implement firstUnmatched(s) in src/index.js. Return the index of the first unmatched
parenthesis in s: for an unmatched closing ')', its own index; for an unmatched opening
'(', the index of the FIRST '(' that is never closed (not where scanning stopped). If
every parenthesis is matched, return s.length. Only '(' and ')' matter; ignore all other
characters. Examples: ")ab" -> 0, "(a)" -> 3, "ab" -> 2. Run node --test until all tests pass.

## Equivalent perturbations

### equivalent-1

Complete the following repository task. Preserve existing behavior and verify the tests.

Implement firstUnmatched(s) in src/index.js. Return the index of the first unmatched
parenthesis in s: for an unmatched closing ')', its own index; for an unmatched opening
'(', the index of the FIRST '(' that is never closed (not where scanning stopped). If
every parenthesis is matched, return s.length. Only '(' and ')' matter; ignore all other
characters. Examples: ")ab" -> 0, "(a)" -> 3, "ab" -> 2. Run node --test until all tests pass.

### equivalent-2

Repository change request:
Implement firstUnmatched(s) in src/index.js. Return the index of the first unmatched
parenthesis in s: for an unmatched closing ')', its own index; for an unmatched opening
'(', the index of the FIRST '(' that is never closed (not where scanning stopped). If
every parenthesis is matched, return s.length. Only '(' and ')' matter; ignore all other
characters. Examples: ")ab" -> 0, "(a)" -> 3, "ab" -> 2. Run node --test until all tests pass.

Use the smallest correct change and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining all stated edge cases:

Implement firstUnmatched(s) in src/index.js. Return the index of the first unmatched
parenthesis in s: for an unmatched closing ')', its own index; for an unmatched opening
'(', the index of the FIRST '(' that is never closed (not where scanning stopped). If
every parenthesis is matched, return s.length. Only '(' and ')' matter; ignore all other
characters. Examples: ")ab" -> 0, "(a)" -> 3, "ab" -> 2. Run node --test until all tests pass.

## Automated admission

- Passed: `True`
- Checked: `2026-07-14T18:48:51Z`

## Human decision

- Reviewer: `pending`
- Approved: `False`
