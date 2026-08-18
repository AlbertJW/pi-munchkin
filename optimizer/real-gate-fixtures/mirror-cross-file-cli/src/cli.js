import { readFileSync } from 'node:fs';
import { parseJob } from './parse-job.js';

try {
  const rows = readFileSync(0, 'utf8').split(/\r?\n/).filter((line) => line.trim()).map(parseJob);
  process.stdout.write(`${JSON.stringify(rows)}\n`);
} catch {
  process.stderr.write('invalid input\n');
  process.exitCode = 1;
}
