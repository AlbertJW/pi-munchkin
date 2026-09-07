import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	ContextReservationLedger,
	allocateContextAllowance,
	buildContextAccounting,
	contextEpochKey,
	preserveContextSections,
	reserveContextOutput,
} from "../lib/context-accounting.ts";
import { contextProfileFor, withServingWindow } from "../lib/context-profile.ts";
import { fire, makeFakePi } from "./integration-harness.ts";

const model = {
	provider: "local-llamacpp",
	id: "qwen35b",
	contextWindow: 32_768,
	baseUrl: ["http", "://127.0.0.1:8080/v1"].join(""),
};

test("aggregate accounting inventories competing contributors without double-counting", () => {
	const profile = contextProfileFor(model, 2);
	const payload = {
		model: model.id,
		systemPrompt: "preserve the objective",
		messages: [
			{ role: "user", content: [{ type: "text", text: "current objective" }] },
			{ role: "assistant", content: [{ type: "text", text: "read source" }] },
			{ role: "toolResult", toolName: "read", content: [{ type: "text", text: "evidence" }] },
		],
		tools: [{ name: "read", parameters: { type: "object" } }],
		goalContext: { objective: "current objective", criteria: ["criterion-1"] },
		workingMemory: [{ text: "optional note" }],
	};
	const accounting = buildContextAccounting(payload, profile);
	assert.equal(accounting.outcome, "admitted");
	assert.equal(accounting.tokenization, "estimated");
	assert.ok(accounting.contributors.some((c) => c.kind === "system_instructions"));
	assert.ok(accounting.contributors.some((c) => c.kind === "tool_schemas"));
	assert.ok(accounting.contributors.some((c) => c.kind === "tool_results"));
	assert.ok(accounting.contributors.some((c) => c.kind === "goal_recovery"));
	assert.ok(accounting.contributors.some((c) => c.kind === "working_memory"));
	assert.equal(accounting.total_tokens,
		accounting.payload_tokens + accounting.overhead_tokens + accounting.uncertainty_margin_tokens + accounting.reserved_tokens + accounting.completion_reserve_tokens);
	assert.ok(accounting.total_tokens <= accounting.effective_window_tokens);
	assert.doesNotMatch(JSON.stringify(accounting), /current objective|optional note/);
});

test("legacy and normalized system/tool payload keys stay in their named partitions", () => {
	const profile = contextProfileFor(model);
	const accounting = buildContextAccounting({
		system_prompt: "system text",
		tool_schemas: [{ name: "read" }],
		functions: [{ name: "write" }],
		messages: [{ role: "user", content: "question" }],
	}, profile);
	assert.equal(accounting.contributors.filter((item) => item.kind === "system_instructions").length, 1);
	assert.equal(accounting.contributors.filter((item) => item.kind === "tool_schemas").length, 2);
	assert.equal(accounting.contributors.filter((item) => item.kind === "request_metadata").length, 0);
});

test("exact token counter is distinguishable from conservative estimate", () => {
	const profile = contextProfileFor(model);
	const payload = { messages: [{ role: "user", content: "hello world" }] };
	const estimated = buildContextAccounting(payload, profile);
	const exact = buildContextAccounting(payload, profile, { tokenCounter: (value) => value.length });
	assert.equal(estimated.tokenization, "estimated");
	assert.equal(exact.tokenization, "exact");
	assert.equal(exact.confidence, "verified");
	assert.notEqual(exact.payload_tokens, estimated.payload_tokens);
});

test("accounting reconciles the assembled payload with observed usage", () => {
	const profile = contextProfileFor(model);
	const accounting = buildContextAccounting(
		{ messages: [{ role: "user", content: "hello" }], tools: [{ name: "read" }] },
		profile,
		{ observedUsage: { tokens: 100, contextWindow: 32_768 } },
	);
	assert.ok(accounting.payload_bytes >= accounting.accounted_bytes);
	assert.ok(accounting.unaccounted_bytes >= 0);
	assert.equal(accounting.observed_context_tokens, 100);
	assert.equal(accounting.observed_context_window, 32_768);
	assert.equal(accounting.usage_relation, "within");
	const stale = buildContextAccounting(
		{ messages: [{ role: "user", content: "hello" }] },
		profile,
		{ observedUsage: { tokens: 100, contextWindow: 16_384 } },
	);
	assert.equal(stale.usage_relation, "mismatch");
	assert.equal(stale.outcome, "rejected");
	assert.equal(stale.reason_class, "stale_usage_epoch");
});

