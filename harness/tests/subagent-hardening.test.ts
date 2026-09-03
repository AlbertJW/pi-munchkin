import assert from "node:assert/strict";
import test from "node:test";
import { resolveSubagentTimeoutMs } from "../vendor/pi-subagent/timeout.ts";
import { parseInheritedCliArgs } from "../vendor/pi-subagent/runner-cli.js";
import { buildSubagentEnv } from "../vendor/pi-subagent/runner-env.js";
import { normalizeCompletedResult, emptyUsage, isResultSuccess, type SingleResult } from "../vendor/pi-subagent/types.ts";
import { isTerminalPlannedFailure, isTerminalPlannedFailureResult } from "../vendor/pi-subagent/types.ts";

test("planned depth-one branch failures are terminal, ordinary failures remain retryable", () => {
	assert.equal(isTerminalPlannedFailure({ depth: 1 }), true);
	assert.equal(isTerminalPlannedFailure({ depth: 2 }), false);
	assert.equal(isTerminalPlannedFailure(undefined), false);
});

test("clean planned branch exits with an invalid report are terminal, not retryable successes", () => {
	const base = { exitCode: 0, stopReason: "stop", messages: [], sawAgentEnd: true } as any;
	assert.equal(isTerminalPlannedFailureResult({ depth: 1 }, { ...base, branchReportFailure: "invalid_report" }), true);
	assert.equal(isTerminalPlannedFailureResult({ depth: 1 }, { ...base, branchReportFailure: "missing_report" }), true);
	assert.equal(isTerminalPlannedFailureResult({ depth: 1 }, { ...base, branchReport: {} }), false);
	assert.equal(isTerminalPlannedFailureResult({ depth: 2 }, { ...base, branchReportFailure: "invalid_report" }), false);
});

test("subagent argv never inherits API keys", () => {
	const parsed = parseInheritedCliArgs(["node", "pi", "--provider", "openai", "--api-key", "super-secret", "--model", "gpt"]);
	assert.deepEqual(parsed.alwaysProxy, ["--provider", "openai"]);
	assert.equal(JSON.stringify(parsed).includes("super-secret"), false);
});

test("subagent environment is reduced and excludes unrelated secrets and shell injection", () => {
	const env = buildSubagentEnv({ PATH: "/bin", HOME: "/home/u", OPENAI_API_KEY: "needed", LLAMA_API_KEY: "dummy-llama", AWS_SECRET_ACCESS_KEY: "drop", NODE_OPTIONS: "--require evil", SSH_AUTH_SOCK: "/sock" });
	assert.deepEqual(env, { PATH: "/bin", HOME: "/home/u", OPENAI_API_KEY: "needed", LLAMA_API_KEY: "dummy-llama" });
});

test("gate child telemetry is contained instead of falling back to the live ledger", () => {
	const env = buildSubagentEnv({
		PATH: "/bin", HOME: "/home/u", TELEMETRY: "on", TELEMETRY_SOURCE: "gate",
		TELEMETRY_FD: "8", TELEMETRY_HMAC_FD: "3",
	});
	assert.equal(env.TELEMETRY, "off");
	assert.equal(env.TELEMETRY_CHILD_POLICY, "contained");
	assert.equal(env.TELEMETRY_FD, undefined);
	assert.equal(env.TELEMETRY_HMAC_FD, undefined);
});

test("subagent explicit environment allowlist accepts valid names only", () => {
	const env = buildSubagentEnv({
		PATH: "/bin", PI_SUBAGENT_ENV_ALLOW: "CUSTOM_SENTINEL,bad-name, ALSO_OK ",
		CUSTOM_SENTINEL: "dummy-one", ALSO_OK: "dummy-two", "bad-name": "drop",
	});
	// PI_SUBAGENT_ENV_ALLOW itself propagates so nested children honor the same list.
	assert.deepEqual(env, {
		PATH: "/bin", PI_SUBAGENT_ENV_ALLOW: "CUSTOM_SENTINEL,bad-name, ALSO_OK ",
		CUSTOM_SENTINEL: "dummy-one", ALSO_OK: "dummy-two",
	});
});

