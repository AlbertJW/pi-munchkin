const V = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

export function fromRoman(s) {
  // BUG: left-to-right subtractive sum with NO validation — accepts malformed numerals.
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = V[s[i]], next = V[s[i + 1]];
    if (next && cur < next) total -= cur; else total += cur;
  }
  return total;
}
