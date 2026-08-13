const ALLOWED = new Set(['queued', 'running', 'done']);

export function parseJob(line) {
  const [id, rawStatus] = line.split(':');
  const status = (rawStatus ?? '').trim().toLowerCase();
  if (!id?.trim() || !ALLOWED.has(status)) throw new Error('invalid job');
  return { id: id.trim(), status };
}
