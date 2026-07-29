# Wiki slug naming spec (authoritative)

A slug is the lowercase form of a page name with special characters
transliterated, and every remaining run of non-alphanumeric characters
collapsed to a single hyphen (no leading/trailing hyphens).

## Transliteration table (complete)

| character | slug form |
|---|---|
| à â á | a |
| ä å | a |
| æ | ae |
| ç | c |
| è ê é | e |
| î | i |
| ô ö ø | o |
| û ü | u |
| ñ | n |
| ß | ss |

## Examples

- `Data Pipeline 2.0` → `data-pipeline-2-0`
- `Café Zürich` → `cafe-zurich`
- `Ærøskøbing Ferry` → `aeroskobing-ferry`
- `Überlingen Straße` → `uberlingen-strasse`

Slugs are idempotent: slugifying a slug returns it unchanged.