test("reservation ledger is idempotent, shared, and epoch-scoped", () => {
	const ledger = new ContextReservationLedger();
	assert.equal(ledger.reserve("a", "epoch-1", 100, 200).ok, true);
	assert.equal(ledger.reserve("a", "epoch-1", 100, 200).ok, true, "same reservation is idempotent");
	assert.equal(ledger.snapshot("epoch-1").reserved_tokens, 100);
	assert.equal(ledger.reserve("a", "epoch-1", 101, 200).ok, false, "reservation inflation is rejected");
	assert.equal(ledger.reserve("b", "epoch-1", 9_999, 200).ok, false, "shared allowance rejects overflow");
	assert.equal(ledger.reserve("b", "epoch-1", 50, 200).ok, true);
	assert.equal(ledger.snapshot("epoch-1").reserved_tokens, 150);
	ledger.release("a");
	assert.equal(ledger.snapshot("epoch-1").reserved_tokens, 50);
	ledger.reset("epoch-2");
	assert.equal(ledger.snapshot("epoch-1").reserved_tokens, 0);
});

test("allowance allocation cannot multiply the remaining budget", () => {
	const ledger = new ContextReservationLedger();
	const first = allocateContextAllowance(ledger, "search-1", "epoch", 400, 500);
	const second = allocateContextAllowance(ledger, "search-2", "epoch", 200, 500);
	assert.equal(first.ok, true);
	assert.equal(second.ok, false);
	assert.equal(ledger.snapshot("epoch").reserved_tokens, 400);
});

test("preservation order keeps required state and marks truncation explicitly", () => {
	const result = preserveContextSections({
		objective: "objective",
		constraints: "constraints",
		active_state: "active state",
		evidence: "required evidence",
		next_action: "next action",
		optional: "optional commentary that should be dropped ".repeat(5),
	}, 200);
	assert.ok(result.text.includes("objective"));
	assert.ok(result.text.includes("required evidence"));
	assert.ok(result.text.includes("next action"));
	assert.equal(result.truncated, true);
	assert.match(result.text, /truncated; retrieve omitted context/);
});

test("preservation projection never exceeds an extremely small caller cap", () => {
	for (const cap of [1, 2, 8, 32]) {
		const result = preserveContextSections({ objective: "required objective", next_action: "continue safely" }, cap);
		assert.ok(result.text.length <= cap, `cap=${cap} must remain hard`);
		assert.equal(result.truncated, true);
		assert.deepEqual(result.omitted, ["objective", "next_action"]);
	}
});

test("serving-window shrink creates a distinct accounting epoch", () => {
	const before = contextProfileFor(model, 3);
	const after = withServingWindow(before, 16_384);
	assert.notEqual(contextEpochKey(before), contextEpochKey(after));
	assert.ok(after.safe_input_tokens! < before.safe_input_tokens!);
});

test("window switches preserve the goal/evidence identity while recalculating admission", () => {
	const payload = {
		messages: [{ role: "goal", goalContext: { objective: "ship the fix", criteria: [{ id: "c1", status: "open" }] } }],
		tools: [{ name: "read" }],
	};
	const large = contextProfileFor({ ...model, contextWindow: 131_072 }, 1);
	const small = contextProfileFor({ ...model, contextWindow: 32_768 }, 2);
	const a = buildContextAccounting(payload, large);
	const b = buildContextAccounting(payload, small);
	const aGoal = a.contributors.find((item) => item.kind === "goal_recovery");
	const bGoal = b.contributors.find((item) => item.kind === "goal_recovery");
	assert.equal(aGoal?.digest, bGoal?.digest);
	assert.notEqual(a.input_allowance_tokens, b.input_allowance_tokens);
});

test("aggregate admission extension aborts an oversized payload and never exposes raw context", async () => {
	const prior = process.env.CONTEXT_ADMISSION;
	const telemetry = process.env.TELEMETRY;
	process.env.CONTEXT_ADMISSION = "on";
	process.env.TELEMETRY = "off";
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/context-admission.ts?oversize=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		await fire(fp, "session_start", {}, { cwd: "/tmp", model });
		let aborted = 0;
		const payload = { messages: [{ role: "user", content: "x".repeat(200_000) }] };
		const result = await fire(fp, "before_provider_request", { payload }, {
			cwd: "/tmp", model, abort: () => { aborted += 1; },
		});
		assert.equal(aborted, 1);
		assert.deepEqual(result, payload, "guard observes and aborts; it never rewrites user content");
	} finally {
		if (prior === undefined) delete process.env.CONTEXT_ADMISSION; else process.env.CONTEXT_ADMISSION = prior;
		if (telemetry === undefined) delete process.env.TELEMETRY; else process.env.TELEMETRY = telemetry;
	}
});

