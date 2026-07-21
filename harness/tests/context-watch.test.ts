import assert from "node:assert/strict";
import test from "node:test";
import { decide, readWatcherConfig } from "../lib/context-watch.ts";
import { registerContextWatcher } from "../extensions/context-watcher.ts";

// Run: cd ~/.pi/agent && npx -y tsx --test tests/context-watch.test.ts

const T = 70;
const R = 55;

test("watcher config accepts only the experiment contract and fails typos to safe defaults", () => {
	assert.deepEqual(readWatcherConfig({ CONTEXT_WATCHER: "off", CTX_WATCH_PCT: "60" }),
		{ enabled: false, thresholdPct: 60, rearmPct: 45 });
	assert.deepEqual(readWatcherConfig({ CONTEXT_WATCHER: "maybe", CTX_WATCH_PCT: "70junk" }),
		{ enabled: true, thresholdPct: 70, rearmPct: 55 });
	assert.equal(readWatcherConfig({ CTX_WATCH_PCT: "75" }).thresholdPct, 70);
});

test("fires once at threshold, then disarms", () => {
	assert.deepEqual(decide(70, true, T, R), { compact: true, armed: false });
	assert.deepEqual(decide(85, true, T, R), { compact: true, armed: false });
});

test("does not re-fire while still high and disarmed", () => {
	assert.deepEqual(decide(90, false, T, R), { compact: false, armed: false });
	assert.deepEqual(decide(72, false, T, R), { compact: false, armed: false });
});

test("re-arms only after dropping below rearm band", () => {
	assert.deepEqual(decide(60, false, T, R), { compact: false, armed: false }); // 60 ≥ rearm 55 → still disarmed
	assert.deepEqual(decide(54, false, T, R), { compact: false, armed: true }); // < 55 → re-armed
});

test("below threshold while armed does nothing", () => {
	assert.deepEqual(decide(50, true, T, R), { compact: false, armed: true });
	assert.deepEqual(decide(69, true, T, R), { compact: false, armed: true });
});

test("null/NaN percent is a no-op (preserves armed state)", () => {
	assert.deepEqual(decide(null, true, T, R), { compact: false, armed: true });
	assert.deepEqual(decide(null, false, T, R), { compact: false, armed: false });
	assert.deepEqual(decide(Number.NaN, true, T, R), { compact: false, armed: true });
});

test("full thrash cycle: fire → stay quiet → re-arm → fire again", () => {
	let a = true;
	let r = decide(75, a, T, R); a = r.armed;
	assert.equal(r.compact, true); // fired
	r = decide(40, a, T, R); a = r.armed; // post-compaction drop → re-arm
	assert.equal(a, true);
	r = decide(71, a, T, R); a = r.armed;
	assert.equal(r.compact, true); // fires again on next climb
});

function mockPi() {
	const handlers = new Map<string, Function>();
	const sent: unknown[] = [];
	return {
		api: {
			on(name: string, handler: Function) { handlers.set(name, handler); },
			sendMessage(message: unknown, options: unknown) { sent.push({ message, options }); },
		},
		handlers,
		sent,
	};
}

test("disabled watcher observes native compaction without requesting one", async () => {
	const { api, handlers, sent } = mockPi();
	const telemetry: Array<{ kind: string; detail: Record<string, unknown> }> = [];
	registerContextWatcher(
		api as never,
		{ enabled: false, thresholdPct: 70, rearmPct: 55 },
		(_ext, kind, detail) => { telemetry.push({ kind, detail: detail ?? {} }); },
	);
	let compactRequests = 0;
	const ctx = {
		getContextUsage: () => ({ tokens: 600, contextWindow: 1000, percent: 60 }),
		compact: () => { compactRequests += 1; },
		ui: { notify() {} },
	};
	await handlers.get("session_start")?.({ reason: "startup" }, ctx);
	await handlers.get("turn_end")?.({ toolResults: [{}] }, ctx);
	await handlers.get("session_compact")?.({
		fromExtension: false,
		reason: "threshold",
		willRetry: false,
		compactionEntry: { tokensBefore: 900 },
	}, ctx);
	assert.equal(compactRequests, 0);
	assert.equal(sent.length, 0);
	const observed = telemetry.find((e) => e.kind === "compacted");
	assert.deepEqual(observed?.detail, {
		requester: "pi", contentProvider: "pi", reason: "threshold", willRetry: false,
		enabled: false, thresholdPct: 70, rearmPct: 55, tokensBefore: 900,
		contextTokens: 600, contextWindow: 1000, contextPct: 60,
	});
});

