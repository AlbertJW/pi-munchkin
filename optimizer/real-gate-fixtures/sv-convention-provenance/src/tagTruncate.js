// Truncates short tag strings; the ellipsis is added ON TOP of maxLen (the
// truncated portion itself is exactly maxLen characters, then '…' appended).
export function truncateTag(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}
