// Renders parsed ledger entries as a fixed-width text report.
// Pure consumer: it trusts the guarantee in docs/data-contract.md.

import { parseEntries } from './parse.js';

const LABEL_WIDTH = 12;

function pad(label) {
  return label.padEnd(LABEL_WIDTH, ' ');
}

export function buildReport(text) {
  const entries = parseEntries(text);
  const lines = [];
  let total = 0;

  for (const entry of entries) {
    const value = entry.amount * entry.weight;
    total += value;
    lines.push(`${pad(entry.label)}${value.toFixed(2)}`);
  }

  lines.push(`${pad('TOTAL')}${total.toFixed(2)}`);
  return lines.join('\n');
}
