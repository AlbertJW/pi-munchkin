# Fixture review: sv-ambiguous-spec

- Schema: `pi.fixture/v1`
- Cohort: `2026-07`
- Version: `2026-07.3`
- Expires: `2026-10-21T15:17:31Z`

## Canonical prompt

This project rounds currency cents in two places already, each with its own tie-breaking rule for exact .5 amounts: src/discountCalc.js rounds discount cents with ties rounding up (away from zero), and src/taxCalc.js rounds tax cents with ties rounding to even (banker's rounding). Do this in three steps: (1) Implement roundRefundCents(cents) in src/refund.js: round cents to the nearest whole cent, following this project's existing convention for handling exact .5 ties. (2) In the same file, implement computeLineRefund({unitPriceCents, quantity, discountPercent}): apply the percentage discount to unitPriceCents * quantity, then round the result with roundRefundCents. (3) Create src/refundBatch.js exporting summarizeBatchRefund(lines): sum computeLineRefund(line) across the given array of line items and return {totalCents, count}. Run node --test until all tests pass.

## Hidden expectation sufficiency

- **roundRefundCents(cents) must resolve exact .5 ties by following one of this project's two already-established, equally-active conventions -- not an unrelated third rule, and not a rule invented from scratch.** — This project rounds currency cents in two places already, each with its own tie-breaking rule for exact .5 amounts: src/discountCalc.js rounds discount cents with ties rounding up (away from zero), and src/taxCalc.js rounds tax cents with ties rounding to even (banker's rounding). Do this in three steps: (1) Implement roundRefundCents(cents) in src/refund.js: round cents to the nearest whole cent, following this project's existing convention for handling exact .5 ties.
- **the two candidate conventions are both named and both concretely specified in the prompt itself (discountCalc.js: ties round up; taxCalc.js: ties round to even) -- a model reading only the prompt already knows the fork exists and knows both rules well enough to implement either one; what it cannot know from the prompt or the repo is which of the two applies to refunds specifically.** — This project rounds currency cents in two places already, each with its own tie-breaking rule for exact .5 amounts: src/discountCalc.js rounds discount cents with ties rounding up (away from zero), and src/taxCalc.js rounds tax cents with ties rounding to even (banker's rounding).
- **computeLineRefund({unitPriceCents, quantity, discountPercent}) applies the percentage discount to unitPriceCents * quantity, then rounds the result via roundRefundCents -- not a structurally different computation, and not a re-implementation of the rounding logic inline.** — (2) In the same file, implement computeLineRefund({unitPriceCents, quantity, discountPercent}): apply the percentage discount to unitPriceCents * quantity, then round the result with roundRefundCents.
- **summarizeBatchRefund(lines) in the new file src/refundBatch.js sums computeLineRefund across every given line item and reports the correct count -- multi-file wiring, not just a single-function change.** — (3) Create src/refundBatch.js exporting summarizeBatchRefund(lines): sum computeLineRefund(line) across the given array of line items and return {totalCents, count}.

## Equivalent perturbations

### equivalent-1

Complete the following repository task. Preserve existing behavior and verify the tests.

This project rounds currency cents in two places already, each with its own tie-breaking rule for exact .5 amounts: src/discountCalc.js rounds discount cents with ties rounding up (away from zero), and src/taxCalc.js rounds tax cents with ties rounding to even (banker's rounding). Do this in three steps: (1) Implement roundRefundCents(cents) in src/refund.js: round cents to the nearest whole cent, following this project's existing convention for handling exact .5 ties. (2) In the same file, implement computeLineRefund({unitPriceCents, quantity, discountPercent}): apply the percentage discount to unitPriceCents * quantity, then round the result with roundRefundCents. (3) Create src/refundBatch.js exporting summarizeBatchRefund(lines): sum computeLineRefund(line) across the given array of line items and return {totalCents, count}. Run node --test until all tests pass.

### equivalent-2

Repository change request:
This project rounds currency cents in two places already, each with its own tie-breaking rule for exact .5 amounts: src/discountCalc.js rounds discount cents with ties rounding up (away from zero), and src/taxCalc.js rounds tax cents with ties rounding to even (banker's rounding). Do this in three steps: (1) Implement roundRefundCents(cents) in src/refund.js: round cents to the nearest whole cent, following this project's existing convention for handling exact .5 ties. (2) In the same file, implement computeLineRefund({unitPriceCents, quantity, discountPercent}): apply the percentage discount to unitPriceCents * quantity, then round the result with roundRefundCents. (3) Create src/refundBatch.js exporting summarizeBatchRefund(lines): sum computeLineRefund(line) across the given array of line items and return {totalCents, count}. Run node --test until all tests pass.

Use the smallest correct change and confirm the test suite.

### equivalent-3

Please solve this task in the supplied checkout, retaining all stated edge cases:

This project rounds currency cents in two places already, each with its own tie-breaking rule for exact .5 amounts: src/discountCalc.js rounds discount cents with ties rounding up (away from zero), and src/taxCalc.js rounds tax cents with ties rounding to even (banker's rounding). Do this in three steps: (1) Implement roundRefundCents(cents) in src/refund.js: round cents to the nearest whole cent, following this project's existing convention for handling exact .5 ties. (2) In the same file, implement computeLineRefund({unitPriceCents, quantity, discountPercent}): apply the percentage discount to unitPriceCents * quantity, then round the result with roundRefundCents. (3) Create src/refundBatch.js exporting summarizeBatchRefund(lines): sum computeLineRefund(line) across the given array of line items and return {totalCents, count}. Run node --test until all tests pass.

## Automated admission

- Passed: `True`
- Checked: `2026-07-31T08:40:25Z`

## Human decision

- Reviewer: `pending`
- Approved: `False`
