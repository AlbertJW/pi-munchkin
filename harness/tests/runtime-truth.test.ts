import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fire, makeFakePi } from "./integration-harness.ts";

type PriorEnv = Record<string, string | undefined>;

function restoreEnv(prior: PriorEnv): void {
	for (const [name, value] of Object.entries(prior)) {
		if (value === undefined) delete process.env[name]; else process.env[name] = value;
	}
}

test("provider timings are numeric, observational, and emitted once only after agent_settled", async () => {
	const root = mkdtempSync(join(tmpdir(), "runtime-truth-"));
	const file = join(root, "events.jsonl");
	const names = ["TELEMETRY", "TELEMETRY_FILE", "TELEMETRY_FD", "TELEMETRY_HMAC_FD", "TELEMETRY_SOURCE"];
	const prior = Object.fromEntries(names.map((name) => [name, process.env[name]]));
	process.env.TELEMETRY_FILE = file;
	process.env.TELEMETRY_SOURCE = "test";
	delete process.env.TELEMETRY;
	delete process.env.TELEMETRY_FD;
	delete process.env.TELEMETRY_HMAC_FD;
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/runtime-truth.ts?timing=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		await fire(fp, "session_start", { reason: "new" }, {});
		await fire(fp, "before_provider_request", { payload: { model: "unused" } }, {});
		await fire(fp, "after_provider_response", { status: 200 }, {});
		await fire(fp, "message_update", { assistantMessageEvent: { type: "text_delta", delta: "ok" } }, {});
		await fire(fp, "message_update", { assistantMessageEvent: { type: "done" } }, {});
		await fire(fp, "agent_end", {}, {});
		await fire(fp, "session_compact", { reason: "auto", tokensBefore: 1_000 }, {});
		assert.equal(existsSync(file), false, "agent_end may precede retry or compaction");
		await fire(fp, "agent_settled", {}, {});
		const firstRows = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		assert.equal(firstRows.length, 1);
		assert.equal(firstRows[0].ext, "runtime");
		assert.equal(firstRows[0].kind, "provider-timing");
		for (const key of ["request_to_headers_ms", "first_token_ms", "stream_completion_ms", "settlement_ms"]) {
			assert.equal(typeof firstRows[0][key], "number", key);
			assert.ok(firstRows[0][key] >= 0, key);
		}
		await fire(fp, "agent_settled", {}, {});
		assert.equal(readFileSync(file, "utf8").trim().split("\n").length, 1, "settlement work is one-shot");
		assert.equal(readFileSync(file, "utf8").includes("unused"), false);
	} finally {
		restoreEnv(prior);
		rmSync(root, { recursive: true, force: true });
	}
});

test("munchkin doctor command reports runtime truth without private settings", async () => {
	const root = mkdtempSync(join(tmpdir(), "runtime-doctor-command-"));
	const names = ["PI_CODING_AGENT_DIR", "HARNESS_SURFACE_SHA256", "PI_SANDBOX_POSTURE"];
	const prior = Object.fromEntries(names.map((name) => [name, process.env[name]]));
	process.env.PI_CODING_AGENT_DIR = root;
	process.env.HARNESS_SURFACE_SHA256 = "b".repeat(64);
	process.env.PI_SANDBOX_POSTURE = "host";
	try {
		const fp = makeFakePi();
		(fp.pi as any).getAllTools = () => [{
			name: "read", description: "", sourceInfo: { source: "builtin", scope: "global", origin: "builtin" },
		}];
		(fp.pi as any).getActiveTools = () => ["read"];
		const mod = await import(`../extensions/runtime-truth.ts?doctor=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		const notices: string[] = [];
		await fp.commands.get("munchkin-doctor").handler("", {
			cwd: root,
			model: { provider: "local", id: "small", api: "openai-completions", compat: { supportsStrictMode: false } },
			modelRegistry: { getProviderDisplayName: () => "Local Provider" },
			ui: { notify: (message: string) => notices.push(message) },
		});
		assert.equal(notices.length, 1);
		assert.match(notices[0], /harness_surface=b{64}/);
		assert.match(notices[0], /tools=1\/1 active\/all/);
		assert.match(notices[0], /strict_tool_sampling=false/);
		assert.match(notices[0], /sandbox=host/);
		assert.equal(notices[0].includes("http://"), false);
	} finally {
		restoreEnv(prior);
		rmSync(root, { recursive: true, force: true });
	}
});

test("only actual streamed deltas count as first tokens", async () => {
	const mod = await import(`../extensions/runtime-truth.ts?predicate=${Date.now()}-${Math.random()}`);
	assert.equal(mod.isFirstTokenEvent({ type: "text_delta", delta: "x" }), true);
	assert.equal(mod.isFirstTokenEvent({ type: "toolcall_delta", delta: "{" }), true);
	assert.equal(mod.isFirstTokenEvent({ type: "text_delta", delta: "" }), false);
	assert.equal(mod.isFirstTokenEvent({ type: "done", delta: "x" }), false);
});
