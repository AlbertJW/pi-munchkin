import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import registerContextInletGuard from "../extensions/context-inlet-guard.ts";
import {
	isPositiveNumber, LARGE_FILE_BYTES, limitBypassesInletGate, limitBypassesRiskyGate,
	resolveReadPath, RISKY_MAX_LIMIT,
} from "../lib/context-inlet.ts";
import { fire, makeFakePi } from "./integration-harness.ts";

test("resolveReadPath resolves relatives against active cwd", () => {
	assert.equal(resolveReadPath("/tmp/project", "src/file.ts"), resolve("/tmp/project/src/file.ts"));
});

test("resolveReadPath preserves absolute paths", () => {
	assert.equal(resolveReadPath("/tmp/project", "/var/log/app.log"), "/var/log/app.log");
});

test("isPositiveNumber treats only positive finite numbers as bounded", () => {
	assert.equal(isPositiveNumber(1), true);
	assert.equal(isPositiveNumber(0), false);
	assert.equal(isPositiveNumber(Number.NaN), false);
	assert.equal(isPositiveNumber("10"), false);
});

test("limitBypassesRiskyGate flags only huge limits on risky files", () => {
	assert.equal(limitBypassesRiskyGate(999999, true), true, "huge limit on risky file must not bypass the gate");
	assert.equal(limitBypassesRiskyGate(RISKY_MAX_LIMIT, true), false, "page-sized limit on risky file is fine");
	assert.equal(limitBypassesRiskyGate(999999, false), false, "normal files keep the old behavior");
	assert.equal(limitBypassesRiskyGate(undefined, true), false, "no limit -> handled by the unbounded path");
	assert.equal(limitBypassesRiskyGate(Number.NaN, true), false);
});

test("limitBypassesInletGate caps large normal-file pages too", () => {
	assert.equal(limitBypassesInletGate(RISKY_MAX_LIMIT), false);
	assert.equal(limitBypassesInletGate(RISKY_MAX_LIMIT + 1), true);
	assert.equal(limitBypassesInletGate(undefined), false);
});

test("large reads require bounded pages before their contents enter context", async () => {
	const root = await mkdtemp(join(tmpdir(), "context-inlet-"));
	const large = join(root, "large.md");
	const small = join(root, "small.md");
	const priorTelemetry = process.env.TELEMETRY;
	process.env.TELEMETRY = "off";
	try {
		// Fixed at the measured defect class. Do not derive this from the production
		// threshold: doing so made the 64 KiB counterfactual pass vacuously.
		await writeFile(large, "x".repeat(40 * 1024));
		await writeFile(small, "x".repeat(1024));
		const fp = makeFakePi();
		registerContextInletGuard(fp.pi as never);
		await fire(fp, "session_start", { reason: "new" }, { cwd: root });

		const unbounded = await fire(fp, "tool_call", {
			toolName: "read", input: { path: "large.md" },
		}, { cwd: root });
		assert.equal(unbounded?.block, true, "a 32 KiB+ unbounded read must be refused");

		const paged = await fire(fp, "tool_call", {
			toolName: "read", input: { path: "large.md", limit: RISKY_MAX_LIMIT },
		}, { cwd: root });
		assert.equal(paged, undefined, "a bounded page remains available");

		const oversizedPage = await fire(fp, "tool_call", {
			toolName: "read", input: { path: "large.md", limit: RISKY_MAX_LIMIT + 1 },
		}, { cwd: root });
		assert.equal(oversizedPage?.block, true, "a nominal but oversized page must not bypass the guard");

		const smallRead = await fire(fp, "tool_call", {
			toolName: "read", input: { path: "small.md" },
		}, { cwd: root });
		assert.equal(smallRead, undefined, "small files retain the existing direct-read path");
	} finally {
		if (priorTelemetry === undefined) delete process.env.TELEMETRY;
		else process.env.TELEMETRY = priorTelemetry;
		await rm(root, { recursive: true, force: true });
	}
});
