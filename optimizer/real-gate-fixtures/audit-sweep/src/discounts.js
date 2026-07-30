import { subtotal } from "./pricing.js";
import { taxForLines } from "./tax.js";

// docs/audit-notes.md, Pricing: discount is a percentage applied AFTER tax,
// rounded half-up.
export function totalWithDiscount(lines, discountPct) {
  const sub = subtotal(lines);
  const discounted = Math.round(sub * (1 - discountPct / 100));
  return discounted + taxForLines(lines, discounted / sub);
}
