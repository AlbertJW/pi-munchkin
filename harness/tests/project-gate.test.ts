import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	clearDetectedProjectGate, detectProjectGate, publishDetectedProjectGate, readDetectedProjectGate,
} from "../lib/project-gate.ts";

async function fixture(): Promise<string> {
	return mkdtemp(join(tmpdir(), "project-gate-"));
}

test("project gate preserves verify-gate detection precedence", async () => {
	const root = await fixture();
	try {
		await writeFile(join(root, "justfile"), "verify:\n\t@true\n");
		await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
		assert.equal(await detectProjectGate(root, undefined), "just verify");
		assert.equal(await detectProjectGate(root, "npm run verify"), "npm run verify");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("project gate fails closed on malformed or inaccessible metadata", async () => {
	const root = await fixture();
	try {
		await writeFile(join(root, "package.json"), "{broken");
		assert.equal(await detectProjectGate(root, undefined), null);
		assert.equal(await detectProjectGate(join(root, "absent"), undefined), null);
		await mkdir(join(root, "nested"));
		await writeFile(join(root, "nested", "tsconfig.json"), "{}");
		assert.equal(await detectProjectGate(join(root, "nested"), undefined), "tsc --noEmit");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("shared gate cache binds to a cwd hash and retains no cwd", () => {
	const privateCwd = "/private/example/project";
	try {
		publishDetectedProjectGate(privateCwd, "npm test");
		assert.deepEqual(readDetectedProjectGate(privateCwd), { found: true, command: "npm test" });
		assert.deepEqual(readDetectedProjectGate("/different/project"), { found: false });
		const encoded = JSON.stringify((globalThis as Record<string, unknown>).__pi_detected_project_gate_v1);
		assert.equal(encoded.includes(privateCwd), false);
		clearDetectedProjectGate();
		assert.deepEqual(readDetectedProjectGate(privateCwd), { found: false });
	} finally {
		clearDetectedProjectGate();
	}
});
