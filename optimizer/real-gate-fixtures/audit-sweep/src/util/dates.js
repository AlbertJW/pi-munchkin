// docs/audit-notes.md, Reports: group by full calendar date (YYYY-MM-DD, UTC).
export function dayKey(date) {
  return String(date.getUTCDate());
}
