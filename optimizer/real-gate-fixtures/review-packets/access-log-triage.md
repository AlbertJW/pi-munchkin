# Fixture review: access-log-triage

- Schema: `pi.fixture/v1`
- Cohort: `2026-07`
- Version: `2026-07.1`
- Expires: `set on approval`

## Canonical prompt

This repo processes an access log for a small internal dashboard. docs/fields.md is the
authoritative reference for the JSON-line format in data/access.log and the three ways a line can
be malformed (invalid-json, bad-status, bad-bytes) -- consult it, since both src files need to
agree with it exactly. Two gaps: (1) src/parseLog.js's parseRecord(line) already validates status
and bytes correctly, but a malformed (non-JSON) line currently throws instead of being classified
-- fix it to return the right result per docs/fields.md instead of throwing. (2) src/report.js's
summarizeAccessLog(lines) is unimplemented -- build it using parseRecord: valid lines go in `ok`,
and every malformed line must be counted under its exact reason code in `malformed` (one counter
per code that occurs), with every input line landing in exactly one place. Return { ok, malformed,
total }. Run node --test until all tests pass.

## Hidden expectation sufficiency

- **parseRecord returns {ok:false, reason:'invalid-json'} for malformed JSON (curated + fuzzed), never throws.** — a malformed (non-JSON) line currently throws instead of being classified
-- fix it to return the right result per docs/fields.md instead of throwing
- **summarizeAccessLog's malformed object breaks out counts per exact reason code that occurred.** — every malformed line must be counted under its exact reason code in `malformed` (one counter
per code that occurs)
- **Every input line lands in exactly one place (ok.length + sum(malformed) === total), none silently dropped.** — with every input line landing in exactly one place

## Equivalent perturbations

### equivalent-1

Complete the following repository task. Preserve existing behavior and verify the tests.

This repo processes an access log for a small internal dashboard. docs/fields.md is the
authoritative reference for the JSON-line format in data/access.log and the three ways a line can
be malformed (invalid-json, bad-status, bad-bytes) -- consult it, since both src files need to
agree with it exactly. Two gaps: (1) src/parseLog.js's parseRecord(line) already validates status
and bytes correctly, but a malformed (non-JSON) line currently throws instead of being classified
-- fix it to return the right result per docs/fields.md instead of throwing. (2) src/report.js's
summarizeAccessLog(lines) is unimplemented -- build it using parseRecord: valid lines go in `ok`,
and every malformed line must be counted under its exact reason code in `malformed` (one counter
per code that occurs), with every input line landing in exactly one place. Return { ok, malformed,
total }. Run node --test until all tests pass.

### equivalent-2

Repository change request:
This repo processes an access log for a small internal dashboard. docs/fields.md is the
authoritative reference for the JSON-line format in data/access.log and the three ways a line can
be malformed (invalid-json, bad-status, bad-bytes) -- consult it, since both src files need to
agree with it exactly. Two gaps: (1) src/parseLog.js's parseRecord(line) already validates status
and bytes correctly, but a malformed (non-JSON) line currently throws instead of being classified
-- fix it to return the right result per docs/fields.md instead of throwing. (2) src/report.js's
summarizeAccessLog(lines) is unimplemented -- build it using parseRecord: valid lines go in `ok`,
and every malformed line must be counted under its exact reason code in `malformed` (one counter
per code that occurs), with every input line landing in exactly one place. Return { ok, malformed,
total }. Run node --test until all tests pass.

Use the smallest correct change and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining all stated edge cases:

This repo processes an access log for a small internal dashboard. docs/fields.md is the
authoritative reference for the JSON-line format in data/access.log and the three ways a line can
be malformed (invalid-json, bad-status, bad-bytes) -- consult it, since both src files need to
agree with it exactly. Two gaps: (1) src/parseLog.js's parseRecord(line) already validates status
and bytes correctly, but a malformed (non-JSON) line currently throws instead of being classified
-- fix it to return the right result per docs/fields.md instead of throwing. (2) src/report.js's
summarizeAccessLog(lines) is unimplemented -- build it using parseRecord: valid lines go in `ok`,
and every malformed line must be counted under its exact reason code in `malformed` (one counter
per code that occurs), with every input line landing in exactly one place. Return { ok, malformed,
total }. Run node --test until all tests pass.

## Automated admission

- Passed: `True`
- Checked: `2026-07-24T12:41:14Z`

## Human decision

- Reviewer: `pending`
- Approved: `False`
