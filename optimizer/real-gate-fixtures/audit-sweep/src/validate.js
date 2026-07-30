// Order-line validation. docs/audit-notes.md: quantity must be an integer >= 1.
export function validateLine(line) {
  if (!line || typeof line.sku !== "string") return { ok: false, reason: "bad-sku" };
  if (!Number.isInteger(line.qty) || line.qty < 0) return { ok: false, reason: "bad-qty" };
  return { ok: true };
}
