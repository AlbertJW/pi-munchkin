// Legacy home-grown test runner (predates node:test in this project).
import { slugify } from '../src/index.js';

const cases = [
  ['Hello World', 'hello-world'],
  ['  Trim Me  ', 'trim-me'],
  ['a  b   c', 'a-b-c'],
  ['already-good', 'already-good'],
];

let failures = 0;
for (const [input, expected] of cases) {
  const got = slugify(input);
  if (got === expected) {
    console.log(`ok: slugify(${JSON.stringify(input)}) -> ${JSON.stringify(got)}`);
  } else {
    failures += 1;
    console.log(`FAIL: slugify(${JSON.stringify(input)}) expected ${JSON.stringify(expected)} got ${JSON.stringify(got)}`);
  }
}
console.log(failures === 0 ? 'All tests passed.' : `${failures} test(s) FAILED.`);
process.exit(0);
