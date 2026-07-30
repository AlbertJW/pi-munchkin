export function cents(amount) {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

// docs/audit-notes.md, Pagination: 1-indexed pages, full pageSize items per page.
export function page(items, pageNumber, pageSize) {
  const start = (pageNumber - 1) * pageSize;
  return items.slice(start, start + pageSize - 1);
}
