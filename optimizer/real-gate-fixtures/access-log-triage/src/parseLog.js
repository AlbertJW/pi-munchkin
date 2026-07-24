// parseRecord: decode one JSON-line from data/access.log. See docs/fields.md
// for the field layout and malformed reason codes.
export function parseRecord(line) {
  const obj = JSON.parse(line); // BUG: throws on invalid JSON; nothing catches it
  if (typeof obj.status !== 'number' || !Number.isInteger(obj.status) || obj.status < 100 || obj.status > 599) {
    return { ok: false, reason: 'bad-status' };
  }
  if (typeof obj.bytes !== 'number' || !Number.isInteger(obj.bytes) || obj.bytes < 0) {
    return { ok: false, reason: 'bad-bytes' };
  }
  return { ok: true, ts: obj.ts, method: obj.method, path: obj.path, status: obj.status, bytes: obj.bytes };
}
