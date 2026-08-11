// Tolerant parsers for amounts that arrive from external exports.
// These are the supported way to read non-plain amount strings; the strict
// audit parser in money.js must stay strict. See docs/AMOUNTS.md.

export function parseLedgerAmount(raw) {
  if (typeof raw !== 'string') {
    throw new Error(`parseLedgerAmount: expected a string, got ${typeof raw}`);
  }
  let s = raw.trim();
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('$')) s = s.slice(1).trim();
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1).trim();
  }
  s = s.replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw new Error(`parseLedgerAmount: cannot read ${JSON.stringify(raw)}`);
  }
  const cents = Math.round(Number(s) * 100);
  return negative ? -cents : cents;
}
