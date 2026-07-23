// parseLedger: turn raw ledger lines (JSON-encoded transaction records) into
// validated entries. Each line should decode to { id, amount, currency }.
// Malformed lines must be reported in `errors`, never silently dropped.
export function parseLedger(lines) {
  const VALID_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'JPY']);
  const ok = [];
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // BUG: JSON.parse is not guarded -- a malformed line throws and aborts
    // the whole batch instead of being reported as a per-line error.
    const obj = JSON.parse(raw);
    if (obj === null || typeof obj !== 'object' || typeof obj.id !== 'string' || obj.id.length === 0) {
      errors.push({ index: i, line: raw, reason: 'missing-field' });
      continue;
    }
    if (typeof obj.amount !== 'number' || !Number.isFinite(obj.amount)) {
      errors.push({ index: i, line: raw, reason: 'bad-amount' });
      continue;
    }
    if (!VALID_CURRENCIES.has(obj.currency)) {
      errors.push({ index: i, line: raw, reason: 'bad-currency' });
      continue;
    }
    ok.push({ id: obj.id, amount: Math.round(obj.amount * 100) / 100, currency: obj.currency });
  }
  return { ok, errors };
}
