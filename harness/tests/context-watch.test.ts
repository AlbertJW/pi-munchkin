import assert from "node:assert/strict";
import test from "node:test";
import { fire, makeFakePi } from "./integration-harness.ts";
import { registerContextWatcher } from "../extensions/context-watcher.ts";
import { beginCompaction, currentCompactionOwner, finishCompaction, resetCompactionCoordinator } from "../lib/compaction-coordinator.ts";

// Run: cd ~/.pi/agent && npx -y tsx --test tests/context-watch.test.ts

function observe() {
	const fp = makeFakePi();
	const telemetry: Array<{ kind: string; detail: Record<string, unknown> }> = [];
	registerContextWatcher(
		fp.pi as never,
		(_ext, kind, detail) => { telemetry.push({ kind, detail: detail ?? {} }); },
	);
	return { fp, telemetry };
}

test("records native compaction with pi attribution and usage detail", async () => {
	resetCompactionCoordinator();
	const { fp, telemetry } = observe();
	const ctx = { getContextUsage: () => ({ tokens: 600, contextWindow: 1000, percent: 60 }) };
	await fire(fp, "session_compact", {
		fromExtension: false,
		reason: "threshold",
		willRetry: false,
		compactionEntry: { tokensBefore: 900 },
	}, ctx);
	assert.deepEqual(telemetry, [{
		kind: "compacted",
		detail: {
			requester: "pi", contentProvider: "pi", reason: "threshold", willRetry: false,
			tokensBefore: 900, contextTokens: 600, contextWindow: 1000, contextPct: 60,
		},
	}]);
});

test("extension-supplied summary content is not misreported as the requester", async () => {
	resetCompactionCoordinator();
	const { fp, telemetry } = observe();
	const ctx = { getContextUsage: () => ({ tokens: 400, contextWindow: 1000, percent: 40 }) };
	await fire(fp, "session_compact", {
		fromExtension: true, reason: "manual", willRetry: false,
		compactionEntry: { tokensBefore: 800 },
	}, ctx);
	const observed = telemetry.find((event) => event.kind === "compacted")?.detail;
	assert.equal(observed?.requester, "manual-unknown");
	assert.equal(observed?.contentProvider, "extension");
});

test("coordinator state is shared across module instances (globalThis, not module scope)", async () => {
	// pi loads each extension with its own jiti instance (moduleCache: false), so a
	// module-scoped singleton is per-extension. This reproduces the two-instance
	// situation with a cache-busting import: ownership taken through THIS instance
	// must be visible through the other, or compact-tool attribution silently breaks.
	resetCompactionCoordinator();
	const other = await import(`../lib/compaction-coordinator.ts?instance=${Date.now()}-${Math.random()}`);
	const token = beginCompaction("compact-tool");
	assert.ok(token);
	assert.equal(other.currentCompactionOwner(), "compact-tool");
	assert.ok(other.finishCompaction(token));
	assert.equal(currentCompactionOwner(), null);
});

test("a coordinator owner (compact-tool) is credited as the requester", async () => {
	resetCompactionCoordinator();
	const { fp, telemetry } = observe();
	const token = beginCompaction("compact-tool");
	assert.ok(token);
	const ctx = { getContextUsage: () => undefined };
	await fire(fp, "session_compact", {
		fromExtension: true, reason: "manual", willRetry: false,
		compactionEntry: { tokensBefore: 700 },
	}, ctx);
	finishCompaction(token!);
	const observed = telemetry.find((event) => event.kind === "compacted")?.detail;
	assert.equal(observed?.requester, "compact-tool");
	assert.equal(observed?.contextTokens, null);
	assert.equal(observed?.contextPct, null);
});
