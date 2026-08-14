# Report format (authoritative)

Every stock report row is `NAME QTY AMOUNT`, and the report ends with a
`TOTAL` line. The conventions below are the contract; the code follows them,
not the other way around.

1. **Money.** Amounts always carry two decimals AND thousands separators:
   `1,204.50`, never `1204.50`.
2. **Out of stock.** A quantity of zero is rendered as the marker `OUT`
   (right-aligned in the usual 5-character quantity column), never as `0`.
3. **Rates live in `src/config.js`.** The currency rate, discount rate and
   handling fee are defined once, in `settings`. No other module may restate
   their values.
4. **Row order.** Rows are sorted alphabetically by item name, whatever order
   the feed delivered them in.
5. **Charge order.** For a discounted item: convert to the billing currency,
   apply the discount to the goods value, and only then add the per-line
   handling fee. The fee is never discounted.
6. **The TOTAL line.** Sums the line totals of active items only — out-of-stock
   rows appear in the body but never contribute to TOTAL (their handling fee is
   not charged).
