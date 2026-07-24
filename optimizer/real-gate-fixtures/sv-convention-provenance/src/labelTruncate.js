// Truncates display labels; the ellipsis counts toward maxLen (the total
// length, including '…', never exceeds maxLen).
export function truncateLabel(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}
