// Is the bracket string balanced? (correct — do not need to touch for h3)
export function isBalanced(s) {
  let d = 0;
  for (const c of s) {
    if (c === '[') d++;
    else if (c === ']') { d--; if (d < 0) return false; }
  }
  return d === 0;
}
