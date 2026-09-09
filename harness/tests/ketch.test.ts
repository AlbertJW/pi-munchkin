import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	buildKetchEnv,
	formatJinaReaderUrl,
	formatReadResults,
	formatSearchResults,
	ketchInstallHint,
	parseReadResults,
	parseSearchResults,
	parseSemver,
	runKetchProcess,
	unwrapJinaReaderUrl,
	versionAtLeast,
} from "../lib/ketch-runtime.ts";
import { RESEARCH_COVERAGE_KEY } from "../lib/branch-report.ts";
import { RESEARCH_EVIDENCE_CARDS_KEY } from "../lib/research-evidence.ts";
import { createResearchAggregate, deadlineFor, readResearchAggregate, researchAggregatePath, writeResearchAggregate } from "../lib/research-aggregate.ts";
import { callTool, fire, makeFakePi, resetPiGlobals } from "./integration-harness.ts";

function restoreEnv(snapshot: Record<string, string | undefined>): void {
	for (const [key, value] of Object.entries(snapshot)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

function mockKetch(dir: string): string {
	const file = join(dir, "ketch-mock");
	writeFileSync(file, `#!/bin/sh
case "$1" in
  version) printf 'ketch v0.12.0\\n' ;;
  search)
    case " $* " in
      *" --backend ddg "*) printf 'ddg unavailable\\n' >&2; exit 4 ;;
      *" --backend exa "*) printf '[{"title":"Primary result","url":"https://example.com/a","description":"bounded snippet"}]\\n' ;;
      *" --multi="*) printf '[{"title":"Consensus result","url":"https://example.com/b","description":"two engines","backends":["exa","keenable"]}]\\n' ;;
      *) exit 2 ;;
    esac ;;
  scrape) printf '{"url":"https://example.com/a","title":"A page","markdown":"Useful source text"}\\n' ;;
  doctor) printf '[{"surface":"search","backend":"ddg","status":"ok"}]\\n' ;;
  *) exit 2 ;;
esac
`);
	chmodSync(file, 0o755);
	return file;
}

test("direct reader cannot cache an unrequested source", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ketch-source-binding-"));
	const prior = Object.fromEntries(["KETCH_BIN", "RESEARCH_LEDGER", "PI_CODING_AGENT_DIR", "TELEMETRY"].map((key) => [key, process.env[key]]));
	try {
		Object.assign(process.env, { KETCH_BIN: mockKetch(dir), RESEARCH_LEDGER: "on", PI_CODING_AGENT_DIR: join(dir, "agent"), TELEMETRY: "off" });
		const fp = makeFakePi();
		const mod = await import(`../extensions/ketch.ts?binding=${Math.random()}`);
		mod.registerKetch(fp.pi as never, { resolvePublicUrl: async (url: string) => url });
		const result = await callTool(fp, "web_read", { urls: ["https://example.com/b"] }, dir);
		assert.equal(result.details.failed, 1);
		const note = await callTool(fp, "research_note", { claim: "claim", url: "https://example.com/a", quote: "Useful source text" }, dir);
		assert.equal(note.details.evidence_card, undefined);
	} finally { restoreEnv(prior); rmSync(dir, { recursive: true, force: true }); resetPiGlobals(); }
});

test("cancellation never starts the Jina fallback", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ketch-cancel-"));
	const prior = Object.fromEntries(["KETCH_BIN", "JINA_READER", "TELEMETRY"].map((key) => [key, process.env[key]]));
	try {
		Object.assign(process.env, { KETCH_BIN: mockKetch(dir), JINA_READER: "on", TELEMETRY: "off" });
		const fp = makeFakePi();
		const controller = new AbortController();
		const mod = await import(`../extensions/ketch.ts?cancel=${Math.random()}`);
		mod.registerKetch(fp.pi as never, { resolvePublicUrl: async (url: string) => { controller.abort(); return url; } });
		const result = await fp.tools.get("web_read")!.execute("cancel", { urls: ["https://example.com/a"] }, controller.signal, undefined, { cwd: dir });
		assert.equal((result.details as any).fallback, false);
		assert.equal((result.details as any).outcome, "aborted");
	} finally { restoreEnv(prior); rmSync(dir, { recursive: true, force: true }); resetPiGlobals(); }
});

test("Ketch version and JSON normalizers are strict, compact, and source-preserving", () => {
	assert.deepEqual(parseSemver("ketch v0.12.0"), [0, 12, 0]);
	assert.equal(versionAtLeast([0, 12, 0]), true);
	assert.equal(versionAtLeast([0, 11, 9]), false);
	const search = parseSearchResults(JSON.stringify([
		{ title: "Result", url: "https://example.com", description: "line\n two", backends: ["ddg", "exa"] },
		{ title: "unsafe", url: "file:///etc/passwd" },
		{ title: "credentials", url: "https://user:pass@example.com/private" },
		{ title: "malformed", url: "https://exa\nmple.com" },
	]));
	assert.equal(search.length, 1);
	assert.match(formatSearchResults(search).text, /URL: https:\/\/example\.com/);
	assert.throws(() => parseSearchResults("not json"), /malformed JSON/);

	const read = parseReadResults(JSON.stringify({ url: "https://example.com", title: "Page", markdown: "body" }));
	assert.equal(read.length, 1);
	assert.match(formatReadResults(read).text, /SOURCE 1[\s\S]*Text:\nbody/);
	const many = Array.from({ length: 5 }, (_, index) => ({
		title: `Page ${index + 1}`, url: `https://example.com/${index + 1}`, markdown: "x".repeat(4_000),
	}));
	const bounded = formatReadResults(many, 2_000);
	assert.ok(bounded.truncated);
	assert.ok(bounded.text.length <= 2_000);
	assert.match(bounded.text, /URL: https:\/\/example\.com\/5/);

	// M2: with LONG URLs at the 2000 floor, every source's header+URL must
	// still survive (a prior version blind-sliced the joined text and dropped
	// whole later sources). Citation integrity wins even if the block overflows.
	const longUrls = Array.from({ length: 5 }, (_, index) => ({
		title: `P${index + 1}`, url: `https://example.com/${String(index + 1).repeat(700)}`, markdown: "body",
	}));
	const long = formatReadResults(longUrls, 2_000);
	for (const row of longUrls) {
		assert.ok(long.text.includes(`URL: ${row.url}`), `every URL must survive: ${row.url.slice(0, 40)}…`);
	}
	assert.ok(long.text.includes("SOURCE 5"), "no later source may be dropped");
});

