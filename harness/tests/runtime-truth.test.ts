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

test("serving verdict follows the pi-health convention: served-8192 <= registry <= served", async () => {
	const mod = await import(`../extensions/runtime-truth.ts?verdict=${Date.now()}-${Math.random()}`);
	assert.equal(mod.computeServingVerdict(32768, 8192), "registry_under_served", "the ling3 case");
	assert.equal(mod.computeServingVerdict(65536, 61440), "ok", "the deliberate headroom stays quiet");
	assert.equal(mod.computeServingVerdict(4096, 8192), "registry_over_served", "over-promise is always flagged");
	assert.equal(mod.computeServingVerdict(65536, 57344), "ok", "exactly at the 8192 boundary is ok");
	assert.equal(mod.computeServingVerdict(65536, 57343), "registry_under_served", "one past the boundary flags");
});

test("probeServingTruth: named cloud hosts and public IPs are NEVER fetched", async () => {
	const mod = await import(`../extensions/runtime-truth.ts?guard=${Date.now()}-${Math.random()}`);
	let calls = 0;
	const spy = (async () => { calls += 1; throw new Error("must not be called"); }) as unknown as typeof fetch;
	// The naive isPrivateAddress reuse fails THIS case: a named host reads as "private".
	assert.equal(await mod.probeServingTruth({ baseUrl: ["https://", "api.anthropic.com/v1"].join(""), modelId: "m" }, { fetchFn: spy }), null);
	assert.equal(await mod.probeServingTruth({ baseUrl: ["http://", "8.8.8.8/v1"].join(""), modelId: "m" }, { fetchFn: spy }), null);
	assert.equal(await mod.probeServingTruth({ baseUrl: "not a url", modelId: "m" }, { fetchFn: spy }), null);
	assert.equal(calls, 0, "guard must reject before any network I/O");
});

test("probeServingTruth: reads n_ctx from /props, falls back to the llama-swap route, fails silent", async () => {
	const mod = await import(`../extensions/runtime-truth.ts?probe=${Date.now()}-${Math.random()}`);
	const respond = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;

	const direct = (async (url: string) => {
		assert.equal(String(url), ["http://", "127.0.0.1:8080/props"].join(""));
		return respond({ default_generation_settings: { n_ctx: 65536 } });
	}) as unknown as typeof fetch;
	assert.deepEqual(
		await mod.probeServingTruth({ baseUrl: ["http://", "127.0.0.1:8080/v1"].join(""), modelId: "qwen" }, { fetchFn: direct }),
		{ served_n_ctx: 65536 });

	const seen: string[] = [];
	const swap = (async (url: string) => {
		seen.push(String(url));
		if (String(url).endsWith("/props") && !String(url).includes("/upstream/")) return respond({}, false);
		return respond({ default_generation_settings: { n_ctx: 32768 } });
	}) as unknown as typeof fetch;
	assert.deepEqual(
		await mod.probeServingTruth({ baseUrl: ["http://", "localhost:8080/v1"].join(""), modelId: "ling3/tiny" }, { fetchFn: swap }),
		{ served_n_ctx: 32768 });
	assert.equal(seen[1]?.includes("/upstream/ling3%2Ftiny/props"), true, "model id is URI-encoded in the route");

	const broken = (async () => { throw new Error("refused"); }) as unknown as typeof fetch;
	assert.equal(await mod.probeServingTruth({ baseUrl: ["http://", "127.0.0.1:9999/v1"].join(""), modelId: "m" }, { fetchFn: broken }), null);
	const junk = (async () => ({ ok: true, json: async () => ({ nothing: true }) }) as Response) as unknown as typeof fetch;
	assert.equal(await mod.probeServingTruth({ baseUrl: ["http://", "127.0.0.1:9999/v1"].join(""), modelId: "m" }, { fetchFn: junk }), null);
});

