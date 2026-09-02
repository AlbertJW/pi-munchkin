import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resetCompactionCoordinator } from "../lib/compaction-coordinator.ts";
import {
	calibrateContext, contextNeedsHandoff, contextProfileFor, handoffReason, modelFingerprint, outputReserveFor, safeInputBudget,
} from "../lib/context-profile.ts";
import { fire, makeFakePi } from "./integration-harness.ts";

test("context profiles derive a model-specific safe budget and stable serving fingerprint", () => {
	const model = { provider: "local", id: "qwen35b", contextWindow: 32_768, baseUrl: ["http", "://127.0.0.1:8080/v1"].join("") };
	const profile = contextProfileFor(model, 4);
	assert.equal(profile.epoch, 4);
	assert.equal(profile.declared_context_window, 32_768);
	assert.equal(profile.safe_input_tokens, safeInputBudget(32_768));
	assert.equal(profile.output_reserve, outputReserveFor(32_768));
	assert.equal(modelFingerprint(model), profile.fingerprint);
	assert.notEqual(profile.fingerprint, modelFingerprint({ ...model, id: "ling" }));
	assert.notEqual(profile.fingerprint, modelFingerprint({ ...model, baseUrl: ["http", "://127.0.0.1:9090/v1"].join("") }), "serving endpoints define distinct epochs");
	assert.equal(JSON.stringify(profile).includes("127.0.0.1"), false, "profiles expose only a hashed endpoint identity");
	assert.equal(contextNeedsHandoff(profile, { tokens: profile.safe_input_tokens! }), true);
	assert.match(handoffReason(profile, { tokens: profile.safe_input_tokens! }), /safe input budget/);
});

test("context usage percentages follow Pi's native 0-100 contract", () => {
	const profile = contextProfileFor({ provider: "local", id: "percent-contract", contextWindow: 32_768 });
	assert.equal(contextNeedsHandoff(profile, { percent: 60 }), false);
	assert.equal(contextNeedsHandoff(profile, { percent: 84.9 }), false);
	assert.equal(contextNeedsHandoff(profile, { percent: 85 }), true);
	assert.match(handoffReason(profile, { percent: 85 }), /85%/);
});

test("context budgets stay within even unusually small declared windows", () => {
	for (const window of [1, 100, 512, 2_048, 8_192]) {
		assert.ok(outputReserveFor(window) <= window, `output reserve exceeded ${window}`);
		const budget = safeInputBudget(window);
		assert.ok(budget !== null && budget >= 0 && budget <= window, `safe budget escaped ${window}`);
	}
	assert.equal(safeInputBudget(0), null);
	assert.equal(safeInputBudget(-1), null);
	assert.equal(safeInputBudget(Number.NaN), null);
	assert.equal(safeInputBudget(4_096, Number.NaN), safeInputBudget(4_096, 0));
	assert.equal(contextProfileFor({ contextWindow: 4_096 }, 0, { overheadTokens: Number.NaN }).overhead_tokens, 1_024);
});

test("serving metadata wins over an optimistic registry value without changing the epoch", () => {
	const profile = contextProfileFor({ provider: "local", id: "qwen", contextWindow: 65_536 }, 2, { servedContextWindow: 32_768 });
	assert.equal(profile.served_context_window, 32_768);
	assert.equal(profile.safe_input_tokens, safeInputBudget(32_768));
	assert.equal(profile.confidence, "measured");
});

test("active calibration is isolated, local-only, bounded, and opt-in", async () => {
	let calls = 0;
	const model = { provider: "local", id: "ling", contextWindow: 8_192, baseUrl: ["http", "://127.0.0.1:1234/v1"].join("") };
	const profile = contextProfileFor(model, 0);
	const fetchFn = (async (url: string, init?: RequestInit) => {
		calls += 1;
		assert.equal(url, ["http", "://127.0.0.1:1234/v1/chat/completions"].join(""));
		const body = JSON.parse(String(init?.body));
		assert.equal(body.max_tokens, 1);
		assert.equal(body.messages.length, 1);
		assert.equal(body.messages[0].content, "Return one token: OK");
		return { ok: true, status: 200 } as Response;
	}) as typeof fetch;
	const skipped = await calibrateContext({ model, profile, fetchFn, enabled: false });
	assert.equal(skipped.failure, "not_requested");
	assert.equal(calls, 0);
	const measured = await calibrateContext({ model, profile, fetchFn, enabled: true });
	assert.equal(measured.ok, true);
	assert.equal(measured.profile.source, "calibration");
	assert.equal(measured.profile.confidence, "observed", "a one-token reachability request is not a capacity measurement");
	assert.equal(measured.profile.calibration, "success");
	assert.equal(calls, 1);
	const larger = { provider: "local", id: "qwen35b", contextWindow: 65_536, baseUrl: ["http", "://127.0.0.1:1234/v1"].join("") };
	const largerMeasured = await calibrateContext({ model: larger, profile: contextProfileFor(larger), fetchFn, enabled: true });
	assert.equal(largerMeasured.profile.safe_input_tokens, safeInputBudget(65_536));
	const refused = await calibrateContext({ model: { ...model, baseUrl: "https://api.example.test/v1" }, profile, fetchFn, enabled: true });
	assert.equal(refused.failure, "unsafe_host");
	assert.equal(calls, 2);
});