test("Jina Reader URL formatting is static, idempotent, and rejects unsafe inputs", () => {
	assert.equal(formatJinaReaderUrl("https://example.com/path?q=1#fragment"), "https://r.jina.ai/https://example.com/path?q=1");
	assert.equal(formatJinaReaderUrl("https://r.jina.ai/https://example.com/path?q=1"), "https://r.jina.ai/https://example.com/path?q=1");
	assert.equal(unwrapJinaReaderUrl("https://r.jina.ai/https://example.com/path?q=1"), "https://example.com/path?q=1");
	assert.equal(unwrapJinaReaderUrl("https://example.com/path"), null);
	assert.throws(() => formatJinaReaderUrl("file:///etc/passwd"), /HTTP\(S\)/);
	assert.throws(() => formatJinaReaderUrl("https://user:pass@example.com/private"), /credentials/);
});

test("Ketch child environment excludes unrelated model and shell credentials", () => {
	const env = buildKetchEnv({
		PATH: "/bin", HOME: "/tmp/home", KETCH_BRAVE_API_KEY: "intentional-ketch-key",
		OPENROUTER_API_KEY: "do-not-pass", AWS_SECRET_ACCESS_KEY: "do-not-pass", BASH_ENV: "/tmp/hook",
	});
	assert.equal(env.PATH, "/bin");
	assert.equal(env.KETCH_BRAVE_API_KEY, "intentional-ketch-key");
	assert.equal(env.OPENROUTER_API_KEY, undefined);
	assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
	assert.equal(env.BASH_ENV, undefined);
});

test("ketchInstallHint: brew on macOS, the cross-platform script everywhere else", () => {
	// 2026-07-22: a Linux install hit "Install it with: brew install ..." — a
	// dead end with no brew. macOS keeps the brew instructions unchanged.
	assert.equal(ketchInstallHint("install", "darwin"), "brew install 1broseidon/tap/ketch");
	assert.equal(ketchInstallHint("upgrade", "darwin"), "brew upgrade 1broseidon/tap/ketch");
	for (const platform of ["linux", "win32", "freebsd"]) {
		const hint = ketchInstallHint("install", platform);
		assert.ok(!hint.includes("brew"), `${platform} hint must not suggest brew: ${hint}`);
		assert.ok(hint.includes("install-deps.sh"), `${platform} hint must point at the install script: ${hint}`);
	}
});

test("bounded process reports timeout and spawn errors instead of semantic success", async () => {
	const timed = await runKetchProcess(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { timeoutMs: 50, env: buildKetchEnv() });
	assert.equal(timed.timedOut, true);
	assert.notEqual(timed.code, 0);
	const missing = await runKetchProcess(join(tmpdir(), `missing-ketch-${Date.now()}`), [], { timeoutMs: 100, env: buildKetchEnv() });
	assert.ok(missing.spawnError);
});

