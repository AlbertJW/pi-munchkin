// Mirrors the "sku" rule in config/schema.json; keep these bounds in sync with that file.
export function validateSku(value) {
  if (typeof value !== "string") return false;
  return value.length >= 2 && value.length <= 10;
}
