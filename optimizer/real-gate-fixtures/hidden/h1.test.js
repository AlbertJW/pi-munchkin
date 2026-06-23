// HIDDEN grader for h1 — the model never sees this. Differential/property test:
// round-trip random rows through the model's toCSV and a REFERENCE RFC-4180 parser,
// asserting parse(toCSV(rows)) === rows. Format-agnostic (any valid CSV that parses
// back is accepted) and un-gameable (the model can't see these cases). Seeded ->
// deterministic, reproducible verdict.
import { toCSV } from '../src/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// RFC-4180-strict reference parser: respects quotes across commas AND newlines,
// doubles-quote unescaping, NO trimming (so escaping must be exact to round-trip).
function refParse(text) {
  const records = []; let field = '', rec = [], inQ = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { rec.push(field); field = ''; i++; continue; }
    if (c === '\n') { rec.push(field); records.push(rec); field = ''; rec = []; i++; continue; }
    field += c; i++;
  }
  rec.push(field); records.push(rec);
  return records;
}
function rowsFromCSV(text) {
  const recs = refParse(text); const headers = recs[0];
  return recs.slice(1).map((r) => { const o = {}; headers.forEach((h, j) => { o[h] = r[j] ?? ''; }); return o; });
}

const KEYS = ['name', 'note', 'city', 'qty'];
const VCHARS = ['a', 'B', '7', ' ', ',', '"', '\n', 'é', '日', ''];

function randValue(rnd) {
  const n = Math.floor(rnd() * 6); let s = '';
  for (let i = 0; i < n; i++) s += VCHARS[Math.floor(rnd() * VCHARS.length)];
  return s;
}

test('h1: toCSV round-trips arbitrary rows through an RFC-4180 parser (seeded fuzz)', () => {
  const rnd = mulberry32(0xC0FFEE);
  for (let trial = 0; trial < 200; trial++) {
    const nk = 1 + Math.floor(rnd() * 3);
    const keys = KEYS.slice(0, nk);
    const nrows = Math.floor(rnd() * 4);
    const rows = [];
    for (let r = 0; r < nrows; r++) {
      const row = {};
      for (const k of keys) row[k] = randValue(rnd);
      rows.push(row);
    }
    if (rows.length === 0) { assert.strictEqual(toCSV(rows), ''); continue; }
    const back = rowsFromCSV(toCSV(rows));
    assert.deepStrictEqual(back, rows, `round-trip failed for rows=${JSON.stringify(rows)}`);
  }
});