test("extension is default-on with two tools; quick search falls back and broad search stays compact", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ketch-ext-"));
	const snapshot = Object.fromEntries(["KETCH", "KETCH_BIN", "KETCH_BACKEND", "KETCH_MULTI_BACKENDS", "TELEMETRY_FILE", "TELEMETRY_SOURCE", "TELEMETRY_STRICT"].map((key) => [key, process.env[key]]));
	try {
		delete process.env.KETCH;
		delete (globalThis as Record<string, unknown>)[RESEARCH_COVERAGE_KEY];
		process.env.KETCH_BIN = mockKetch(dir);
		process.env.KETCH_BACKEND = "ddg";
		process.env.KETCH_MULTI_BACKENDS = "ddg,exa,keenable";
		process.env.TELEMETRY_FILE = join(dir, "events.jsonl");
		process.env.TELEMETRY_SOURCE = "test";
		process.env.TELEMETRY_STRICT = "1";
		const fp = makeFakePi();
		(await import(`../extensions/ketch.ts?default=${Date.now()}-${Math.random()}`)).default(fp.pi as never);
		assert.deepEqual([...fp.tools.keys()].sort(), ["web_read", "web_search"]);

		const quick = await callTool(fp, "web_search", { query: "test", mode: "quick", limit: 3 }, dir);
		const quickText = quick.content[0].text;
		assert.match(quickText, /Primary result/);
		// Coverage is machine-readable details only at the default dark posture: the
		// model-visible render is gated behind PLAN_GRAPH=on (merge-review finding).
		assert.doesNotMatch(quickText, /retrieval coverage:/);
		assert.deepEqual(quick.details.backends, ["exa"]);
		assert.deepEqual(quick.details.coverage, {
			strategy: "direct", scope: "exhaustive", returned_count: 1, total_count: 1,
			truncated: false, budget_exhausted: false, failed: false, complete: true,
		});
		assert.deepEqual((globalThis as Record<string, unknown>)[RESEARCH_COVERAGE_KEY], {
			calls: 1, returned_count: 1, incomplete: false, truncated: false, failed: false, budget_exhausted: false,
		}, "the process-local observation must reflect the executed tool receipt only");

		const broad = await callTool(fp, "web_search", { query: "test", mode: "broad" }, dir);
		assert.match(broad.content[0].text, /Consensus result/);
		assert.deepEqual(broad.details.backends, ["exa", "keenable"]);
		assert.equal(broad.details.coverage.complete, true);
		const capped = await callTool(fp, "web_search", { query: "test", mode: "quick", limit: 1 }, dir);
		assert.deepEqual(capped.details.coverage, {
			strategy: "direct", scope: "bounded", returned_count: 1,
			truncated: true, budget_exhausted: false, failed: false, complete: false,
		});
		const events = readFileSync(process.env.TELEMETRY_FILE, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		assert.equal(events.filter((row) => row.ext === "ketch" && row.kind === "search").length, 3);
		assert.ok(events.every((row) => !JSON.stringify(row).includes("Primary result")));
	} finally {
		restoreEnv(snapshot);
		rmSync(dir, { recursive: true, force: true });
		delete (globalThis as Record<string, unknown>)[RESEARCH_COVERAGE_KEY];
	}
});

test("web search reserves aggregate context before invoking the network adapter", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ketch-context-reservation-"));
	const snapshot = Object.fromEntries(["KETCH", "KETCH_BIN", "KETCH_BACKEND", "CONTEXT_ADMISSION", "TELEMETRY", "TELEMETRY_FILE", "TELEMETRY_SOURCE"].map((key) => [key, process.env[key]]));
	try {
		delete process.env.KETCH;
		process.env.KETCH_BIN = mockKetch(dir);
		process.env.KETCH_BACKEND = "exa";
		process.env.CONTEXT_ADMISSION = "on";
		process.env.TELEMETRY = "off";
		const fp = makeFakePi();
		const admission = await import(`../extensions/context-admission.ts?ketch-reservation=${Date.now()}-${Math.random()}`);
		admission.default(fp.pi as never);
		const mod = await import(`../extensions/ketch.ts?context-reservation=${Date.now()}-${Math.random()}`);
		mod.registerKetch(fp.pi as never, { resolvePublicUrl: async (raw: string) => new URL(raw).toString() });
		// 2K is deliberately below the fixed search output reservation. The
		// producer must fail before checkVersion/search invokes the child process.
		const model = { provider: "local", id: "tiny", contextWindow: 2_048, baseUrl: "https://example.invalid/v1" };
		await fire(fp, "session_start", {}, { cwd: dir, model });
		const result = await callTool(fp, "web_search", { query: "must not run", limit: 1 }, dir);
		assert.equal(result.details.outcome, "context_budget_exhausted");
		assert.equal(result.isError, false);
	} finally {
		restoreEnv(snapshot);
		rmSync(dir, { recursive: true, force: true });
		delete (globalThis as Record<string, unknown>).__pi_context_reservation_v1;
		delete (globalThis as Record<string, unknown>).__pi_context_accounting;
		delete (globalThis as Record<string, unknown>).__pi_ketch_version_checks_v1;
	}
});

test("web read rejects on context budget before consuming its research allowance", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ketch-read-context-reservation-"));
	const snapshot = Object.fromEntries(["KETCH", "KETCH_BIN", "KETCH_BACKEND", "CONTEXT_ADMISSION", "RESEARCH_LEDGER", "RESEARCH_BUDGET", "TELEMETRY"].map((key) => [key, process.env[key]]));
	try {
		delete process.env.KETCH;
		process.env.KETCH_BIN = mockKetch(dir);
		process.env.KETCH_BACKEND = "exa";
		process.env.CONTEXT_ADMISSION = "on";
		delete process.env.RESEARCH_LEDGER;
		process.env.RESEARCH_BUDGET = "on";
		process.env.TELEMETRY = "off";
		const fp = makeFakePi();
		const admission = await import(`../extensions/context-admission.ts?ketch-read-reservation=${Date.now()}-${Math.random()}`);
		admission.default(fp.pi as never);
		const mod = await import(`../extensions/ketch.ts?context-read-reservation=${Date.now()}-${Math.random()}`);
		mod.registerKetch(fp.pi as never);
		const model = { provider: "local", id: "tiny-read", contextWindow: 1_024, baseUrl: "https://example.invalid/v1" };
		await fire(fp, "session_start", {}, { cwd: dir, model });
		const blocked = await callTool(fp, "web_read", { urls: ["https://example.com/a"], max_chars: 5_000 }, dir);
		assert.equal(blocked.details.outcome, "context_budget_exhausted");
		// Turning admission off lets the same call prove that the first rejection
		// did not consume the separate research budget unit.
		process.env.CONTEXT_ADMISSION = "off";
		const allowed = await callTool(fp, "web_read", { urls: ["https://example.com/a"], max_chars: 1_000 }, dir);
		assert.notEqual(allowed.details.outcome, "budget_exhausted");
	} finally {
		restoreEnv(snapshot);
		rmSync(dir, { recursive: true, force: true });
		delete (globalThis as Record<string, unknown>).__pi_context_reservation_v1;
		delete (globalThis as Record<string, unknown>).__pi_context_accounting;
		delete (globalThis as Record<string, unknown>).__pi_ketch_version_checks_v1;
	}
});

