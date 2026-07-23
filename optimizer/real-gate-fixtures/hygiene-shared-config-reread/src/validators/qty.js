// Mirrors the "qty" rule in config/schema.json; keep these bounds in sync with that file.
export function validateQty(value) {
  if (typeof value !== "number" || !Number.isInteger(value)) return false;
  return value >= 0 && value <= 999;
}
