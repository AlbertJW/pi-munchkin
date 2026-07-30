import { findItem, taxRates } from "./db.js";

// Per-category tax in cents (docs/audit-notes.md, Pricing), rounded half-up
// per line-category bucket.
export function taxForLines(lines, scale = 1) {
  const rates = taxRates();
  const byCategory = new Map();
  for (const line of lines) {
    const item = findItem(line.sku);
    const cents = Math.round(item.priceCents * line.qty * scale);
    byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + cents);
  }
  let tax = 0;
  for (const [category, cents] of byCategory) {
    tax += Math.round(cents * (rates[category] ?? 0));
  }
  return tax;
}
