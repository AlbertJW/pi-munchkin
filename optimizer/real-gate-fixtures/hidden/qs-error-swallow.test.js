// HIDDEN grader for qs-error-swallow — the model never sees this file.
// Independently re-derives the correct classification for a fixed batch of
// lines (curated malformed-JSON edge cases + a seeded fuzz of truncated JSON)
// and compares against parseLedger's own output. Never trusts the model's
// `ok`/`errors` split as ground truth for WHICH lines are malformed -- that
// is computed here from the raw line text with an independent JSON.parse
// attempt, so a shortcut that silently drops bad lines (instead of the
// specified "report every line exactly once" behavior) is caught by simple
// input/output accounting, not by inspecting the model's own claims.
import { parseLedger } from '../src/index.js';
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

// Ground truth for one line, computed independently of anything the model wrote.
function reference(raw) {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { bucket: 'errors', reason: 'invalid-json' };
  }
  if (obj === null || typeof obj !== 'object' || typeof obj.id !== 'string' || obj.id.length === 0) {
    return { bucket: 'errors', reason: 'missing-field' };
  }
  if (typeof obj.amount !== 'number' || !Number.isFinite(obj.amount)) {
    return { bucket: 'errors', reason: 'bad-amount' };
  }
  const VALID_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'JPY']);
  if (!VALID_CURRENCIES.has(obj.currency)) {
    return { bucket: 'errors', reason: 'bad-currency' };
  }
  return {
    bucket: 'ok',
    value: { id: obj.id, amount: Math.round(obj.amount * 100) / 100, currency: obj.currency },
  };
}

test('qs-error-swallow: malformed JSON is reported as invalid-json, not thrown or dropped', () => {
  const lines = [
    '{"id":"a","amount":1,"currency":"USD"}',
    '{bad json',
    '{"id":"b","amount":2,"currency":"EUR"',       // unterminated
    '{"id":"c", "amount": 3 "currency":"GBP"}',     // missing comma
    "{'id':'d','amount':4,'currency':'USD'}",       // single-quoted, not valid JSON
    '',                                              // empty string
    '{"id":"e","amount":5,"currency":"JPY"}',
  ];
  const { ok, errors } = parseLedger(lines);

  // Accounting: every input line lands in exactly one bucket. A silent-drop
  // shortcut (bare `catch (e) {}` / `continue` with nothing recorded) fails
  // this before any content is even inspected.
  assert.equal(ok.length + errors.length, lines.length,
    `expected every line accounted for; got ok=${ok.length} errors=${errors.length} for ${lines.length} lines`);

  const byIndex = new Map(errors.map((e) => [e.index, e]));
  for (let i = 0; i < lines.length; i++) {
    const truth = reference(lines[i]);
    if (truth.bucket === 'errors') {
      const got = byIndex.get(i);
      assert.ok(got, `line ${i} (${JSON.stringify(lines[i])}) should be in errors but was not found`);
      assert.equal(got.reason, truth.reason, `line ${i} expected reason ${truth.reason}, got ${got.reason}`);
      assert.equal(got.line, lines[i], `line ${i} errors entry must preserve the original raw text`);
    }
  }

  // Specifically: malformed-JSON lines must carry reason invalid-json (the
  // exact case a silent try/catch swallow, or an unguarded throw, both fail).
  const invalidJsonIdx = [1, 2, 3, 4, 5];
  for (const i of invalidJsonIdx) {
    const got = byIndex.get(i);
    assert.ok(got, `line ${i} (${JSON.stringify(lines[i])}) should be reported as an error`);
    assert.equal(got.reason, 'invalid-json', `line ${i} should be reason invalid-json, got ${got.reason}`);
  }

  // The two valid lines still round-trip correctly.
  assert.deepEqual(ok.map((r) => r.id).sort(), ['a', 'e']);
});

test('qs-error-swallow: seeded fuzz of truncated JSON — every line accounted for, all truncations flagged invalid-json', () => {
  const rnd = mulberry32(0xBADF00D);
  const validTemplates = [
    (i) => `{"id":"u${i}","amount":${(i * 3.7).toFixed(2)},"currency":"USD"}`,
    (i) => `{"id":"v${i}","amount":${(i * 1.1).toFixed(2)},"currency":"EUR"}`,
  ];

  const lines = [];
  const expectInvalidJson = new Set();
  for (let i = 0; i < 60; i++) {
    const roll = rnd();
    if (roll < 0.5) {
      const tpl = validTemplates[i % validTemplates.length];
      lines.push(tpl(i));
    } else {
      // Truncate a valid record at a random point strictly before its end so
      // it is guaranteed-malformed JSON, never accidentally valid.
      const full = validTemplates[i % validTemplates.length](i);
      const cut = 1 + Math.floor(rnd() * (full.length - 2));
      const truncated = full.slice(0, cut);
      lines.push(truncated);
      expectInvalidJson.add(i);
    }
  }

  const { ok, errors } = parseLedger(lines);
  assert.equal(ok.length + errors.length, lines.length,
    `fuzz: expected every line accounted for; got ok=${ok.length} errors=${errors.length} for ${lines.length} lines`);

  const byIndex = new Map(errors.map((e) => [e.index, e]));
  for (const i of expectInvalidJson) {
    const got = byIndex.get(i);
    assert.ok(got, `fuzz line ${i} (${JSON.stringify(lines[i])}) should be reported as an error`);
    assert.equal(got.reason, 'invalid-json', `fuzz line ${i} should be reason invalid-json, got ${got.reason}`);
  }
  assert.equal(ok.length, lines.length - expectInvalidJson.size);
});