test("KETCH=off remains an explicit emergency kill switch", async () => {
	const previous = process.env.KETCH;
	try {
		process.env.KETCH = "off";
		const fp = makeFakePi();
		(await import(`../extensions/ketch.ts?off=${Date.now()}-${Math.random()}`)).default(fp.pi as never);
		assert.equal(fp.tools.size, 0);
	} finally {
		if (previous === undefined) delete process.env.KETCH;
		else process.env.KETCH = previous;
	}
});

test("planned research enforces assigned search and distinct-source read budgets before execution", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ketch-plan-budget-"));
	const contextPath = join(dir, "context.json");
	const snapshot = Object.fromEntries(["KETCH", "KETCH_BIN", "KETCH_BACKEND", "RESEARCH_LEDGER", "PI_MUNCHKIN_PLAN_CONTEXT_PATH", "TELEMETRY_FILE", "TELEMETRY_SOURCE"].map((key) => [key, process.env[key]]));
	try {
		delete process.env.KETCH;
		process.env.KETCH_BIN = mockKetch(dir);
		process.env.KETCH_BACKEND = "exa";
		process.env.RESEARCH_LEDGER = "on";
		process.env.PI_MUNCHKIN_PLAN_CONTEXT_PATH = contextPath;
		process.env.TELEMETRY_FILE = join(dir, "events.jsonl");
		process.env.TELEMETRY_SOURCE = "test";
		writeFileSync(contextPath, JSON.stringify({
			v: 1, profile: "deep-research", run_id: "budget-run", parent_item_id: "leaf", owner_ref: "a".repeat(24),
			depth: 2, budget: { searches: 1, reads: 1 }, limits: { max_depth: 2, max_children: 0 },
		}));
		const fp = makeFakePi();
		const mod = await import(`../extensions/ketch.ts?budget=${Date.now()}-${Math.random()}`);
		mod.registerKetch(fp.pi as never, { resolvePublicUrl: async (raw: string) => new URL(raw).toString() });
		await fp.handlers.get("session_start")?.[0]?.({}, { cwd: dir, ui: { notify() {} } });
		assert.equal((await callTool(fp, "web_search", { query: "first", limit: 3 }, dir)).details.coverage.budget_exhausted, false);
		const blockedSearch = await callTool(fp, "web_search", { query: "second", limit: 3 }, dir);
		assert.equal(blockedSearch.details.outcome, "budget_exhausted");
		assert.equal(blockedSearch.details.coverage.complete, false);
		const blockedRead = await callTool(fp, "web_read", { urls: ["https://example.com/a", "https://example.com/b"] }, dir);
		assert.equal(blockedRead.details.outcome, "budget_exhausted", "a two-source batch cannot fit a one-source remainder");
		assert.equal(blockedRead.details.coverage.budget_exhausted, true);
		assert.equal((globalThis as Record<string, any>).__pi_research_state.searches, 1);
		assert.equal((globalThis as Record<string, any>).__pi_research_state.reads, 0);
		delete process.env.PI_MUNCHKIN_PLAN_CONTEXT_PATH;
		(globalThis as Record<string, unknown>).__pi_active_plan_context = { run_id: "head", profile: "deep-research", settled: false };
		const blockedHeadSearch = await callTool(fp, "web_search", { query: "head must not multiply discovery", limit: 3 }, dir);
		assert.equal(blockedHeadSearch.details.outcome, "budget_exhausted");
		assert.equal((await callTool(fp, "web_read", { urls: ["https://example.com/a"] }, dir)).details.coverage.budget_exhausted, false,
			"the head keeps its separate validation-read allowance");
	} finally {
		restoreEnv(snapshot);
		rmSync(dir, { recursive: true, force: true });
		delete (globalThis as Record<string, unknown>).__pi_ketch_version_checks_v1;
		delete (globalThis as Record<string, unknown>).__pi_research_state;
		delete (globalThis as Record<string, unknown>).__pi_active_plan_context;
	}
});

test("parent research workflow retains the shared discovery envelope for local research", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ketch-parent-budget-"));
	const snapshot = Object.fromEntries(["KETCH", "KETCH_BIN", "KETCH_BACKEND", "RESEARCH_LEDGER", "DEEP_RESEARCH_PLANNING", "RESEARCH_WORKFLOW", "TELEMETRY"].map((key) => [key, process.env[key]]));
	try {
		delete process.env.KETCH;
		Object.assign(process.env, { KETCH_BIN: mockKetch(dir), KETCH_BACKEND: "exa", RESEARCH_LEDGER: "on", DEEP_RESEARCH_PLANNING: "on", RESEARCH_WORKFLOW: "parent", TELEMETRY: "off" });
		const fp = makeFakePi();
		const mod = await import(`../extensions/ketch.ts?parent-budget=${Date.now()}-${Math.random()}`);
		mod.registerKetch(fp.pi as never, { resolvePublicUrl: async (raw: string) => new URL(raw).toString() });
		await fp.handlers.get("session_start")?.[0]?.({}, { cwd: dir, ui: { notify() {} } });
		(globalThis as Record<string, unknown>).__pi_active_plan_context = { run_id: "parent-run", profile: "deep-research", settled: false };
		const result = await callTool(fp, "web_search", { query: "parent-owned discovery", limit: 3 }, dir);
		assert.equal(result.details.coverage.budget_exhausted, false);
		assert.equal(result.details.coverage.complete, true);
		assert.equal((globalThis as Record<string, any>).__pi_research_state.searches, 1);
	} finally {
		restoreEnv(snapshot);
		rmSync(dir, { recursive: true, force: true });
		delete (globalThis as Record<string, unknown>).__pi_active_plan_context;
		delete (globalThis as Record<string, unknown>).__pi_research_state;
		resetPiGlobals();
	}
});