test("a served-window shrink at settlement immediately triggers the one-shot handoff", async () => {
	const prior = process.env.CONTEXT_HANDOFF;
	delete process.env.CONTEXT_HANDOFF;
	const realFetch = globalThis.fetch;
	try {
		globalThis.fetch = (async () => ({ ok: true, json: async () => ({ default_generation_settings: { n_ctx: 4_096 } }) }) as Response) as typeof fetch;
		const fp = makeFakePi();
		const mod = await import(`../extensions/runtime-truth.ts?served-shrink=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		await fire(fp, "session_start", {}, {});
		let compactions = 0;
		const ctx = {
			model: { provider: "local", id: "same-id", contextWindow: 32_768, baseUrl: ["http", "://127.0.0.1:8080/v1"].join("") },
			getContextUsage: () => ({ tokens: 8_000, percent: 25 }),
			compact: (options: { onComplete?: () => void }) => { compactions += 1; options.onComplete?.(); },
			ui: { notify: () => {} },
		};
		await fire(fp, "before_provider_request", {}, ctx);
		await fire(fp, "after_provider_response", { status: 200 }, ctx);
		await fire(fp, "agent_settled", {}, ctx);
		assert.equal(compactions, 1, "the lower served budget must be enforced before another provider request");
		assert.ok(fp.sent.some((message) => /preserved active task state/.test(message)));
		assert.equal(fp.sent.some((message) => /preserved goal/.test(message)), false, "ordinary tasks must not claim a goal exists");
	} finally {
		globalThis.fetch = realFetch;
		if (prior === undefined) delete process.env.CONTEXT_HANDOFF; else process.env.CONTEXT_HANDOFF = prior;
	}
});

test("serving discovery rearms for the same model ID on a different endpoint", async () => {
	const realFetch = globalThis.fetch;
	let fetches = 0;
	try {
		globalThis.fetch = (async () => { fetches += 1; return { ok: true, json: async () => ({ default_generation_settings: { n_ctx: 8_192 } }) } as Response; }) as typeof fetch;
		const fp = makeFakePi();
		const mod = await import(`../extensions/runtime-truth.ts?endpoint-epoch=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		await fire(fp, "session_start", {}, {});
		for (const port of [8080, 9090]) {
			const ctx = { model: { provider: "local", id: "same-id", contextWindow: 8_192, baseUrl: `http://127.0.0.1:${port}/v1` }, ui: { notify: () => {} } };
			await fire(fp, "before_provider_request", {}, ctx);
			await fire(fp, "after_provider_response", { status: 200 }, ctx);
			await fire(fp, "agent_settled", {}, ctx);
		}
		assert.equal(fetches, 2);
	} finally { globalThis.fetch = realFetch; }
});

test("runtime model switching creates a new epoch and automatically hands off an over-budget context", async () => {
	const prior = process.env.CONTEXT_HANDOFF;
	delete process.env.CONTEXT_HANDOFF;
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/runtime-truth.ts?handoff=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		await fire(fp, "session_start", {}, {});
		const large = { provider: "local", id: "large", contextWindow: 32_768, baseUrl: ["http", "://127.0.0.1:1234/v1"].join("") };
		await fire(fp, "before_provider_request", {}, { model: large });
		let compacted = "";
		await fire(fp, "model_select", { model: { ...large, id: "small", contextWindow: 4_096 } }, {
			getContextUsage: () => ({ tokens: 8_000, contextWindow: 4_096, percent: 95 }),
			compact: (options: { customInstructions?: string; onComplete?: () => void }) => { compacted = options.customInstructions ?? ""; options.onComplete?.(); },
		});
		const profile = (globalThis as Record<string, unknown>).__pi_context_profile as { epoch: number; model: string };
		assert.equal(profile.epoch, 1);
		assert.equal(profile.model, "small");
		assert.match(compacted, /Model handoff/);
		assert.ok(fp.sent.some((message) => /Model handoff complete/.test(message)));
	} finally {
		if (prior === undefined) delete process.env.CONTEXT_HANDOFF; else process.env.CONTEXT_HANDOFF = prior;
	}
});

test("an over-budget pre-request context is handed off before another request starts", async () => {
	const prior = process.env.CONTEXT_HANDOFF;
	delete process.env.CONTEXT_HANDOFF;
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/runtime-truth.ts?pre-request-handoff=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		await fire(fp, "session_start", {}, {});
		const model = { provider: "local", id: "pre-request-large", contextWindow: 32_768 };
		let compactions = 0;
		await fire(fp, "before_provider_request", {}, {
			model,
			getContextUsage: () => ({ tokens: 30_000, percent: 92 }),
			compact: (options: { onComplete?: () => void }) => { compactions += 1; options.onComplete?.(); },
		});
		assert.equal(compactions, 1, "an over-budget follow-up must compact before it is sent");
		assert.ok(fp.sent.some((message) => /Model handoff complete/.test(message)));
	} finally {
		if (prior === undefined) delete process.env.CONTEXT_HANDOFF; else process.env.CONTEXT_HANDOFF = prior;
	}
});

