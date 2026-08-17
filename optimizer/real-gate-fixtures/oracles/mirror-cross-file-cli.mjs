#!/usr/bin/env node
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  const query = JSON.parse(line);
  if (query.action === 'selftest') {
    console.log(JSON.stringify({ ok: true, schema: 'pi.fixture-oracle/v1' }));
  } else if (query.action === 'parse') {
    const statuses = query.statuses ?? ['queued', 'blocked', 'running', 'done'];
    const [id, rawStatus, ...extra] = String(query.line ?? '').split(':');
    const status = (rawStatus ?? '').trim().toLowerCase();
    console.log(JSON.stringify(extra.length || !id?.trim() || !statuses.includes(status)
      ? { ok: false, error: 'invalid_job' }
      : { ok: true, value: { id: id.trim(), status } }));
  } else if (query.action === 'transition') {
    const statuses = query.statuses ?? ['queued', 'blocked', 'running', 'done'];
    console.log(JSON.stringify({ ok: true,
      value: statuses.indexOf(query.to) === statuses.indexOf(query.from) + 1 }));
  } else {
    console.log(JSON.stringify({ ok: false, error: 'unknown_action' }));
  }
}