test("parent research hard deadline pauses discovery before another provider call", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ketch-parent-deadline-"));
	const snapshot = Object.fromEntries(["KETCH", "KETCH_BIN", "KETCH_BACKEND", "RESEARCH_LEDGER", "DEEP_RESEARCH_PLANNING", "RESEARCH_WORKFLOW", "PI_CODING_AGENT_DIR", "TELEMETRY"].map((key) => [key, process.env[key]]));
	try {
		delete process.env.KETCH;
		Object.assign(process.env, { KETCH_BIN: mockKetch(dir), KETCH_BACKEND: "exa", RESEARCH_LEDGER: "on", DEEP_RESEARCH_PLANNING: "on", RESEARCH_WORKFLOW: "parent", PI_CODING_AGENT_DIR: join(dir, "agent"), TELEMETRY: "off" });
		const runId = "deadline-run";
		const aggregatePath = researchAggregatePath(dir, runId, process.env);
		const expired = createResearchAggregate({ run_id: runId, phase: "active", graph: {}, evidence_round: { run_id: runId }, budget: { searches: 3, reads: 5, validation_reads: 5 }, deadline: deadlineFor(Date.now() - 11 * 60_000) });
		await writeResearchAggregate(aggregatePath, expired);
		const fp = makeFakePi();
		const mod = await import(`../extensions/ketch.ts?parent-deadline=${Date.now()}-${Math.random()}`);
		mod.registerKetch(fp.pi as never, { resolvePublicUrl: async (raw: string) => new URL(raw).toString() });
		await fp.handlers.get("session_start")?.[0]?.({}, { cwd: dir, ui: { notify() {} } });
		(globalThis as Record<string, unknown>).__pi_active_plan_context = { run_id: runId, profile: "deep-research", settled: false };
		const result = await callTool(fp, "web_search", { query: "must not run after deadline", limit: 3 }, dir);
		assert.equal(result.details.outcome, "awaiting_extension");
		assert.equal((await readResearchAggregate(aggregatePath))?.phase, "awaiting_extension");
	} finally {
		restoreEnv(snapshot);
		rmSync(dir, { recursive: true, force: true });
		delete (globalThis as Record<string, unknown>).__pi_active_plan_context;
		delete (globalThis as Record<string, unknown>).__pi_research_state;
		resetPiGlobals();
	}
});

test("opt-in Jina Reader mode rewrites only the fetch URL and restores the cited source URL", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ketch-jina-reader-"));
	const argFile = join(dir, "scrape-args.txt");
	const mock = join(dir, "ketch-jina");
	writeFileSync(mock, `#!/bin/sh
case "$1" in
  version) printf 'ketch v0.12.0\\n' ;;
  scrape) shift; printf '%s\\n' "$*" > "$KETCH_ARGFILE"; printf '{"url":"https://r.jina.ai/https://example.com/a","title":"Reader page","markdown":"Jina-normalized source text"}\\n' ;;
  *) exit 2 ;;
esac
`);
	chmodSync(mock, 0o755);
	const snapshot = Object.fromEntries(["KETCH", "KETCH_BIN", "JINA_READER", "KETCH_ARGFILE", "TELEMETRY_FILE", "TELEMETRY_SOURCE"].map((key) => [key, process.env[key]]));
	try {
		delete process.env.KETCH;
		process.env.KETCH_BIN = mock;
		process.env.JINA_READER = "on";
		process.env.KETCH_ARGFILE = argFile;
		process.env.TELEMETRY_FILE = join(dir, "events.jsonl");
		process.env.TELEMETRY_SOURCE = "test";
		const fp = makeFakePi();
		const mod = await import(`../extensions/ketch.ts?jina=${Date.now()}-${Math.random()}`);
		mod.registerKetch(fp.pi as never, { resolvePublicUrl: async (raw: string) => new URL(raw).toString() });
		const out = await callTool(fp, "web_read", { urls: ["https://example.com/a"], reader: "jina" }, dir);
		assert.equal(out.details.reader, "jina");
		assert.match(out.content[0].text, /URL: https:\/\/example\.com\/a/);
		assert.doesNotMatch(out.content[0].text, /URL: https:\/\/r\.jina\.ai\//);
		assert.match(readFileSync(argFile, "utf8"), /https:\/\/r\.jina\.ai\/https:\/\/example\.com\/a/);
	} finally {
		restoreEnv(snapshot);
		rmSync(dir, { recursive: true, force: true });
		delete (globalThis as Record<string, unknown>).__pi_ketch_version_checks_v1;
		delete (globalThis as Record<string, unknown>)[RESEARCH_COVERAGE_KEY];
	}
});

