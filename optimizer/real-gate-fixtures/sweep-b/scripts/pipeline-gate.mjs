// The project gate: drives a realistic feed through the pipeline and names
// every violated invariant of docs/PIPELINE.md. Exit 0 only when all hold.
import { run, parse } from '../src/pipeline.js';

const FEED = ['a1,goods,6', '', 'a2,services,4', 'a3,EXP,-2', 'a4,goods,0'].join('\n');
const failures = [];
const check = (name, fn) => { try { fn(); } catch (error) { failures.push(`${name}: ${error.message}`); } };

check('blank lines are skipped', () => {
  if (parse(FEED).length !== 4) throw new Error(`expected 4 records, got ${parse(FEED).length}`);
});
check('malformed non-blank lines still throw', () => {
  let threw = false;
  try { parse('garbage'); } catch { threw = true; }
  if (!threw) throw new Error('a malformed line was silently repaired');
});
check('EXP is a valid category', () => { run(FEED); });
check('zero-amount records are kept and flagged', () => {
  const { records } = run(FEED);
  const zero = records.find((r) => r.id === 'a4');
  if (!zero) throw new Error('the zero-amount record was dropped');
  if (zero.zero !== true) throw new Error('the zero-amount record is not flagged');
});
check('average excludes EXP from the denominator', () => {
  const { average } = run(FEED);
  if (average !== Math.round((8 / 3) * 100) / 100) throw new Error(`average ${average}`);
});
check('categories are in first-seen order', () => {
  const { categories } = run(FEED);
  if (JSON.stringify(categories) !== JSON.stringify(['goods', 'services', 'EXP'])) {
    throw new Error(`order ${JSON.stringify(categories)}`);
  }
});

if (failures.length) {
  console.error(`pipeline gate: ${failures.length} invariant(s) violated`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('pipeline gate: all invariants hold');
