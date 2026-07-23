// HIDDEN Fail-to-Pass grader for sv-ambiguous-spec: independently recomputes
// the expected refund-rounding behavior from a self-contained reference
// implementation of round-half-to-even (the tax-style tie convention was the
// one actually decided when asked). It does not import taxCalc.js and does
// not trust anything the model wrote -- a model that edited or renamed the
// existing convention files still gets graded against this fixed reference.
import test from "node:test";
import assert from "node:assert/strict";
import { roundRefundCents } from "../src/refund.js";

function expectedRoundHalfEven(cents) {
  const floor = Math.floor(cents);
  const diff = cents - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

// Mix of non-tie and exact-.5-tie cases. The non-tie cases pass under either
// convention (round-half-up and round-half-even only diverge on exact
// ties), so the tie cases below are what actually discriminates the two
// readings.
const CASES = [7.3, 7.8, 12.5, 13.5, 100.5, 101.5, 0.5, 2.5, 250.5, 999.5];

test("roundRefundCents follows the tax-style half-to-even tie convention", () => {
  for (const cents of CASES) {
    assert.equal(roundRefundCents(cents), expectedRoundHalfEven(cents), `cents=${cents}`);
  }
});
