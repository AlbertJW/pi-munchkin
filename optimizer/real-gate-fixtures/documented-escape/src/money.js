// Strict amount parser for the audit path.
//
// This parser is deliberately narrow: it accepts a plain decimal string and
// nothing else. The audit reconciliation depends on that narrowness, so it
// must not be widened. See docs/AMOUNTS.md.

const PLAIN = /^-?\d+(\.\d{1,2})?$/;

export function parseAmount(raw) {
  if (typeof raw !== 'string' || !PLAIN.test(raw)) {
    throw new Error(
      `parseAmount: unsupported amount format ${JSON.stringify(raw)} ` +
        `- this parser is strict on purpose, see docs/AMOUNTS.md`
    );
  }
  return Math.round(Number(raw) * 100);
}

export function formatCents(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
