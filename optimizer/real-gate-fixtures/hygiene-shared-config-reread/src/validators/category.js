// Mirrors the "category" rule in config/schema.json; keep this list in sync with that file.
const CATEGORIES = ["electronics", "books", "toys", "clothing"];
export function validateCategory(value) {
  return CATEGORIES.includes(value);
}
