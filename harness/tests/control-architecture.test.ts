import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(import.meta.dirname, "..");

test("telemetry taps are absent and control libraries cannot import the telemetry sink", () => {
	const telemetry = readFileSync(join(root, "lib", "telemetry.ts"), "utf8");
	const blackboard = readFileSync(join(root, "extensions", "session-blackboard.ts"), "utf8");
	const activation = readFileSync(join(root, "extensions", "tool-activation.ts"), "utf8");
	assert.equal([telemetry, blackboard, activation].some((text) => text.includes("__pi_telemetry_taps")), false);
	for (const file of ["control-proposal.ts", "control-arbiter.ts"]) {
		const source = readFileSync(join(root, "lib", file), "utf8");
		assert.equal(/from\s+["'][^"']*telemetry/.test(source), false, `${file} must not depend on telemetry`);
	}
});

test("typed domain signals reject extra or raw-looking fields", async () => {
	const { isHarnessSignal, signalRunId } = await import("../lib/harness-signals.ts");
	const valid = { v: 1 as const, type: "plan/write" as const, runIdHash: signalRunId("r"), items: 2, openItems: 2 };
	assert.equal(isHarnessSignal(valid), true);
	assert.equal(isHarnessSignal({ ...valid, command: "private" }), false);
	assert.equal(isHarnessSignal({ v: 1, type: "context/compacted", path: "/private/work" }), false);
});
