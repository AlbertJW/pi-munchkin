import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	buildKetchEnv,
	formatReadResults,
	formatSearchResults,
	ketchInstallHint,
	parseReadResults,
	parseSearchResults,
	parseSemver,
	runKetchProcess,
	versionAtLeast,
} from "../lib/ketch-runtime.ts";
import { callTool, makeFakePi } from "./integration-harness.ts";

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
		assert.deepEqual(quick.details.backends, ["exa"]);
		assert.deepEqual(quick.details.coverage, {
			strategy: "direct", scope: "exhaustive", returned_count: 1, total_count: 1,
			truncated: false, budget_exhausted: false, failed: false, complete: true,
		});

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
