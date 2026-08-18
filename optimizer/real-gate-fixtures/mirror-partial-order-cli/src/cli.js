import { readFileSync } from 'node:fs';
import { scheduleJobs } from './schedule.js';

try {
  const jobs = JSON.parse(readFileSync(0, 'utf8'));
  process.stdout.write(`${JSON.stringify(scheduleJobs(jobs))}\n`);
} catch {
  process.stderr.write('invalid graph\n');
  process.exitCode = 1;
}
