import { parseRecord } from './parseLog.js';

// TODO: build the access-log report. See docs/fields.md for the malformed
// reason codes -- malformed counts must be broken out per code, and every
// input line must land in exactly one place (ok or malformed).
export function summarizeAccessLog(lines) {
  throw new Error('summarizeAccessLog not implemented');
}
