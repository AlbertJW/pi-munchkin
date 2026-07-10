// Fail-to-Pass grader for t2 — run from the task workdir after `node --test`.
//
// t2's fixture PASSES on an untouched checkout (its own tests assert the old
// behavior), so `node --test` alone scores a no-op as success and scores real
// work as failure whenever the model breaks a stale assertion. This grader is
// the F2P half: it asserts the behavior t2 actually asks for. Copied in from
// $FIXTURES at grading time, so the model can't tamper with it.
import assert from "node:assert/strict";

const { parseCSV, csvToJson } = await import(`file://${process.cwd()}/src/index.js`);

// 1) blank lines skipped ANYWHERE, not just at the ends (`csv.trim()` only does the ends)
assert.equal(parseCSV("a,b\n1,2\n\n3,4\n").length, 2, "parseCSV must skip interior blank lines");

// 2) 4-space indent. Exact-string, not an indent regex: under 2-space indent an object key
// nested in an array already sits at 4 spaces, so /\n {4}"a"/ would false-pass.
const d = [{ a: "1" }];
assert.equal(csvToJson(d), JSON.stringify(d, null, 4), "csvToJson must use 4-space indentation");
