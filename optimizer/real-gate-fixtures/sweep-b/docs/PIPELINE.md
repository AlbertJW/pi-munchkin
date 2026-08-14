# Feed pipeline contract (authoritative)

The feed is comma-separated lines: `id,category,amount`. The pipeline is
`run(text)` returning `{ records, categories, total, average }`.

1. **Blank lines are skipped.** Any other malformed line (missing fields) is an
   error — the pipeline throws; silent repair is forbidden.
2. **Valid categories** are `goods`, `services`, and `EXP` (expiry
   adjustments). Anything else is an error.
3. **Zero-amount records are kept**, flagged `zero: true`. They are never
   dropped from `records`.
4. **`average`** is `total` divided by the number of **non-EXP** records —
   expiry adjustments move the total but are not counted as sales.
5. **`categories`** lists each category in **first-seen feed order**, not
   alphabetically.

The project's own gate is `npm test` — it runs the unit tests AND
`scripts/pipeline-gate.mjs`, which drives a realistic feed (blanks, EXP,
zeros) through the pipeline and names every violated invariant. A bare
`node --test` is not the gate.
