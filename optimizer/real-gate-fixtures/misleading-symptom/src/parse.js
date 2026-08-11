// Turns raw ledger text into entry objects.
// See docs/data-contract.md for the field rules and defaults.

const AMOUNT_DEFAULT = 0;
const WEIGHT_DEFAULT = 1;

function numericField(field, fallback) {
  const text = String(field).trim();
  if (text === '') return fallback;
  return Number(text);
}

export function parseEntries(text) {
  const entries = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;

    const parts = line.split('|');
    entries.push({
      label: parts[0].trim(),
      amount: numericField(parts[1], AMOUNT_DEFAULT),
      weight: numericField(parts[2], WEIGHT_DEFAULT),
    });
  }
  return entries;
}
