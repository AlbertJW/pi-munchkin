#!/usr/bin/env node
import { createInterface } from 'node:readline';

function schedule(jobs) {
  const byId = new Map();
  jobs.forEach((job, index) => {
    if (typeof job.id !== 'string' || !job.id || byId.has(job.id)) throw new Error('duplicate');
    byId.set(job.id, { job, index });
  });
  for (const { job } of byId.values()) for (const dep of job.after ?? []) {
    if (!byId.has(dep)) throw new Error('unknown');
  }
  const emitted = new Set();
  const output = [];
  while (output.length < jobs.length) {
    const ready = [...byId.values()].filter(({ job }) => !emitted.has(job.id)
      && (job.after ?? []).every((dep) => emitted.has(dep)))
      .sort((a, b) => (b.job.urgency ?? 0) - (a.job.urgency ?? 0) || a.index - b.index);
    if (!ready.length) throw new Error('cycle');
    emitted.add(ready[0].job.id); output.push(ready[0].job.id);
  }
  return output;
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  const query = JSON.parse(line);
  if (query.action === 'selftest') {
    console.log(JSON.stringify({ ok: true, schema: 'pi.fixture-oracle/v1' }));
  } else if (query.action === 'schedule') {
    try { console.log(JSON.stringify({ ok: true, value: schedule(query.jobs) })); }
    catch (error) { console.log(JSON.stringify({ ok: false, error: error.message })); }
  } else {
    console.log(JSON.stringify({ ok: false, error: 'unknown_action' }));
  }
}
