export function firstUnmatched(s) {
  // BUG: for an unclosed '(', returns the LAST open index, not the first.
  let depth = 0, lastOpen = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') { depth++; lastOpen = i; }
    else if (s[i] === ')') { if (depth === 0) return i; depth--; }
  }
  return depth > 0 ? lastOpen : s.length;
}