test("automatic handoff is one-shot until the context falls below the rearm threshold", async () => {
	const prior = process.env.CONTEXT_HANDOFF;
	delete process.env.CONTEXT_HANDOFF;
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/runtime-truth.ts?handoff-rearm=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		await fire(fp, "session_start", {}, {});
		const model = { provider: "local", id: "large-rearm", contextWindow: 32_768 };
		await fire(fp, "before_provider_request", {}, { model });
		let tokens = 30_000;
		let compactions = 0;
		const ctx = {
			getContextUsage: () => ({ tokens, percent: tokens / model.contextWindow * 100 }),
			compact: (options: { onComplete?: () => void }) => { compactions += 1; options.onComplete?.(); },
		};
		await fire(fp, "turn_end", {}, ctx);
		await fire(fp, "turn_end", {}, ctx);
		assert.equal(compactions, 1, "the same over-budget epoch must not compact repeatedly");
		tokens = 10_000;
		await fire(fp, "turn_end", {}, ctx);
		tokens = 30_000;
		await fire(fp, "turn_end", {}, ctx);
		assert.equal(compactions, 2, "a materially reduced context should rearm the handoff");
	} finally {
		if (prior === undefined) delete process.env.CONTEXT_HANDOFF; else process.env.CONTEXT_HANDOFF = prior;
	}
});

test("a stale compaction lease does not permanently disable automatic handoff", async () => {
	const prior = process.env.CONTEXT_HANDOFF;
	delete process.env.CONTEXT_HANDOFF;
	try {
		resetCompactionCoordinator();
		const fp = makeFakePi();
		const mod = await import(`../extensions/runtime-truth.ts?handoff-latch=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		await fire(fp, "session_start", {}, {});
		const model = { provider: "local", id: "latch", contextWindow: 32_768 };
		await fire(fp, "before_provider_request", {}, { model });
		let compactions = 0;
		const usage = () => ({ tokens: 30_000, percent: 91 });
		// A coordinator reset lands between the lease grant and the completion
		// callback — the same shape as a session reset racing an in-flight
		// compaction. finishCompaction() then returns false for the stale token.
		await fire(fp, "turn_end", {}, {
			getContextUsage: usage,
			compact: (options: { onComplete?: () => void }) => { compactions += 1; resetCompactionCoordinator(); options.onComplete?.(); },
		});
		assert.equal(compactions, 1);
		await fire(fp, "turn_end", {}, {
			getContextUsage: usage,
			compact: (options: { onComplete?: () => void }) => { compactions += 1; options.onComplete?.(); },
		});
		assert.equal(compactions, 2, "a stale lease must not latch handoffInFlight for the rest of the session");
	} finally {
		if (prior === undefined) delete process.env.CONTEXT_HANDOFF; else process.env.CONTEXT_HANDOFF = prior;
	}
});

test("context-handoff telemetry reports the outcome, not the attempt", async () => {
	const file = join(mkdtempSync(join(tmpdir(), "pi-handoff-telemetry-")), "events.jsonl");
	const names = ["CONTEXT_HANDOFF", "TELEMETRY", "TELEMETRY_FILE", "TELEMETRY_FD", "TELEMETRY_HMAC_FD", "TELEMETRY_SOURCE"];
	const prior = Object.fromEntries(names.map((name) => [name, process.env[name]]));
	for (const name of names) delete process.env[name];
	process.env.TELEMETRY_FILE = file;
	process.env.TELEMETRY_SOURCE = "test";
	try {
		resetCompactionCoordinator();
		const fp = makeFakePi();
		const mod = await import(`../extensions/runtime-truth.ts?handoff-outcome=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		await fire(fp, "session_start", {}, {});
		await fire(fp, "before_provider_request", {}, { model: { provider: "local", id: "outcome-large", contextWindow: 32_768 } });
		const handoffRows = () => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [])
			.filter((row) => row.ext === "runtime" && row.kind === "context-handoff");
		let fail: (() => void) | undefined;
		await fire(fp, "model_select", { model: { provider: "local", id: "outcome-small", contextWindow: 4_096 } }, {
			getContextUsage: () => ({ tokens: 8_000, percent: 95 }),
			compact: (options: { onError?: (error: Error) => void }) => { fail = () => options.onError?.(new Error("provider aborted")); },
		});
		assert.equal(handoffRows().length, 0, "no outcome row may exist while the compaction is still in flight");
		fail?.();
		const rows = handoffRows();
		assert.equal(rows.length, 1, "a settled handoff emits exactly one outcome row");
		assert.equal(rows[0].ok, false, "a failed handoff must not look like a successful one");
		assert.equal(rows[0].reason_class, "smaller_target_window");
	} finally {
		for (const name of names) {
			if (prior[name] === undefined) delete process.env[name]; else process.env[name] = prior[name] as string;
		}
	}
});