test("abort and signal/nonzero failures cannot be overridden by semantic output", () => {
	const base: SingleResult = { agent: "a", agentSource: "project", task: "t", exitCode: 143, messages: [{ role: "assistant", content: [{ type: "text", text: "done" }], api: "x", provider: "x", model: "x", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 0 } as any], stderr: "signal", usage: emptyUsage(), sawAgentEnd: true };
	const signaled = normalizeCompletedResult({ ...base }, false);
	assert.equal(signaled.exitCode, 143);
	assert.equal(signaled.stopReason, "error");
	assert.equal(isResultSuccess(signaled), false);
	const aborted = normalizeCompletedResult({ ...base, exitCode: 0 }, true);
	assert.equal(aborted.exitCode, 130);
	assert.equal(aborted.stopReason, "aborted");
});

test("c36: executor description rewritten to spawn at injection time; other roles and flag-off untouched", async () => {
	const { agentDescriptionForPrompt } = await import("../vendor/pi-subagent/types.ts");
	const executor = "Isolated single-change worker. Delegate ONE bounded, fully-specified edit here when you want it done off the main window. Use mode=fork so it has surrounding context. Reports exact changed files. Prefer doing trivial edits yourself.";
	const explorer = "Read-only context gatherer. Returns distilled facts.";
	const previous = process.env.SPAWN_DELEGATION;
	try {
		// ADOPTED 2026-08-07: default-on (was dark candidate c36) — unset must rewrite.
		process.env.SPAWN_DELEGATION = "on";
		const rewritten = agentDescriptionForPrompt(executor);
		assert.ok(rewritten.includes("Use mode=spawn with a fully self-contained task — the child sees nothing else."), rewritten);
		assert.ok(!rewritten.includes("mode=fork"), rewritten);
		assert.equal(agentDescriptionForPrompt(explorer), explorer, "roles without the fork sentence pass through");

		delete process.env.SPAWN_DELEGATION;
		assert.equal(agentDescriptionForPrompt(executor), rewritten, "unset = default-on: rewrite");
		process.env.SPAWN_DELEGATION = "banana";
		assert.equal(agentDescriptionForPrompt(executor), rewritten, "junk env = default-on: rewrite");
		process.env.SPAWN_DELEGATION = "off";
		assert.equal(agentDescriptionForPrompt(executor), executor, "SPAWN_DELEGATION=off is the kill switch — identity");
	} finally {
		if (previous === undefined) delete process.env.SPAWN_DELEGATION;
		else process.env.SPAWN_DELEGATION = previous;
	}
});