test("Jina Reader is one bounded fallback after direct extraction fails", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ketch-jina-fallback-"));
	const counter = join(dir, "scrape-count");
	const mock = join(dir, "ketch-fallback");
	writeFileSync(mock, `#!/bin/sh
case "$1" in
  version) printf 'ketch v0.12.0\\n' ;;
  scrape)
    if [ ! -f "$KETCH_COUNT" ]; then touch "$KETCH_COUNT"; exit 7; fi
    printf '{"url":"https://r.jina.ai/https://example.com/a","title":"Reader page","markdown":"fallback text"}\\n' ;;
  *) exit 2 ;;
esac
`);
	chmodSync(mock, 0o755);
	const snapshot = Object.fromEntries(["KETCH", "KETCH_BIN", "JINA_READER", "KETCH_COUNT", "TELEMETRY_FILE", "TELEMETRY_SOURCE"].map((key) => [key, process.env[key]]));
	try {
		delete process.env.KETCH;
		process.env.KETCH_BIN = mock;
		process.env.JINA_READER = "on";
		process.env.KETCH_COUNT = counter;
		process.env.TELEMETRY_FILE = join(dir, "events.jsonl");
		process.env.TELEMETRY_SOURCE = "test";
		const fp = makeFakePi();
		const mod = await import(`../extensions/ketch.ts?jina-fallback=${Date.now()}-${Math.random()}`);
		mod.registerKetch(fp.pi as never, { resolvePublicUrl: async (raw: string) => new URL(raw).toString() });
		const out = await callTool(fp, "web_read", { urls: ["https://example.com/a"] }, dir);
		assert.equal(out.isError, false);
		assert.equal(out.details.reader, "jina");
		assert.equal(out.details.fallback, true);
		assert.match(out.content[0].text, /URL: https:\/\/example\.com\/a/);
		assert.doesNotMatch(out.content[0].text, /r\.jina\.ai/);
	} finally {
		restoreEnv(snapshot);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("verified research notes publish compact evidence cards without page content", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ketch-evidence-card-"));
	const snapshot = Object.fromEntries(["KETCH", "KETCH_BIN", "RESEARCH_LEDGER", "PI_CODING_AGENT_DIR", "TELEMETRY_FILE", "TELEMETRY_SOURCE"].map((key) => [key, process.env[key]]));
	try {
		delete process.env.KETCH;
		process.env.KETCH_BIN = mockKetch(dir);
		process.env.RESEARCH_LEDGER = "on";
		process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
		process.env.TELEMETRY_FILE = join(dir, "events.jsonl");
		process.env.TELEMETRY_SOURCE = "test";
		delete (globalThis as Record<string, unknown>)[RESEARCH_EVIDENCE_CARDS_KEY];
		const fp = makeFakePi();
		const mod = await import(`../extensions/ketch.ts?evidence=${Date.now()}-${Math.random()}`);
		mod.registerKetch(fp.pi as never, { resolvePublicUrl: async (raw: string) => new URL(raw).toString() });
		await fp.handlers.get("session_start")?.[0]?.({}, { cwd: dir, ui: { notify() {} } });
		await callTool(fp, "web_read", { urls: ["https://example.com/a"] }, dir);
		const note = await callTool(fp, "research_note", { claim: "The source is useful.", url: "https://example.com/a", quote: "Useful source text" }, dir);
		const card = (note.details as Record<string, any>).evidence_card;
		assert.equal(card.parent_validated, true);
		assert.equal(card.truncated, true, "unknown extraction completeness cannot close coverage");
		assert.equal(note.details.retrieval_receipt.completeness, "unknown");
		const cached = await callTool(fp, "web_read", { urls: ["https://example.com/a"] }, dir);
		assert.equal(cached.details.cache, true);
		assert.equal(cached.details.coverage.complete, false, "cache hits retain incomplete source coverage");
		assert.equal(card.original_url, "https://example.com/a");
		assert.match(card.content_sha256, /^[a-f0-9]{64}$/);
		assert.equal(JSON.stringify(note).includes("Useful source text"), false, "card details must not expose page content");
		assert.equal((globalThis as Record<string, any>)[RESEARCH_EVIDENCE_CARDS_KEY].length, 1);
	} finally {
		restoreEnv(snapshot);
		rmSync(dir, { recursive: true, force: true });
		delete (globalThis as Record<string, unknown>)[RESEARCH_EVIDENCE_CARDS_KEY];
	}
});

test("reader parser preserves complete, truncated and unknown extraction receipts", () => {
	const rows = parseReadResults(JSON.stringify([
		{ url: "https://example.com/a", markdown: "a", truncated: true },
		{ url: "https://example.com/b", markdown: "b", truncated: false },
		{ url: "https://example.com/c", markdown: "c" },
	]));
	assert.deepEqual(rows.map((row: any) => row.completeness), ["truncated", "complete", "unknown"]);
});

test("ledger sessions hard-stop the skill budget outside a plan graph", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ketch-ledger-budget-"));
	const snapshot = Object.fromEntries(["KETCH", "KETCH_BIN", "KETCH_BACKEND", "RESEARCH_LEDGER", "PI_MUNCHKIN_PLAN_CONTEXT_PATH", "TELEMETRY_FILE", "TELEMETRY_SOURCE"].map((key) => [key, process.env[key]]));
	try {
		delete process.env.KETCH;
		process.env.KETCH_BIN = mockKetch(dir);
		process.env.KETCH_BACKEND = "exa";
		process.env.RESEARCH_LEDGER = "on";
		delete process.env.PI_MUNCHKIN_PLAN_CONTEXT_PATH;
		process.env.TELEMETRY_FILE = join(dir, "events.jsonl");
		process.env.TELEMETRY_SOURCE = "test";
		delete (globalThis as Record<string, unknown>).__pi_active_plan_context;
		const fp = makeFakePi();
		(await import(`../extensions/ketch.ts?ledger-budget=${Date.now()}-${Math.random()}`)).default(fp.pi as never);
		await fp.handlers.get("session_start")?.[0]?.({}, { cwd: dir, ui: { notify() {} } });
		for (let i = 0; i < 3; i++) {
			const result = await callTool(fp, "web_search", { query: `bounded-${i}`, limit: 1 }, dir);
			assert.notEqual(result.details.outcome, "budget_exhausted");
		}
		const blocked = await callTool(fp, "web_search", { query: "fourth-search", limit: 1 }, dir);
		assert.equal(blocked.details.outcome, "budget_exhausted");
		assert.equal(blocked.details.coverage.budget_exhausted, true);
		assert.equal((globalThis as Record<string, any>).__pi_research_state.searches, 3);
	} finally {
		restoreEnv(snapshot);
		rmSync(dir, { recursive: true, force: true });
		delete (globalThis as Record<string, unknown>).__pi_ketch_version_checks_v1;
		delete (globalThis as Record<string, unknown>).__pi_research_state;
		delete (globalThis as Record<string, unknown>).__pi_active_plan_context;
	}
});

