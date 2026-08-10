import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fire, makeFakePi } from "./integration-harness.ts";

function withEnv(values: Record<string, string | undefined>, work: () => Promise<void>): Promise<void> {
	const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) delete process.env[key]; else process.env[key] = value;
	}
	return work().finally(() => {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
	});
}

test("async interactive writer preserves sequence order and private permissions", async () => {
	const root = mkdtempSync(join(tmpdir(), "telemetry-async-"));
	const file = join(root, "private", "events.jsonl");
	await withEnv({
		TELEMETRY: "on", TELEMETRY_SOURCE: "interactive", TELEMETRY_WRITER: "async", TELEMETRY_FILE: file,
	}, async () => {
		const telemetry = await import(`../lib/telemetry.ts?async-order=${Date.now()}-${Math.random()}`);
		const telemetryB = await import(`../lib/telemetry.ts?async-order-b=${Date.now()}-${Math.random()}`);
		for (let index = 0; index < 100; index++) {
			(index % 2 === 0 ? telemetry : telemetryB).record("blackboard", "rendered", { chars: index, attempts: index });
		}
		await telemetry.flushTelemetry();
		const rows = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		assert.equal(rows.length, 100);
		for (let index = 1; index < rows.length; index++) assert.ok(rows[index].seq > rows[index - 1].seq);
		assert.equal(statSync(file).mode & 0o777, 0o600);
		assert.equal(statSync(dirname(file)).mode & 0o777, 0o700);
	});
});

test("async writer never tightens permissions on a pre-existing parent directory", async () => {
	const root = mkdtempSync(join(tmpdir(), "telemetry-parent-mode-"));
	const directory = join(root, "shared");
	mkdirSync(directory, { mode: 0o755 });
	chmodSync(directory, 0o755);
	const file = join(directory, "events.jsonl");
	await withEnv({
		TELEMETRY: "on", TELEMETRY_SOURCE: "interactive", TELEMETRY_WRITER: "async", TELEMETRY_FILE: file,
	}, async () => {
		const telemetry = await import(`../lib/telemetry.ts?parent-mode=${Date.now()}-${Math.random()}`);
		telemetry.record("blackboard", "rendered", { chars: 1, attempts: 1 });
		await telemetry.flushTelemetry();
		assert.equal(statSync(directory).mode & 0o777, 0o755);
		assert.equal(statSync(file).mode & 0o777, 0o600);
	});
});

test("bounded queue drops observational rows and later emits one count-only receipt", async () => {
	const root = mkdtempSync(join(tmpdir(), "telemetry-overflow-"));
	const file = join(root, "events.jsonl");
	await withEnv({
		TELEMETRY: "on", TELEMETRY_SOURCE: "interactive", TELEMETRY_WRITER: "async", TELEMETRY_FILE: file,
		TELEMETRY_ASYNC_MAX_ROWS: "8", TELEMETRY_ASYNC_BATCH_ROWS: "1",
	}, async () => {
		const telemetry = await import(`../lib/telemetry.ts?async-overflow=${Date.now()}-${Math.random()}`);
		for (let index = 0; index < 100; index++) telemetry.record("blackboard", "rendered", { chars: index, attempts: index });
		await telemetry.flushTelemetry();
		const rows = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		const overflow = rows.filter((row) => row.ext === "telemetry" && row.kind === "writer-overflow");
		assert.equal(overflow.length, 1);
		assert.ok(overflow[0].dropped_rows > 0);
		assert.equal(Object.keys(overflow[0]).some((key) => /prompt|content|error|url|path|command/i.test(key)), false);
	});
});

test("a full queue does not count a failed overflow-receipt attempt as lost data", async () => {
	const root = mkdtempSync(join(tmpdir(), "telemetry-overflow-count-"));
	const file = join(root, "events.jsonl");
	await withEnv({ TELEMETRY_ASYNC_MAX_ROWS: "8" }, async () => {
		const writer = await import(`../lib/telemetry-writer.ts?overflow-count=${Date.now()}-${Math.random()}`);
		for (let index = 0; index < 8; index++) assert.equal(writer.enqueueTelemetryLine(file, `${index}\n`), true);
		assert.equal(writer.enqueueTelemetryLine(file, "lost\n"), false);
		assert.equal(writer.pendingDroppedTelemetryRows(file), 1);
		assert.equal(writer.enqueueTelemetryLine(file, "receipt\n", false), false);
		assert.equal(writer.pendingDroppedTelemetryRows(file), 1);
		await writer.flushTelemetryWriters();
	});
});

test("gate and inherited-FD posture remains synchronous", async () => {
	const telemetry = await import(`../lib/telemetry.ts?writer-mode=${Date.now()}-${Math.random()}`);
	assert.equal(telemetry.telemetryWriterMode({ TELEMETRY_WRITER: "async", TELEMETRY_SOURCE: "gate" } as NodeJS.ProcessEnv), "sync");
	assert.equal(telemetry.telemetryWriterMode({ TELEMETRY_WRITER: "async", TELEMETRY_FD: "9" } as NodeJS.ProcessEnv), "sync");
	assert.equal(telemetry.telemetryWriterMode({ TELEMETRY_WRITER: "async", TELEMETRY_SOURCE: "interactive" } as NodeJS.ProcessEnv), "async");
});

test("agent_settled awaits the final async telemetry flush", async () => {
	const root = mkdtempSync(join(tmpdir(), "telemetry-settled-"));
	const file = join(root, "events.jsonl");
	await withEnv({
		TELEMETRY: "on", TELEMETRY_SOURCE: "interactive", TELEMETRY_WRITER: "async", TELEMETRY_FILE: file,
	}, async () => {
		const fp = makeFakePi();
		const telemetry = await import(`../lib/telemetry.ts?settled-record=${Date.now()}-${Math.random()}`);
		const flush = await import(`../extensions/telemetry-flush.ts?settled=${Date.now()}-${Math.random()}`);
		flush.default(fp.pi as never);
		telemetry.record("blackboard", "rendered", { chars: 1, attempts: 1 });
		await fire(fp, "agent_settled", {}, {});
		assert.equal(readFileSync(file, "utf8").trim().length > 0, true);
	});
});

test("async writer retains the one-generation rotation boundary", async () => {
	const root = mkdtempSync(join(tmpdir(), "telemetry-rotate-"));
	const file = join(root, "events.jsonl");
	await withEnv({
		TELEMETRY: "on", TELEMETRY_SOURCE: "interactive", TELEMETRY_WRITER: "async", TELEMETRY_FILE: file,
		TELEMETRY_MAX_BYTES: "1024", TELEMETRY_ASYNC_BATCH_BYTES: "1024",
	}, async () => {
		const telemetry = await import(`../lib/telemetry.ts?async-rotate=${Date.now()}-${Math.random()}`);
		for (let index = 0; index < 80; index++) telemetry.record("blackboard", "rendered", { chars: index, attempts: index });
		await telemetry.flushTelemetry();
		assert.equal(existsSync(`${file}.old`), true);
		assert.equal(readFileSync(file, "utf8").trim().length > 0, true);
	});
});
