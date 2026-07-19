# Fixture review: ghost

- Schema: `pi.fixture/v1`
- Cohort: `2026-07`
- Version: `2026-07.1`
- Expires: `set on approval`

## Canonical prompt

Add and export a new function toCSV(data) in src/csv-writer.js — the inverse of parseCSV: it serializes an array of row objects into a CSV string. Use the first row's keys as the header row. Quote a field (wrap it in double quotes) if and only if it contains a comma, a double-quote, or a newline, doubling any embedded double-quotes (RFC 4180). Join rows with a newline and emit no trailing newline. The function must be importable from the project's public entry point. If the project layout differs from these instructions, reconcile with the actual layout rather than inventing files blindly.

## Hidden expectation sufficiency

- **toCSV: simple unquoted** — Add and export a new function toCSV(data) in src/csv-writer.js — the inverse of parseCSV: it serializes an array of row objects into a CSV string. Use the first row's keys as the header row. Quote a field (wrap it in double quotes) if and only if it contains a comma, a double-quote, or a newline, doubling any embedded double-quotes (RFC 4180). Join rows with a newline and emit no trailing newline. The function must be importable from the project's public entry point. If the project layout differs from these instructions, reconcile with the actual layout rather than inventing files blindly.
- **toCSV: quotes fields containing commas** — Add and export a new function toCSV(data) in src/csv-writer.js — the inverse of parseCSV: it serializes an array of row objects into a CSV string. Use the first row's keys as the header row. Quote a field (wrap it in double quotes) if and only if it contains a comma, a double-quote, or a newline, doubling any embedded double-quotes (RFC 4180). Join rows with a newline and emit no trailing newline. The function must be importable from the project's public entry point. If the project layout differs from these instructions, reconcile with the actual layout rather than inventing files blindly.
- **toCSV: escapes embedded double-quotes by doubling** — Add and export a new function toCSV(data) in src/csv-writer.js — the inverse of parseCSV: it serializes an array of row objects into a CSV string. Use the first row's keys as the header row. Quote a field (wrap it in double quotes) if and only if it contains a comma, a double-quote, or a newline, doubling any embedded double-quotes (RFC 4180). Join rows with a newline and emit no trailing newline. The function must be importable from the project's public entry point. If the project layout differs from these instructions, reconcile with the actual layout rather than inventing files blindly.
- **toCSV: multiple rows, header from first row keys** — Add and export a new function toCSV(data) in src/csv-writer.js — the inverse of parseCSV: it serializes an array of row objects into a CSV string. Use the first row's keys as the header row. Quote a field (wrap it in double quotes) if and only if it contains a comma, a double-quote, or a newline, doubling any embedded double-quotes (RFC 4180). Join rows with a newline and emit no trailing newline. The function must be importable from the project's public entry point. If the project layout differs from these instructions, reconcile with the actual layout rather than inventing files blindly.

## Equivalent perturbations

### equivalent-1

Complete the following repository task. Preserve existing behavior and verify the tests.

Add and export a new function toCSV(data) in src/csv-writer.js — the inverse of parseCSV: it serializes an array of row objects into a CSV string. Use the first row's keys as the header row. Quote a field (wrap it in double quotes) if and only if it contains a comma, a double-quote, or a newline, doubling any embedded double-quotes (RFC 4180). Join rows with a newline and emit no trailing newline. The function must be importable from the project's public entry point. If the project layout differs from these instructions, reconcile with the actual layout rather than inventing files blindly.

### equivalent-2

Repository change request:
Add and export a new function toCSV(data) in src/csv-writer.js — the inverse of parseCSV: it serializes an array of row objects into a CSV string. Use the first row's keys as the header row. Quote a field (wrap it in double quotes) if and only if it contains a comma, a double-quote, or a newline, doubling any embedded double-quotes (RFC 4180). Join rows with a newline and emit no trailing newline. The function must be importable from the project's public entry point. If the project layout differs from these instructions, reconcile with the actual layout rather than inventing files blindly.

Use the smallest correct change and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining all stated edge cases:

Add and export a new function toCSV(data) in src/csv-writer.js — the inverse of parseCSV: it serializes an array of row objects into a CSV string. Use the first row's keys as the header row. Quote a field (wrap it in double quotes) if and only if it contains a comma, a double-quote, or a newline, doubling any embedded double-quotes (RFC 4180). Join rows with a newline and emit no trailing newline. The function must be importable from the project's public entry point. If the project layout differs from these instructions, reconcile with the actual layout rather than inventing files blindly.

## Automated admission

- Passed: `True`
- Checked: `2026-07-14T18:48:34Z`

## Human decision

- Reviewer: `pending`
- Approved: `False`
