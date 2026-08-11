# Amount formats

## The strict parser (`src/money.js`)

`parseAmount(raw)` accepts a plain decimal string only: `"12"`, `"12.5"`,
`"12.50"`, `"-3.75"`. Everything else throws.

This is intentional and it is load-bearing. The audit reconciliation treats a
throw from `parseAmount` as "this row did not come from our own ledger", so
widening the accepted set silently breaks reconciliation. **Do not relax
`parseAmount` to make an external format go through it.** If a value is
rejected, the value is in a different dialect and belongs in a different
parser.

## External dialects (`src/dialects.js`)

Amounts coming from outside systems are normalised by the parsers in
`src/dialects.js`, which return integer cents just like `parseAmount` does.

### Ledger export dialect

`parseLedgerAmount(raw)` reads the accounting-style format used by ledger
exports:

| Input          | Result (cents) |
| -------------- | -------------- |
| `"1,234.50"`   | `123450`       |
| `"$1,200.00"`  | `120000`       |
| `"(89.99)"`    | `-8999`        |
| `"($1,000)"`   | `-100000`      |
| `"-42.00"`     | `-4200`        |

Two things routinely catch people out:

1. **Surrounding parentheses mean the amount is negative.** This is the
   accounting convention; a value wrapped in `(...)` is a credit. Stripping
   punctuation and calling `Number()` gets the magnitude right and the sign
   wrong, which is worse than failing.
2. Thousands separators and a leading `$` are cosmetic and are removed.

Anything the dialect parser cannot read still throws, so bad data is not
silently turned into `0`.
