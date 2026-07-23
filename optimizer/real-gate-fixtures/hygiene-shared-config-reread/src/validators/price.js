// Mirrors the "price" rule in config/schema.json; keep this bound in sync with that file.
export function validatePrice(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return false;
  return value >= 0;
}
