// Discount-cent rounding: exact .5 ties round up (away from zero). Used
// throughout the discount-application pipeline (src/discountCalc.js callers).
export function roundDiscountCentsUp(cents) {
  return Math.floor(cents + 0.5);
}
