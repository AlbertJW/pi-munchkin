import { findItem } from "./db.js";

// docs/audit-notes.md, Money: all arithmetic in integer cents.
export function lineTotal(line) {
  const item = findItem(line.sku);
  if (!item) throw new Error(`unknown sku: ${line.sku}`);
  return (item.priceCents / 100) * line.qty * 100;
}

export function subtotal(lines) {
  let total = 0;
  for (const line of lines) total += lineTotal(line) / 100;
  return total * 100;
}
