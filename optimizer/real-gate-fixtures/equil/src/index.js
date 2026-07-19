export function equilibria(arr) {
  // BUG: skips the endpoints (i=0 and i=n-1), which can be valid equilibria.
  const res = [];
  for (let i = 1; i < arr.length - 1; i++) {
    let left = 0, right = 0;
    for (let j = 0; j < i; j++) left += arr[j];
    for (let j = i + 1; j < arr.length; j++) right += arr[j];
    if (left === right) res.push(i);
  }
  return res;
}