test("aggregate admission remains inactive until explicitly enabled", async () => {
	const prior = process.env.CONTEXT_ADMISSION;
	delete process.env.CONTEXT_ADMISSION;
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/context-admission.ts?default-off=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		await fire(fp, "session_start", {}, { cwd: "/tmp", model });
		let aborted = 0;
		await fire(fp, "before_provider_request", { payload: { messages: [{ role: "user", content: "x".repeat(200_000) }] } }, {
			cwd: "/tmp", model, abort: () => { aborted += 1; },
		});
		assert.equal(aborted, 0);
	} finally {
		if (prior === undefined) delete process.env.CONTEXT_ADMISSION; else process.env.CONTEXT_ADMISSION = prior;
	}
});

test("malformed provider payloads fail closed instead of escaping as swallowed hook errors", async () => {
	const prior = process.env.CONTEXT_ADMISSION;
	process.env.CONTEXT_ADMISSION = "on";
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/context-admission.ts?malformed=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		await fire(fp, "session_start", {}, { cwd: "/tmp", model });
		const payload: Record<string, unknown> = { messages: [] };
		payload.self = payload;
		let aborted = 0;
		await fire(fp, "before_provider_request", { payload }, { cwd: "/tmp", model, abort: () => { aborted += 1; } });
		assert.equal(aborted, 1);
	} finally {
		if (prior === undefined) delete process.env.CONTEXT_ADMISSION; else process.env.CONTEXT_ADMISSION = prior;
	}
});

test("context epoch key binds provider, model, endpoint, declared, and served windows", () => {
	const a = contextProfileFor(model, 0);
	const b = contextProfileFor({ ...model, provider: "other" }, 0);
	const c = contextProfileFor({ ...model, baseUrl: ["http", "://127.0.0.1:9090/v1"].join("") }, 0);
	const d = withServingWindow(a, 16_384);
	assert.equal(new Set([contextEpochKey(a), contextEpochKey(b), contextEpochKey(c), contextEpochKey(d)]).size, 4);
});

test("admission telemetry carries safe digests and counts, never endpoints or private context", async () => {
	const root = await mkdtemp(join(tmpdir(), "context-admission-telemetry-"));
	const file = join(root, "events.jsonl");
	const prior = Object.fromEntries(["CONTEXT_ADMISSION", "TELEMETRY", "TELEMETRY_FILE", "TELEMETRY_SOURCE"].map((key) => [key, process.env[key]]));
	Object.assign(process.env, { CONTEXT_ADMISSION: "on", TELEMETRY: "1", TELEMETRY_FILE: file, TELEMETRY_SOURCE: "test" });
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/context-admission.ts?telemetry=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		await fire(fp, "session_start", {}, { cwd: "/tmp", model });
		await fire(fp, "before_provider_request", { payload: { messages: [{ role: "user", content: "private objective" }] } }, {
			cwd: "/tmp", model, getContextUsage: () => ({ tokens: 12, contextWindow: 32_768 }),
		});
		const row = JSON.parse((await readFile(file, "utf8")).trim());
		assert.equal(row.ext, "context-admission");
		assert.equal(row.kind, "admitted");
		assert.equal(typeof row.payload_bytes, "number");
		assert.match(row.request_digest, /^[0-9a-f]{64}$/);
		assert.doesNotMatch(JSON.stringify(row), /127\.0\.0\.1|private objective/);
	} finally {
		for (const [key, value] of Object.entries(prior)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value as string;
		}
		await rm(root, { recursive: true, force: true });
	}
});

test("admission coordinator accounts producer reservations and releases them at tool finalization", async () => {
	const prior = Object.fromEntries(["CONTEXT_ADMISSION", "TELEMETRY", "TELEMETRY_FILE", "TELEMETRY_SOURCE"].map((key) => [key, process.env[key]]));
	process.env.CONTEXT_ADMISSION = "on";
	process.env.TELEMETRY = "off";
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/context-admission.ts?reservation=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		await fire(fp, "session_start", {}, { cwd: "/tmp", model });
		const reservation = reserveContextOutput("tool-1", 500);
		assert.equal(reservation?.ok, true);
		await fire(fp, "before_provider_request", { payload: { messages: [{ role: "user", content: "small" }] } }, { cwd: "/tmp", model });
		const accounting = (globalThis as Record<string, any>).__pi_context_accounting;
		assert.equal(accounting.reserved_tokens, 500);
		assert.equal(accounting.reservation_count, 1);
		await fire(fp, "tool_result", { toolCallId: "tool-1" }, { cwd: "/tmp", model });
		await fire(fp, "before_provider_request", { payload: { messages: [{ role: "user", content: "small" }] } }, { cwd: "/tmp", model });
		assert.equal((globalThis as Record<string, any>).__pi_context_accounting.reserved_tokens, 0);
	} finally {
		for (const [key, value] of Object.entries(prior)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value as string;
		}
		delete (globalThis as Record<string, unknown>).__pi_context_reservation_v1;
		delete (globalThis as Record<string, unknown>).__pi_context_accounting;
	}
});
