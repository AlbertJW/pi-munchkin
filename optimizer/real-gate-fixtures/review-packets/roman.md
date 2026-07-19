# Fixture review: roman

- Schema: `pi.fixture/v1`
- Cohort: `2026-07`
- Version: `2026-07.1`
- Expires: `set on approval`

## Canonical prompt

Implement fromRoman(s) in src/index.js. Parse a Roman numeral string and return its integer
value, or return null if s is NOT a valid Roman numeral. Validity matters: "IIX", "VV",
"IL", and "IIII" are all invalid and must return null. Valid examples: fromRoman("XIV") ->
14, fromRoman("MCMXCIV") -> 1994, fromRoman("XL") -> 40. A plain left-to-right subtractive
sum is not enough — you must reject malformed numerals. Run node --test until all tests pass.

## Hidden expectation sufficiency

- **reject IIX** — Implement fromRoman(s) in src/index.js. Parse a Roman numeral string and return its integer
value, or return null if s is NOT a valid Roman numeral. Validity matters: "IIX", "VV",
"IL", and "IIII" are all invalid and must return null. Valid examples: fromRoman("XIV") ->
14, fromRoman("MCMXCIV") -> 1994, fromRoman("XL") -> 40. A plain left-to-right subtractive
sum is not enough — you must reject malformed numerals. Run node --test until all tests pass.
- **reject VV** — Implement fromRoman(s) in src/index.js. Parse a Roman numeral string and return its integer
value, or return null if s is NOT a valid Roman numeral. Validity matters: "IIX", "VV",
"IL", and "IIII" are all invalid and must return null. Valid examples: fromRoman("XIV") ->
14, fromRoman("MCMXCIV") -> 1994, fromRoman("XL") -> 40. A plain left-to-right subtractive
sum is not enough — you must reject malformed numerals. Run node --test until all tests pass.
- **reject IIII** — Implement fromRoman(s) in src/index.js. Parse a Roman numeral string and return its integer
value, or return null if s is NOT a valid Roman numeral. Validity matters: "IIX", "VV",
"IL", and "IIII" are all invalid and must return null. Valid examples: fromRoman("XIV") ->
14, fromRoman("MCMXCIV") -> 1994, fromRoman("XL") -> 40. A plain left-to-right subtractive
sum is not enough — you must reject malformed numerals. Run node --test until all tests pass.
- **reject IL** — Implement fromRoman(s) in src/index.js. Parse a Roman numeral string and return its integer
value, or return null if s is NOT a valid Roman numeral. Validity matters: "IIX", "VV",
"IL", and "IIII" are all invalid and must return null. Valid examples: fromRoman("XIV") ->
14, fromRoman("MCMXCIV") -> 1994, fromRoman("XL") -> 40. A plain left-to-right subtractive
sum is not enough — you must reject malformed numerals. Run node --test until all tests pass.
- **still parses valid CMXLIV** — Implement fromRoman(s) in src/index.js. Parse a Roman numeral string and return its integer
value, or return null if s is NOT a valid Roman numeral. Validity matters: "IIX", "VV",
"IL", and "IIII" are all invalid and must return null. Valid examples: fromRoman("XIV") ->
14, fromRoman("MCMXCIV") -> 1994, fromRoman("XL") -> 40. A plain left-to-right subtractive
sum is not enough — you must reject malformed numerals. Run node --test until all tests pass.

## Equivalent perturbations

### equivalent-1

Complete the following repository task. Preserve existing behavior and verify the tests.

Implement fromRoman(s) in src/index.js. Parse a Roman numeral string and return its integer
value, or return null if s is NOT a valid Roman numeral. Validity matters: "IIX", "VV",
"IL", and "IIII" are all invalid and must return null. Valid examples: fromRoman("XIV") ->
14, fromRoman("MCMXCIV") -> 1994, fromRoman("XL") -> 40. A plain left-to-right subtractive
sum is not enough — you must reject malformed numerals. Run node --test until all tests pass.

### equivalent-2

Repository change request:
Implement fromRoman(s) in src/index.js. Parse a Roman numeral string and return its integer
value, or return null if s is NOT a valid Roman numeral. Validity matters: "IIX", "VV",
"IL", and "IIII" are all invalid and must return null. Valid examples: fromRoman("XIV") ->
14, fromRoman("MCMXCIV") -> 1994, fromRoman("XL") -> 40. A plain left-to-right subtractive
sum is not enough — you must reject malformed numerals. Run node --test until all tests pass.

Use the smallest correct change and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining all stated edge cases:

Implement fromRoman(s) in src/index.js. Parse a Roman numeral string and return its integer
value, or return null if s is NOT a valid Roman numeral. Validity matters: "IIX", "VV",
"IL", and "IIII" are all invalid and must return null. Valid examples: fromRoman("XIV") ->
14, fromRoman("MCMXCIV") -> 1994, fromRoman("XL") -> 40. A plain left-to-right subtractive
sum is not enough — you must reject malformed numerals. Run node --test until all tests pass.

## Automated admission

- Passed: `True`
- Checked: `2026-07-14T18:48:57Z`

## Human decision

- Reviewer: `pending`
- Approved: `False`
