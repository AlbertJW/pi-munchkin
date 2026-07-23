// Tax-cent rounding: exact .5 ties round to even (banker's rounding). Used
// throughout the tax pipeline (src/taxCalc.js callers).
export function roundTaxCentsEven(cents) {
  const floor = Math.floor(cents);
  const diff = cents - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}
