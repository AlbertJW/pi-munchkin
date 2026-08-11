import { parseAmount, formatCents } from './money.js';

// Builds the settlement report from a list of entries.
// An entry looks like { id: 'A1', amount: '12.50' } and may carry a `source`.
export function buildReport(entries) {
  const lines = [];
  let total = 0;
  for (const entry of entries) {
    const cents = parseAmount(entry.amount);
    total += cents;
    lines.push(`${entry.id}: ${formatCents(cents)}`);
  }
  return { lines, total };
}
