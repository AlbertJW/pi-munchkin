# Fixture review: rle

- Schema: `pi.fixture/v1`
- Cohort: `2026-07`
- Version: `2026-07.1`
- Expires: `set on approval`

## Canonical prompt

Implement encode(s) and decode(s) in src/index.js for run-length encoding. encode replaces
each run of 2 or more identical consecutive characters with the count followed by the
character; single characters are left as-is: encode("AABCCCDEEEE") -> "2AB3CD4E". decode is
the exact inverse: decode("2AB3CD4E") -> "AABCCCDEEEE". Counts may be multiple digits.
encode("") -> "". Input strings contain non-digit characters; decimal digits are reserved
for run counts. A round trip decode(encode(s)) must return s for any input in that domain. Run node
--test until all tests pass.

## Hidden expectation sufficiency

- **multi-digit run encode** — Implement encode(s) and decode(s) in src/index.js for run-length encoding. encode replaces
each run of 2 or more identical consecutive characters with the count followed by the
character; single characters are left as-is: encode("AABCCCDEEEE") -> "2AB3CD4E". decode is
the exact inverse: decode("2AB3CD4E") -> "AABCCCDEEEE". Counts may be multiple digits.
encode("") -> "". Input strings contain non-digit characters; decimal digits are reserved
for run counts. A round trip decode(encode(s)) must return s for any input in that domain. Run node
--test until all tests pass.
- **multi-digit run decode** — Implement encode(s) and decode(s) in src/index.js for run-length encoding. encode replaces
each run of 2 or more identical consecutive characters with the count followed by the
character; single characters are left as-is: encode("AABCCCDEEEE") -> "2AB3CD4E". decode is
the exact inverse: decode("2AB3CD4E") -> "AABCCCDEEEE". Counts may be multiple digits.
encode("") -> "". Input strings contain non-digit characters; decimal digits are reserved
for run counts. A round trip decode(encode(s)) must return s for any input in that domain. Run node
--test until all tests pass.
- **no runs unchanged** — Implement encode(s) and decode(s) in src/index.js for run-length encoding. encode replaces
each run of 2 or more identical consecutive characters with the count followed by the
character; single characters are left as-is: encode("AABCCCDEEEE") -> "2AB3CD4E". decode is
the exact inverse: decode("2AB3CD4E") -> "AABCCCDEEEE". Counts may be multiple digits.
encode("") -> "". Input strings contain non-digit characters; decimal digits are reserved
for run counts. A round trip decode(encode(s)) must return s for any input in that domain. Run node
--test until all tests pass.
- **round trip** — Implement encode(s) and decode(s) in src/index.js for run-length encoding. encode replaces
each run of 2 or more identical consecutive characters with the count followed by the
character; single characters are left as-is: encode("AABCCCDEEEE") -> "2AB3CD4E". decode is
the exact inverse: decode("2AB3CD4E") -> "AABCCCDEEEE". Counts may be multiple digits.
encode("") -> "". Input strings contain non-digit characters; decimal digits are reserved
for run counts. A round trip decode(encode(s)) must return s for any input in that domain. Run node
--test until all tests pass.

## Equivalent perturbations

### equivalent-1

Complete the following repository task. Preserve existing behavior and verify the tests.

Implement encode(s) and decode(s) in src/index.js for run-length encoding. encode replaces
each run of 2 or more identical consecutive characters with the count followed by the
character; single characters are left as-is: encode("AABCCCDEEEE") -> "2AB3CD4E". decode is
the exact inverse: decode("2AB3CD4E") -> "AABCCCDEEEE". Counts may be multiple digits.
encode("") -> "". Input strings contain non-digit characters; decimal digits are reserved
for run counts. A round trip decode(encode(s)) must return s for any input in that domain. Run node
--test until all tests pass.

### equivalent-2

Repository change request:
Implement encode(s) and decode(s) in src/index.js for run-length encoding. encode replaces
each run of 2 or more identical consecutive characters with the count followed by the
character; single characters are left as-is: encode("AABCCCDEEEE") -> "2AB3CD4E". decode is
the exact inverse: decode("2AB3CD4E") -> "AABCCCDEEEE". Counts may be multiple digits.
encode("") -> "". Input strings contain non-digit characters; decimal digits are reserved
for run counts. A round trip decode(encode(s)) must return s for any input in that domain. Run node
--test until all tests pass.

Use the smallest correct change and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining all stated edge cases:

Implement encode(s) and decode(s) in src/index.js for run-length encoding. encode replaces
each run of 2 or more identical consecutive characters with the count followed by the
character; single characters are left as-is: encode("AABCCCDEEEE") -> "2AB3CD4E". decode is
the exact inverse: decode("2AB3CD4E") -> "AABCCCDEEEE". Counts may be multiple digits.
encode("") -> "". Input strings contain non-digit characters; decimal digits are reserved
for run counts. A round trip decode(encode(s)) must return s for any input in that domain. Run node
--test until all tests pass.

## Automated admission

- Passed: `True`
- Checked: `2026-07-14T18:51:28Z`

## Human decision

- Reviewer: `pending`
- Approved: `False`