test("every env key harness code reads is classified for subagent propagation", async () => {
	const { readdirSync, readFileSync, statSync } = await import("node:fs");
	const { join } = await import("node:path");
	const { CHILD_ENV_KEYS, EXCLUDED_HARNESS_ENV_KEYS, HARNESS_CONFIG_KEYS, HARNESS_CONFIG_PREFIXES } =
		await import("../vendor/pi-subagent/runner-env.js");
	const classified = new Set([...CHILD_ENV_KEYS, ...HARNESS_CONFIG_KEYS, ...EXCLUDED_HARNESS_ENV_KEYS]);
	for (const key of HARNESS_CONFIG_KEYS) {
		assert.ok(!EXCLUDED_HARNESS_ENV_KEYS.includes(key), `${key} is both propagated and excluded`);
	}
	const roots = ["extensions", "lib", "vendor"].map((d) => join(import.meta.dirname, "..", d));
	const unclassified = new Set<string>();
	const flag = (key: string, file: string): void => {
		if (classified.has(key)) return;
		if (HARNESS_CONFIG_PREFIXES.some((prefix: string) => key.startsWith(prefix))) return;
		unclassified.add(`${key} (${file})`);
	};
	const walk = (dir: string): void => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) { walk(path); continue; }
			if (!/\.(ts|js|mjs)$/.test(name)) continue;
			const source = readFileSync(path, "utf8");
			// direct property reads: process.env.NAME / env.NAME
			for (const match of source.matchAll(/env\.([A-Z][A-Z0-9_]{2,})/g)) flag(match[1], name);
			// bracket reads with a literal: process.env["NAME"]
			for (const match of source.matchAll(/env\[\s*["']([A-Z][A-Z0-9_]{2,})["']/g)) flag(match[1], name);
			// bracket reads via a template-literal family: env[`PREFIX_${...}`]
			for (const match of source.matchAll(/env\[\s*`([A-Z][A-Z0-9_]*_)\$\{/g)) {
				if (!HARNESS_CONFIG_PREFIXES.includes(match[1])) unclassified.add(`${match[1]}* (${name})`);
			}
			// helper indirection: envInt("NAME"), thresh("NAME"), boundedEnvInt("NAME"),
			// byteLimit("NAME") — the shapes the first version of this test missed.
			for (const match of source.matchAll(/\b(?:envInt|thresh|boundedEnvInt|byteLimit)\(\s*["']([A-Z][A-Z0-9_]{2,})["']/g)) {
				flag(match[1], name);
			}
		}
	};
	for (const root of roots) walk(root);
	assert.deepEqual([...unclassified].sort(), [],
		"new env reads must be added to HARNESS_CONFIG_KEYS (propagate to subagents), EXCLUDED_HARNESS_ENV_KEYS (with a reason), or HARNESS_CONFIG_PREFIXES (families)");
});

test("prefix-family env vars cross into the subagent environment", () => {
	const env = buildSubagentEnv({
		PATH: "/bin",
		TEACH_HINT_ANCHOR_FIRST: "off", PI_MSG_LOOP_TIER1: "custom", KETCH_TIMEOUT_MS: "9000",
		TEACHER: "not-a-family-match", PI_SUBAGENT_DEPTH: "2",
	});
	assert.equal(env.TEACH_HINT_ANCHOR_FIRST, "off");
	assert.equal(env.PI_MSG_LOOP_TIER1, "custom");
	assert.equal(env.KETCH_TIMEOUT_MS, "9000");
	assert.equal(env.TEACHER, undefined, "non-family names do not leak");
	assert.equal(env.PI_SUBAGENT_DEPTH, undefined, "runner-managed depth never copies");
});

test("explicit =off suppression survives into the subagent environment", () => {
	// The 2026-08-07 flips made unset mean ON; a child env that drops the
	// parent's explicit `=off` silently re-enables the mechanism mid-arm.
	const env = buildSubagentEnv({
		PATH: "/bin", FORCE_PLAN_WRITE: "off", SPAN_TOOLS: "off", RUN_KERNEL: "shadow",
		TELEMETRY_FD: "7", CHAOS: "bash:2:enoent", PI_RUN_ID: "parent-run",
	});
	assert.equal(env.FORCE_PLAN_WRITE, "off");
	assert.equal(env.SPAN_TOOLS, "off");
	assert.equal(env.RUN_KERNEL, "shadow");
	assert.equal(env.TELEMETRY_FD, undefined, "process-local fds never cross");
	assert.equal(env.CHAOS, undefined, "fault injection stays parent-scoped");
	assert.equal(env.PI_RUN_ID, undefined, "child derives its own run identity");
});

test("planner flags propagate but private branch artifact paths never do", () => {
	const env = buildSubagentEnv({
		PATH: "/bin", PLAN_GRAPH: "on", DEEP_RESEARCH_PLANNING: "on",
		PI_MUNCHKIN_HEADLESS_PLAN: "on",
		PI_MUNCHKIN_PLAN_CONTEXT_PATH: "/private/parent-context.json",
		PI_MUNCHKIN_BRANCH_REPORT_PATH: "/private/parent-report.json",
		PI_MUNCHKIN_RESEARCH_SCOUT: "1",
	});
	assert.equal(env.PLAN_GRAPH, "on");
	assert.equal(env.DEEP_RESEARCH_PLANNING, "on");
	assert.equal(env.PI_MUNCHKIN_PLAN_CONTEXT_PATH, undefined);
	assert.equal(env.PI_MUNCHKIN_BRANCH_REPORT_PATH, undefined);
	assert.equal(env.PI_MUNCHKIN_RESEARCH_SCOUT, undefined);
	assert.equal(env.PI_MUNCHKIN_HEADLESS_PLAN, undefined);
});

test("research budget control propagates while ledger remains independently selectable", () => {
	const env = buildSubagentEnv({ PATH: "/bin", RESEARCH_BUDGET: "on", RESEARCH_LEDGER: "off" });
	assert.equal(env.RESEARCH_BUDGET, "on");
	assert.equal(env.RESEARCH_LEDGER, "off");
});

test("Jina Reader opt-in propagates to children without leaking private reader state", () => {
	const env = buildSubagentEnv({
		PATH: "/bin", JINA_READER: "on",
		PI_MUNCHKIN_PLAN_CONTEXT_PATH: "/private/context.json",
		PI_MUNCHKIN_BRANCH_REPORT_PATH: "/private/report.json",
	});
	assert.equal(env.JINA_READER, "on");
	assert.equal(env.PI_MUNCHKIN_PLAN_CONTEXT_PATH, undefined);
	assert.equal(env.PI_MUNCHKIN_BRANCH_REPORT_PATH, undefined);
});

test("subagent summary cap is tunable via PI_SUBAGENT_MAX_SUMMARY_CHARS", async () => {
	const result = { messages: [{ role: "assistant", content: [{ type: "text", text: "x".repeat(20000) }] }] };
	const prev = process.env.PI_SUBAGENT_MAX_SUMMARY_CHARS;
	try {
		delete process.env.PI_SUBAGENT_MAX_SUMMARY_CHARS;
		const def = await import(`../vendor/pi-subagent/runner-events.js?cap=default-${Date.now()}`);
		const defOut = def.getResultSummaryText(result);
		assert.ok(defOut.startsWith("x".repeat(12000)) && !defOut.startsWith("x".repeat(12001)), "default cap is 12000");
		assert.match(defOut, /truncated: 20000 chars total/);

		process.env.PI_SUBAGENT_MAX_SUMMARY_CHARS = "2000";
		const small = await import(`../vendor/pi-subagent/runner-events.js?cap=2000-${Date.now()}`);
		const smallOut = small.getResultSummaryText(result);
		assert.ok(smallOut.startsWith("x".repeat(2000)) && !smallOut.startsWith("x".repeat(2001)), "override cap honoured");

		process.env.PI_SUBAGENT_MAX_SUMMARY_CHARS = "-5";
		const bad = await import(`../vendor/pi-subagent/runner-events.js?cap=bad-${Date.now()}`);
		assert.ok(bad.getResultSummaryText(result).startsWith("x".repeat(12000)), "invalid value falls back to default");
	} finally {
		if (prev === undefined) delete process.env.PI_SUBAGENT_MAX_SUMMARY_CHARS;
		else process.env.PI_SUBAGENT_MAX_SUMMARY_CHARS = prev;
	}
});

test("child failure summaries are bounded untrusted diagnostics, never raw process output", async () => {
	const { getResultSummaryText, renderSubagentDiagnostic } = await import("../vendor/pi-subagent/runner-events.js");
	const secret = "DUMMY_CHILD_SECRET_VALUE";
	const raw = `\u001b[31mcompiler failed\u001b[0m /Users/alice/private.ts https://example.test/build?token=${secret} token=${secret} ${"x".repeat(2000)}`;
	const rendered = renderSubagentDiagnostic(raw);
	assert.match(rendered, /^UNTRUSTED_SUBAGENT_DIAGNOSTIC\nstatus=error\n/);
	assert.match(rendered, /failure_class=unknown/);
	assert.doesNotMatch(rendered, /\u001b|DUMMY_CHILD_SECRET_VALUE|example\.test|\/Users\//);
	const excerpt = JSON.parse(rendered.split("excerpt=", 2)[1]);
	assert.ok(Buffer.byteLength(excerpt, "utf8") <= 500);
	assert.equal(
		getResultSummaryText({ errorMessage: raw, messages: [] } as never),
		rendered,
		"errorMessage fallback uses the same bounded contract",
	);
	const failedWithDone = getResultSummaryText({
		exitCode: 143,
		stopReason: "error",
		errorMessage: raw,
		messages: [{ role: "assistant", content: [{ type: "text", text: "done" }] }],
	} as never);
	assert.match(failedWithDone, /^UNTRUSTED_SUBAGENT_DIAGNOSTIC/);
	assert.doesNotMatch(failedWithDone, /done/);
});

test("single-result TUI rendering uses the same redacted failure diagnostic", async () => {
	const { register } = await import("node:module");
	register(new URL("./ts-js-resolver.mjs", import.meta.url), import.meta.url);
	const { renderResult } = await import("../vendor/pi-subagent/render.ts");
	const secret = "DUMMY_TUI_SECRET_VALUE";
	const failed: SingleResult = {
		agent: "executor", agentSource: "project", task: "bounded task", exitCode: 1,
		messages: [], stderr: "", usage: emptyUsage(), stopReason: "error",
		errorMessage: `provider failed at https://private.invalid/v1?token=${secret} /Users/alice/private.ts`,
	};
	const result = {
		content: [{ type: "text", text: "failed" }],
		details: { mode: "single", delegationMode: "spawn", projectAgentsDir: null, results: [failed] },
	};
	const theme = { fg: (_color: unknown, text: string) => text, bold: (text: string) => text };
	for (const expanded of [false, true]) {
		const visible = renderResult(result, expanded, theme as never).render(200).join("\n");
		assert.match(visible, /UNTRUSTED_SUBAGENT_DIAGNOSTIC/);
		assert.doesNotMatch(visible, /DUMMY_TUI_SECRET_VALUE|private\.invalid|\/Users\/alice/);
	}
});

test("parallel summary header agrees with the per-child completed/failed labels", async () => {
	const { formatParallelSummaryText } = await import("../vendor/pi-subagent/types.ts");
	// A child left at the exitCode -1 placeholder is labelled "completed" (!isResultError)
	// but is NOT isResultSuccess. The header must count the same thing the labels show,
	// or three delivered children read as "1/3 succeeded". A genuine failure stays failed.
	const results = [
		{ agent: "a", exitCode: -1, messages: [], sawAgentEnd: false },
		{ agent: "b", exitCode: 1, stopReason: "error", messages: [], sawAgentEnd: false },
		{ agent: "c", exitCode: 0, sawAgentEnd: true, messages: [{ role: "assistant", content: [{ type: "text", text: "done" }] }] },
	];
	const text = formatParallelSummaryText(results as never);
	assert.match(text, /Parallel: 2\/3 succeeded/);
	const completedLabels = (text.match(/\] completed:/g) || []).length;
	assert.equal(completedLabels, 2, "header count equals the number of 'completed' labels");
	assert.match(text, /\[b\] failed:/);
});

test("subagent timeout default is 1800s; env and explicit arg still win", () => {
	// Raised from 600_000 on 2026-08-24 (Albert-approved): an explorer child on a
	// slow local model hit the 600s wall and blocked its parent task overnight.
	// Pi's independent httpIdleTimeoutMs is the provider-request control; this is
	// the outer child-process budget. Reverting the
	// default makes the first assertion fail; that is the counterfactual.
	assert.equal(resolveSubagentTimeoutMs(undefined, {}), 1_800_000);
	assert.equal(resolveSubagentTimeoutMs(undefined, { PI_SUBAGENT_TIMEOUT_MS: "120000" }), 120_000);
	assert.equal(resolveSubagentTimeoutMs(45_000, { PI_SUBAGENT_TIMEOUT_MS: "120000" }), 45_000);
	// Garbage env falls back to the default, never NaN.
	assert.equal(resolveSubagentTimeoutMs(undefined, { PI_SUBAGENT_TIMEOUT_MS: "soon" }), 1_800_000);
	assert.equal(resolveSubagentTimeoutMs(undefined, { PI_SUBAGENT_TIMEOUT_MS: "-5" }), 1_800_000);
});
