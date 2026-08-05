import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	readRuntimePosture, renderDoctor, sandboxPosture, strictModeFlag, summarizeToolSurface,
} from "../lib/runtime-doctor.ts";

test("tool provenance is canonical, bounded, and reports missing, duplicate, and override state", () => {
	const privatePath = join("", "Users", "someone", "private-work", "extension.ts");
	const summary = summarizeToolSurface([
		{ name: "read", sourceInfo: { source: "extension", scope: "project", origin: privatePath } },
		{ name: "read", sourceInfo: { source: "builtin", scope: "global", origin: "builtin" } },
		{ name: "edit", sourceInfo: { source: "extension", scope: "project", origin: "pi-munchkin" } },
		{ name: "plan_write", sourceInfo: { source: "extension", scope: "package", origin: "pi-munchkin" } },
	], ["read", "edit"], true);

	assert.equal(summary.active, 2);
	assert.equal(summary.all, 4);
	assert.equal(summary.preservedExplicit, true);
	assert.deepEqual(summary.duplicates, ["read"]);
	assert.ok(summary.missing.includes("subagent"));
	assert.ok(summary.overrides.some((entry) => entry.startsWith("read@")));
	assert.equal(JSON.stringify(summary).includes(privatePath), false, "sourceInfo paths are hashed, never displayed");
});

test("runtime posture reads bounded global/project settings without surfacing unrelated values", async () => {
	const root = mkdtempSync(join(tmpdir(), "munchkin-doctor-"));
	const agent = join(root, "agent");
	const project = join(root, "project");
	mkdirSync(join(project, ".pi"), { recursive: true });
	mkdirSync(agent, { recursive: true });
	const sentinel = ["PRIVATE", "_SENTINEL", "_VALUE"].join("");
	writeFileSync(join(agent, "settings.json"), JSON.stringify({
		retry: { enabled: false, maxRetries: 8, provider: { timeoutMs: 12_000, maxRetries: 6 } },
		httpIdleTimeoutMs: 44_000,
		unrelatedValue: sentinel,
	}));
	writeFileSync(join(project, ".pi", "settings.json"), JSON.stringify({
		retry: { enabled: true, maxRetries: 2, provider: { maxRetryDelayMs: 9_000 } },
		shellCommandPrefix: "sandbox-wrapper",
		unrelatedValue: sentinel,
	}));
	try {
		const posture = await readRuntimePosture(project, { PI_CODING_AGENT_DIR: agent });
		assert.deepEqual(posture, {
			retryEnabled: true, maxRetries: 2, baseDelayMs: 2_000,
			httpIdleTimeoutMs: 44_000, providerTimeoutMs: 12_000,
			providerMaxRetries: 6, providerMaxRetryDelayMs: 9_000, shellPolicyDeclared: true,
		});
		assert.equal(JSON.stringify(posture).includes(sentinel), false);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("doctor output reports capabilities but never raw settings, paths, or endpoints", () => {
	const sentinel = ["PRIVATE", "_SENTINEL", "_VALUE"].join("");
	const tools = summarizeToolSurface([
		{ name: "read", sourceInfo: { source: "extension", scope: "project", origin: join("", "private", sentinel) } },
	], ["read"], true);
	const output = renderDoctor({
		piVersion: "0.83.4", surfaceHash: "a".repeat(64),
		model: { provider: "local", id: "small-model", api: "openai-completions", compat: { supportsStrictMode: false } },
		providerName: "Local Provider", tools,
		posture: {
			retryEnabled: true, maxRetries: 3, baseDelayMs: 2_000, httpIdleTimeoutMs: 300_000,
			providerTimeoutMs: null, providerMaxRetries: 0, providerMaxRetryDelayMs: 60_000,
			shellPolicyDeclared: true,
		},
		sandbox: "declared", preservationReason: "narrowed-tools",
	});
	assert.match(output, /pi=0\.83\.4/);
	assert.match(output, /strict_tool_sampling=false/);
	assert.match(output, /preserved_explicit=true/);
	assert.match(output, /sandbox=declared/);
	assert.match(output, /provider_timeout_ms=sdk-default; provider_max_retries=0/);
	assert.match(output, /shell policy is not isolation/);
	assert.equal(output.includes(sentinel), false);
	assert.equal(output.includes("baseUrl"), false);
	assert.equal(output.includes("credential"), false);
});

test("sandbox and constrained-sampling capability flags fail closed", () => {
	assert.equal(sandboxPosture({ PI_SANDBOX_POSTURE: "container" }), "unknown");
	assert.equal(sandboxPosture({ PI_SANDBOX_POSTURE: "host" }), "host");
	assert.equal(strictModeFlag({ api: "openai-completions", compat: { supportsStrictMode: false } }), "false");
	assert.equal(strictModeFlag({ api: "anthropic-messages", compat: { supportsStrictMode: true } }), "not-applicable");
});
