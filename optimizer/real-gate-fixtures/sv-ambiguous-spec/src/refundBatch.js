import { computeLineRefund } from './refund.js';

// Sums computeLineRefund across a batch of order lines for a single refund
// summary -- used by the order-refund endpoint to report one total instead
// of per-line amounts.
export function summarizeBatchRefund(lines) {
  let totalCents = 0;
  for (const line of lines) {
    totalCents += computeLineRefund(line);
  }
  return { totalCents, count: lines.length };
}
