// Maximum nesting depth of '[' ']' in the string.
export function maxDepth(s) {
  let depth = 0, max = 0;
  for (const c of s) {
    if (c === '[') { depth++; if (depth + 1 > max) max = depth + 1; }
    else if (c === ']') depth--;
  }
  return max;
}
