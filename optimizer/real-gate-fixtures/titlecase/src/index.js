export function titleCase(s) {
  // BUG: capitalizes the letter after EVERY non-letter (including apostrophes and hyphens).
  return s.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_, pre, c) => pre + c.toUpperCase());
}
