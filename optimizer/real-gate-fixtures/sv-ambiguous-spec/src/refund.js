// TODO: refund cents need their own rounding -- the project has two existing
// conventions (see discountCalc.js and taxCalc.js) and this hasn't been
// wired up to either yet.
export function roundRefundCents(cents) {
  throw new Error('roundRefundCents not implemented');
}

// A single line's refund: unit price times quantity, reduced by a percentage
// discount, rounded to the nearest whole cent per roundRefundCents above.
export function computeLineRefund({ unitPriceCents, quantity, discountPercent }) {
  const raw = unitPriceCents * quantity * (1 - discountPercent / 100);
  return roundRefundCents(raw);
}