test("extension-supplied summary content is not misreported as the requester", async () => {
	const { api, handlers } = mockPi();
	const telemetry: Array<{ kind: string; detail: Record<string, unknown> }> = [];
	registerContextWatcher(
		api as never,
		{ enabled: false, thresholdPct: 70, rearmPct: 55 },
		(_ext, kind, detail) => { telemetry.push({ kind, detail: detail ?? {} }); },
	);
	const ctx = { getContextUsage: () => ({ tokens: 400, contextWindow: 1000, percent: 40 }) };
	await handlers.get("session_compact")?.({
		fromExtension: true, reason: "manual", willRetry: false,
		compactionEntry: { tokensBefore: 800 },
	}, ctx);
	const observed = telemetry.find((event) => event.kind === "compacted")?.detail;
	assert.equal(observed?.requester, "manual-unknown");
	assert.equal(observed?.contentProvider, "extension");
});

test("watcher completion resumes exactly once only after a tool-bearing turn", async () => {
	const { api, handlers, sent } = mockPi();
	registerContextWatcher(api as never, { enabled: true, thresholdPct: 70, rearmPct: 55 }, () => {});
	let options: { onComplete?: (r: unknown) => void } | undefined;
	const ctx = {
		getContextUsage: () => ({ tokens: 750, contextWindow: 1000, percent: 75 }),
		compact: (o: typeof options) => { options = o; },
		ui: { notify() {} },
	};
	await handlers.get("turn_end")?.({ toolResults: [{}] }, ctx);
	options?.onComplete?.({ tokensBefore: 750, estimatedTokensAfter: 300 });
	options?.onComplete?.({ tokensBefore: 750, estimatedTokensAfter: 300 });
	assert.equal(sent.length, 1);

	const second = mockPi();
	registerContextWatcher(second.api as never, { enabled: true, thresholdPct: 70, rearmPct: 55 }, () => {});
	let finalOptions: typeof options;
	await second.handlers.get("turn_end")?.({ toolResults: [] }, { ...ctx, compact: (o: typeof options) => { finalOptions = o; } });
	finalOptions!.onComplete?.({ tokensBefore: 750, estimatedTokensAfter: 300 });
	assert.equal(second.sent.length, 0);
});

test("watcher failure resumes a tool-bearing turn exactly once", async () => {
	const { api, handlers, sent } = mockPi();
	const telemetry: string[] = [];
	registerContextWatcher(
		api as never,
		{ enabled: true, thresholdPct: 70, rearmPct: 55 },
		(_ext, kind) => { telemetry.push(kind); },
	);
	let options: { onError?: (e: Error) => void } | undefined;
	const ctx = {
		getContextUsage: () => ({ tokens: 750, contextWindow: 1000, percent: 75 }),
		compact: (o: typeof options) => { options = o; },
		ui: { notify() {} },
	};
	await handlers.get("turn_end")?.({ toolResults: [{}] }, ctx);
	options?.onError?.(new Error("summary failed"));
	options?.onError?.(new Error("summary failed again"));
	assert.equal(sent.length, 1);
	assert.equal(telemetry.filter((kind) => kind === "compact-failed").length, 1);
});

test("onComplete survives a stale ctx (session replaced mid-callback) without crashing", async () => {
	const { api, handlers, sent } = mockPi();
	registerContextWatcher(api as never, { enabled: true, thresholdPct: 70, rearmPct: 55 }, () => {});
	let options: { onComplete?: (r: unknown) => void } | undefined;
	let calls = 0;
	const ctx = {
		getContextUsage: () => {
			calls += 1;
			if (calls > 1) throw new Error("This extension ctx is stale after session replacement or reload.");
			return { tokens: 750, contextWindow: 1000, percent: 75 };
		},
		compact: (o: typeof options) => { options = o; },
		ui: { notify() {} },
	};
	await handlers.get("turn_end")?.({ toolResults: [{}] }, ctx);
	assert.doesNotThrow(() => options?.onComplete?.({ tokensBefore: 750, estimatedTokensAfter: 300 }));
	assert.equal(sent.length, 1, "resume still fires even when the post-compaction usage read fails");
});

