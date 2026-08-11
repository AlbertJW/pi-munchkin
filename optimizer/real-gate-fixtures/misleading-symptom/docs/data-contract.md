# Ledger line contract

`parseEntries(text)` in `src/parse.js` turns raw ledger text into entry objects.
`src/report.js` is a pure consumer of those objects and trusts this contract.

## Input format

One entry per line, fields separated by `|`:

```
label | amount | weight
```

* Blank lines and lines whose first non-space character is `#` are skipped.
* Every field is trimmed before it is interpreted.
* **Trailing fields may be omitted.** `alpha|2` and `alpha` are legal lines.
* An omitted field and a present-but-empty field mean exactly the same thing:
  the field takes its default. `alpha|2|` and `alpha|2` are equivalent.
* When a numeric field is present and non-empty it is guaranteed to be valid
  numeric text; producers never emit garbage such as `abc`.

## Defaults

| field    | default |
| -------- | ------- |
| `amount` | `0`     |
| `weight` | `1`     |

## Guarantee to consumers

Every object returned by `parseEntries` has:

* `label` — a trimmed string,
* `amount` — a finite `number`,
* `weight` — a finite `number`.

Consumers may rely on this and must not re-validate or re-default these fields.
