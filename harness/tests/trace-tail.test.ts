import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tailLines } from "../extensions/plan-runner.ts";

test("plan trace tail reads the bounded suffix of a multi-megabyte trace", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "trace-tail-"));
	const path = join(cwd, "trace.jsonl");
	writeFileSync(path, `${"discarded-prefix\n".repeat(160_000)}{"n":1}\nmalformed\n{"n":2}\n`);
	assert.deepEqual(await tailLines(path, 3), ['{"n":1}', "malformed", '{"n":2}']);
});