test("serving-truth wiring: probes once per model after a 2xx response, records telemetry, renders in doctor", async () => {
	const telemetry = join(mkdtempSync(join(tmpdir(), "st-")), "t.jsonl");
	const prior = { file: process.env.TELEMETRY_FILE, source: process.env.TELEMETRY_SOURCE };
	process.env.TELEMETRY_FILE = telemetry;
	process.env.TELEMETRY_SOURCE = "test";
	const realFetch = globalThis.fetch;
	let fetches = 0;
	try {
		globalThis.fetch = (async () => {
			fetches += 1;
			return { ok: true, json: async () => ({ default_generation_settings: { n_ctx: 32768 } }) } as Response;
		}) as typeof fetch;
		const fp = makeFakePi();
		const mod = await import(`../extensions/runtime-truth.ts?wiring=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		const notices: string[] = [];
		const ctx = {
			cwd: "/tmp",
			model: { id: "small", provider: "local", baseUrl: ["http://", "127.0.0.1:8080/v1"].join(""), contextWindow: 8192, api: "openai-completions" },
			modelRegistry: { getProviderDisplayName: () => "Local" },
			ui: { notify: (message: string) => notices.push(message) },
		};
		await fire(fp, "before_provider_request", {}, ctx);
		await fire(fp, "after_provider_response", { status: 200 }, ctx);
		await fire(fp, "after_provider_response", { status: 200 }, ctx);
		assert.equal(fetches, 0, "no fetch before settlement — a mid-stream /props queues behind the completion on a single-slot router");
		await fire(fp, "agent_settled", {}, ctx);
		await fire(fp, "agent_settled", {}, ctx);
		await new Promise((resolve) => setTimeout(resolve, 0)); // flush the fire-and-forget probe
		assert.equal(fetches, 1, "exactly one probe per model, at settlement");
		const rows = readFileSync(telemetry, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		const row = rows.find((r) => r.ext === "runtime" && r.kind === "serving-truth");
		assert.ok(row, "serving-truth telemetry row recorded");
		assert.equal(row.served_n_ctx, 32768);
		assert.equal(row.registry_ctx, 8192);
		assert.equal(row.verdict, "registry_under_served");
		assert.equal(notices.length, 1, "mismatch notifies once");
		assert.equal(notices[0].includes("http://"), false, "no URL in the notice");

		await fp.commands.get("munchkin-doctor")!.handler("", {
			cwd: "/tmp",
			model: { provider: "local", id: "small", api: "openai-completions", compat: { supportsStrictMode: false } },
			modelRegistry: { getProviderDisplayName: () => "Local" },
			ui: { notify: (message: string) => notices.push(message) },
		});
		const doctor = notices.at(-1)!;
		assert.match(doctor, /serving_truth=served_n_ctx:32768; registry_ctx:8192; verdict:registry_under_served/);
		assert.equal(doctor.includes("http://"), false, "doctor still carries no URLs");
	} finally {
		globalThis.fetch = realFetch;
		if (prior.file === undefined) delete process.env.TELEMETRY_FILE; else process.env.TELEMETRY_FILE = prior.file;
		if (prior.source === undefined) delete process.env.TELEMETRY_SOURCE; else process.env.TELEMETRY_SOURCE = prior.source;
	}
});

test("session_start stamps HARNESS_SURFACE_SHA256 for interactive sessions, never overwrites the gate's", async () => {
	const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const dir = mkdtempSync(join(tmpdir(), "rt-surface-"));
	const priorAgent = process.env.PI_CODING_AGENT_DIR;
	const priorHash = process.env.HARNESS_SURFACE_SHA256;
	try {
		writeFileSync(join(dir, "settings.json"), "{}");
		mkdirSync(join(dir, "extensions"));
		writeFileSync(join(dir, "extensions", "noop.ts"), "export default function () {}\n");
		process.env.PI_CODING_AGENT_DIR = dir;
		delete process.env.HARNESS_SURFACE_SHA256;
		const fp = makeFakePi();
		const mod = await import(`../extensions/runtime-truth.ts?surface=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		await fire(fp, "session_start", {});
		const stamped = process.env.HARNESS_SURFACE_SHA256;
		assert.match(stamped ?? "", /^[a-f0-9]{64}$/, "interactive rows get a surface hash to bind to");
		// A gate's pre-set value is authoritative (set BEFORE pi starts) — never recomputed over it.
		process.env.HARNESS_SURFACE_SHA256 = "f".repeat(64);
		await fire(fp, "session_start", {});
		assert.equal(process.env.HARNESS_SURFACE_SHA256, "f".repeat(64), "a pre-set hash is never overwritten");
	} finally {
		rmSync(dir, { recursive: true, force: true });
		if (priorAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = priorAgent;
		if (priorHash === undefined) delete process.env.HARNESS_SURFACE_SHA256; else process.env.HARNESS_SURFACE_SHA256 = priorHash;
	}
});
