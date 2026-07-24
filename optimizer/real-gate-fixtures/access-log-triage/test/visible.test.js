import { parseRecord } from '../src/parseLog.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('valid line decodes with all fields', () => {
  const r = parseRecord('{"ts":"t","method":"GET","path":"/x","status":200,"bytes":512}');
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
});
test('status out of range is bad-status', () => {
  const r = parseRecord('{"ts":"t","method":"GET","path":"/x","status":999,"bytes":10}');
  assert.deepEqual(r, { ok: false, reason: 'bad-status' });
});
test('negative bytes is bad-bytes', () => {
  const r = parseRecord('{"ts":"t","method":"GET","path":"/x","status":200,"bytes":-5}');
  assert.deepEqual(r, { ok: false, reason: 'bad-bytes' });
});
test('non-integer status is bad-status', () => {
  const r = parseRecord('{"ts":"t","method":"GET","path":"/x","status":"200","bytes":10}');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad-status');
});