test("bounded research deduplicates repeated queries before spending a search unit", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ketch-query-dedup-"));
	const snapshot = Object.fromEntries(["KETCH", "KETCH_BIN", "RESEARCH_BUDGET", "TELEMETRY_FILE", "TELEMETRY_SOURCE"].map((key) => [key, process.env[key]]));
	try {
		delete process.env.KETCH;
		process.env.KETCH_BIN = mockKetch(dir);
		process.env.RESEARCH_BUDGET = "on";
		process.env.TELEMETRY_FILE = join(dir, "events.jsonl");
		process.env.TELEMETRY_SOURCE = "test";
		const fp = makeFakePi();
		const mod = await import(`../extensions/ketch.ts?query-dedup=${Date.now()}-${Math.random()}`);
		mod.registerKetch(fp.pi as never, { resolvePublicUrl: async (raw: string) => new URL(raw).toString() });
		const first = await callTool(fp, "web_search", { query: "same   claim", limit: 1 }, dir);
		const second = await callTool(fp, "web_search", { query: " same claim ", limit: 1 }, dir);
		assert.equal(first.details.result_count, 1);
		assert.equal(second.details.outcome, "duplicate_query");
	} finally {
		restoreEnv(snapshot);
		rmSync(dir, { recursive: true, force: true });
		delete (globalThis as Record<string, unknown>).__pi_research_state;
	}
});

test("planned research deduplicates a query across independently loaded branch processes", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ketch-cross-process-dedup-"));
	const snapshot = Object.fromEntries(["KETCH", "KETCH_BIN", "RESEARCH_BUDGET", "PI_CODING_AGENT_DIR", "PI_MUNCHKIN_PLAN_CONTEXT_PATH", "TELEMETRY_FILE", "TELEMETRY_SOURCE"].map((key) => [key, process.env[key]]));
	try {
		delete process.env.KETCH;
		process.env.KETCH_BIN = mockKetch(dir);
		process.env.RESEARCH_BUDGET = "on";
		process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
		process.env.PI_MUNCHKIN_PLAN_CONTEXT_PATH = join(dir, "context.json");
		writeFileSync(process.env.PI_MUNCHKIN_PLAN_CONTEXT_PATH, JSON.stringify({
			v: 1, profile: "deep-research", run_id: "cross-process-run", parent_item_id: "leaf", owner_ref: "a".repeat(24), depth: 2,
			budget: { searches: 1, reads: 1 }, limits: { max_depth: 2, max_children: 0 },
		}));
		process.env.TELEMETRY_FILE = join(dir, "events.jsonl");
		process.env.TELEMETRY_SOURCE = "test";
		const first = makeFakePi();
		const second = makeFakePi();
		const modA = await import(`../extensions/ketch.ts?cross-a=${Date.now()}-${Math.random()}`);
		const modB = await import(`../extensions/ketch.ts?cross-b=${Date.now()}-${Math.random()}`);
		modA.registerKetch(first.pi as never, { resolvePublicUrl: async (raw: string) => new URL(raw).toString() });
		modB.registerKetch(second.pi as never, { resolvePublicUrl: async (raw: string) => new URL(raw).toString() });
		await first.handlers.get("session_start")?.[0]?.({}, { cwd: dir, ui: { notify() {} } });
		await second.handlers.get("session_start")?.[0]?.({}, { cwd: dir, ui: { notify() {} } });
		const initial = await callTool(first, "web_search", { query: "same cross-branch claim", limit: 1 }, dir);
		const duplicate = await callTool(second, "web_search", { query: "same   cross-branch claim", limit: 1 }, dir);
		assert.equal(initial.details.result_count, 1);
		assert.equal(duplicate.details.outcome, "duplicate_query");
	} finally {
		restoreEnv(snapshot);
		rmSync(dir, { recursive: true, force: true });
		resetPiGlobals();
		delete (globalThis as Record<string, unknown>).__pi_ketch_version_checks_v1;
	}
});

