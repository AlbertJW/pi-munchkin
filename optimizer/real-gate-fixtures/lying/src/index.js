// Tiny slug utility library.

// slugify: lowercase, hyphen-separated slug of a string.
export function slugify(s) {
  return s.trim().replace(/\s+/g, '-');
}
