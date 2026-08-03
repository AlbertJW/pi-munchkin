import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeFakePi, fire } from "./integration-harness.ts";

test("did-you-mean: appends hint to ENOENT read error when enabled; silent otherwise", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "dym-int-"));
	mkdirSync(join(cwd, "src"));
	writeFileSync(join(cwd, "src/util.js"), "");
	const errEvent = () => ({
		toolName: "read", toolCallId: "t1", input: { path: "src/utils.js" },
		content: [{ type: "text", text: "ENOENT: no such file or directory, open 'src/utils.js'" }],
		details: {}, isError: true,
	});
	// ADOPTED 2026-08-03: default-on (was dark candidate c24) — unset must register.
	delete process.env.DID_YOU_MEAN;
	let fp = makeFakePi();
	(await import(`../extensions/did-you-mean.ts?x=${Math.random()}`)).default(fp.pi);
	const patched = await fire(fp, "tool_result", errEvent(), { cwd });
	assert.ok(patched, "handler returned a patch (default-on)");
	assert.ok(JSON.stringify(patched.content).includes("closest existing path: src/util.js"));
	// kill switch -> no handler registered
	process.env.DID_YOU_MEAN = "off";
	fp = makeFakePi();
	(await import(`../extensions/did-you-mean.ts?x=${Math.random()}`)).default(fp.pi);
	const untouched = await fire(fp, "tool_result", errEvent(), { cwd });
	assert.equal(untouched, undefined, "DID_YOU_MEAN=off kills it");
});