test("budget-only sessions share the 3/5 wall without exposing ledger tools", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ketch-budget-only-"));
	const snapshot = Object.fromEntries(["KETCH", "KETCH_BIN", "KETCH_BACKEND", "RESEARCH_LEDGER", "RESEARCH_BUDGET", "PI_MUNCHKIN_PLAN_CONTEXT_PATH", "TELEMETRY_FILE", "TELEMETRY_SOURCE"].map((key) => [key, process.env[key]]));
	try {
		delete process.env.KETCH;
		process.env.KETCH_BIN = mockKetch(dir);
		process.env.KETCH_BACKEND = "exa";
		delete process.env.RESEARCH_LEDGER;
		process.env.RESEARCH_BUDGET = "on";
		delete process.env.PI_MUNCHKIN_PLAN_CONTEXT_PATH;
		process.env.TELEMETRY_FILE = join(dir, "events.jsonl");
		process.env.TELEMETRY_SOURCE = "test";
		const fp = makeFakePi();
		(await import(`../extensions/ketch.ts?budget-only=${Date.now()}-${Math.random()}`)).default(fp.pi as never);
		await fp.handlers.get("session_start")?.[0]?.({}, { cwd: dir, ui: { notify() {} } });
		assert.deepEqual([...fp.tools.keys()].sort(), ["web_read", "web_search"]);
		for (let i = 0; i < 3; i++) {
			const result = await callTool(fp, "web_search", { query: `budget-only-${i}`, limit: 1 }, dir);
			assert.notEqual(result.details.outcome, "budget_exhausted");
		}
		const blocked = await callTool(fp, "web_search", { query: "budget-only-fourth", limit: 1 }, dir);
		assert.equal(blocked.details.outcome, "budget_exhausted");
		assert.equal(blocked.details.coverage.budget_exhausted, true);
		assert.equal((globalThis as Record<string, any>).__pi_research_state, undefined, "budget-only controls must not expose ledger state");
	} finally {
		restoreEnv(snapshot);
		rmSync(dir, { recursive: true, force: true });
		delete (globalThis as Record<string, unknown>).__pi_ketch_version_checks_v1;
		delete (globalThis as Record<string, unknown>).__pi_research_state;
		delete (globalThis as Record<string, unknown>).__pi_active_plan_context;
	}
});

test("M1: a query beginning with '-' is passed as a positional after '--', never parsed as a flag", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ketch-argsep-"));
	const argFile = join(dir, "args.txt");
	const mock = join(dir, "ketch-args");
	// records the post-subcommand args, then returns valid JSON
	writeFileSync(mock, `#!/bin/sh
case "$1" in
  version) printf 'ketch v0.12.0\\n' ;;
  search) shift; printf '%s\\n' "$*" > "$KETCH_ARGFILE"; printf '[{"title":"R","url":"https://example.com/a","description":"d"}]\\n' ;;
  *) exit 2 ;;
esac
`);
	chmodSync(mock, 0o755);
	const snapshot = Object.fromEntries(["KETCH", "KETCH_BIN", "KETCH_BACKEND", "KETCH_ARGFILE", "TELEMETRY_FILE", "TELEMETRY_SOURCE"].map((key) => [key, process.env[key]]));
	try {
		delete process.env.KETCH;
		process.env.KETCH_BIN = mock;
		process.env.KETCH_BACKEND = "ddg";
		process.env.KETCH_ARGFILE = argFile;
		process.env.TELEMETRY_FILE = join(dir, "events.jsonl");
		process.env.TELEMETRY_SOURCE = "test";
		const fp = makeFakePi();
		(await import(`../extensions/ketch.ts?argsep=${Date.now()}-${Math.random()}`)).default(fp.pi as never);
		const out = await callTool(fp, "web_search", { query: "--config=/etc/evil", mode: "quick" }, dir);
		assert.match(out.content[0].text, /R/, "query treated as a search term, not a flag");
		const recorded = readFileSync(argFile, "utf8").trim();
		assert.ok(recorded.endsWith("-- --config=/etc/evil"), `end-of-options separator must precede the query: ${recorded}`);
		assert.ok(!/^--config/.test(recorded), "the flag-shaped query must not appear as a leading option");
	} finally {
		restoreEnv(snapshot);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("web_read blocks pre-DNS-rejectable URLs without spawning ketch (allSettled all-blocked path)", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ketch-block-"));
	const mock = join(dir, "km");
	// version passes; scrape would print JSON — but must never be reached
	writeFileSync(mock, `#!/bin/sh
case "$1" in version) printf 'ketch v0.12.0\\n' ;; scrape) printf 'SCRAPED\\n' ;; *) exit 2 ;; esac
`);
	chmodSync(mock, 0o755);
	const snapshot = Object.fromEntries(["KETCH", "KETCH_BIN", "TELEMETRY_FILE", "TELEMETRY_SOURCE"].map((key) => [key, process.env[key]]));
	try {
		delete process.env.KETCH;
		process.env.KETCH_BIN = mock;
		process.env.TELEMETRY_FILE = join(dir, "events.jsonl");
		process.env.TELEMETRY_SOURCE = "test";
		const fp = makeFakePi();
		(await import(`../extensions/ketch.ts?block=${Date.now()}-${Math.random()}`)).default(fp.pi as never);
		// localhost + credentialed URL both reject in the guard BEFORE any DNS/fetch
		const out = await callTool(fp, "web_read", { urls: ["http://localhost/x", "https://user:pass@example.com/"] }, dir);
		assert.match(out.content[0].text, /blocked every URL/);
		assert.equal(out.details.outcome, "blocked_url");
		assert.ok(!out.content[0].text.includes("SCRAPED"), "ketch scrape must never run when all URLs are blocked");
	} finally {
		restoreEnv(snapshot);
		rmSync(dir, { recursive: true, force: true });
	}
});
