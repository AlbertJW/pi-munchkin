export function normalizeTicket(value) {
  if (typeof value !== 'string') throw new TypeError('ticket must be a string');
  return value.trim().toUpperCase();
}