test("onError survives a stale ctx (session replaced mid-callback) without crashing", async () => {
	const { api, handlers, sent } = mockPi();
	registerContextWatcher(api as never, { enabled: true, thresholdPct: 70, rearmPct: 55 }, () => {});
	let options: { onError?: (e: Error) => void } | undefined;
	let calls = 0;
	const ctx = {
		getContextUsage: () => {
			calls += 1;
			if (calls > 1) throw new Error("This extension ctx is stale after session replacement or reload.");
			return { tokens: 750, contextWindow: 1000, percent: 75 };
		},
		compact: (o: typeof options) => { options = o; },
		ui: { notify() {} },
	};
	await handlers.get("turn_end")?.({ toolResults: [{}] }, ctx);
	assert.doesNotThrow(() => options?.onError?.(new Error("Request was aborted.")));
	assert.equal(sent.length, 1, "resume still fires even when the post-compaction usage read fails");
});

test("onComplete survives a stale pi.sendMessage (session replaced mid-callback) without crashing", async () => {
	// Reproduces the exact production crash: ctx.getContextUsage succeeds, but
	// pi.sendMessage itself throws the same "stale after session replacement"
	// error — a distinct failure point from ctx, requiring its own try/catch.
	const handlers = new Map<string, Function>();
	const api = {
		on(name: string, handler: Function) { handlers.set(name, handler); },
		sendMessage() { throw new Error("This extension ctx is stale after session replacement or reload."); },
	};
	registerContextWatcher(api as never, { enabled: true, thresholdPct: 70, rearmPct: 55 }, () => {});
	let options: { onComplete?: (r: unknown) => void } | undefined;
	const ctx = {
		getContextUsage: () => ({ tokens: 750, contextWindow: 1000, percent: 75 }),
		compact: (o: typeof options) => { options = o; },
		ui: { notify() {} },
	};
	await handlers.get("turn_end")?.({ toolResults: [{}] }, ctx);
	assert.doesNotThrow(() => options?.onComplete?.({ tokensBefore: 750, estimatedTokensAfter: 300 }));
});

test("onError survives a stale pi.sendMessage (session replaced mid-callback) without crashing", async () => {
	const handlers = new Map<string, Function>();
	const api = {
		on(name: string, handler: Function) { handlers.set(name, handler); },
		sendMessage() { throw new Error("This extension ctx is stale after session replacement or reload."); },
	};
	registerContextWatcher(api as never, { enabled: true, thresholdPct: 70, rearmPct: 55 }, () => {});
	let options: { onError?: (e: Error) => void } | undefined;
	const ctx = {
		getContextUsage: () => ({ tokens: 750, contextWindow: 1000, percent: 75 }),
		compact: (o: typeof options) => { options = o; },
		ui: { notify() {} },
	};
	await handlers.get("turn_end")?.({ toolResults: [{}] }, ctx);
	assert.doesNotThrow(() => options?.onError?.(new Error("Request was aborted.")));
});

test("watcher ignores an old compaction callback after session replacement", async () => {
	const { api, handlers, sent } = mockPi();
	registerContextWatcher(api as never, { enabled: true, thresholdPct: 70, rearmPct: 55 }, () => {});
	let staleOptions: any;
	const ctx = {
		getContextUsage: () => ({ tokens: 750, contextWindow: 1000, percent: 75 }),
		compact: (options: unknown) => { staleOptions = options; },
		ui: { notify() {} },
	};
	await handlers.get("turn_end")?.({ toolResults: [{}] }, ctx);
	await handlers.get("session_start")?.({ reason: "new" }, ctx);
	staleOptions.onComplete({ tokensBefore: 750, estimatedTokensAfter: 300 });
	assert.equal(sent.length, 0);
});
