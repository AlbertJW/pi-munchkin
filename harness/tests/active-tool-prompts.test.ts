import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
	ACTIVE_TOOL_PROMPTS, AMBIENT_TOOL_GUIDANCE, activeToolPromptsEnabled, stripAmbientToolGuidance,
} from "../lib/active-tool-prompts.ts";

const CHILD = process.env.ACTIVE_TOOL_PROMPTS_TEST_CHILD === "1";
const runChild = (mode: "ambient" | "unset" | "active"): string => {
	const env = { ...process.env };
	delete env.NODE_TEST_CONTEXT;
	Object.assign(env, {
		ACTIVE_TOOL_PROMPTS_TEST_CHILD: "1",
		ACTIVE_TOOL_PROMPTS: mode === "unset" ? "" : mode,
		TELEMETRY: "off",
	});
	return execFileSync(process.execPath, [
		"--experimental-strip-types",
		"--experimental-loader", resolve("harness/tests/ts-js-resolver.mjs"),
		"--test", import.meta.filename,
	], {
		cwd: process.cwd(), env, stdio: "pipe", encoding: "utf8",
	});
};

if (!CHILD) {
	test("prompt mode has explicit active and ambient rollback semantics", () => {
		assert.equal(activeToolPromptsEnabled({ ACTIVE_TOOL_PROMPTS: "active" }), true);
		assert.equal(activeToolPromptsEnabled({ ACTIVE_TOOL_PROMPTS: "ambient", MUNCHKIN_TOOL_ACTIVATION: "dynamic" }), false);
		assert.equal(activeToolPromptsEnabled({ MUNCHKIN_TOOL_ACTIVATION: "dynamic" }), true,
			"deployed default follows the dynamic surface since the 2026-08-15 adoption");
		assert.equal(activeToolPromptsEnabled({ MUNCHKIN_TOOL_ACTIVATION: "dynamic" }, "ambient"), false,
			"the ambient default parameterization remains expressible (suppression arms)");
		assert.equal(activeToolPromptsEnabled({ MUNCHKIN_TOOL_ACTIVATION: "ambient" }), false,
			"derived defers to an ambient activation surface");
		assert.equal(activeToolPromptsEnabled({ MUNCHKIN_TOOL_ACTIVATION: "ambient", MUNCHKIN_TOOL_SURFACE: "minimal" }), true,
			"a deliberately narrowed minimal surface must not retain guidance for absent tools");
		assert.equal(activeToolPromptsEnabled({ ACTIVE_TOOL_PROMPTS: "ambient", MUNCHKIN_TOOL_ACTIVATION: "ambient", MUNCHKIN_TOOL_SURFACE: "minimal" }), false,
			"the explicit ambient rollback remains authoritative even on a minimal surface");
		assert.equal(activeToolPromptsEnabled({ ACTIVE_TOOL_PROMPTS: "ambient", MUNCHKIN_TOOL_ACTIVATION: "dynamic" }, "derived"), false,
			"explicit ambient remains authoritative after adoption");
	});

	test("unset prompt surface follows the adopted derived default in an isolated source-loader process", () => {
		const output = runChild("unset");
		assert.match(output, /inactive tools contribute no schema/);
		assert.match(output, /pass 2/);
	});

	test("explicit ambient rollback is verified in an isolated source-loader process", () => {
		const output = runChild("ambient");
		assert.match(output, /ambient mode preserves the ambient prompt/);
		assert.match(output, /pass 1/);
	});

	test("active-only prompt surface is verified in an isolated source-loader process", () => {
		const output = runChild("active");
		assert.match(output, /inactive tools contribute no schema/);
		assert.match(output, /pass 2/);
	});
} else if (!ACTIVE_TOOL_PROMPTS) {
	test("ambient mode preserves the ambient prompt and adds no definition-owned guidance", async () => {
		const { makeFakePi } = await import("./integration-harness.ts");
		const [{ default: compact }, { default: subagent }, { default: surface }] = await Promise.all([
			import("../extensions/compact-tool.ts"),
			import("../vendor/pi-subagent/index.ts"),
			import("../extensions/active-tool-prompts.ts"),
		]);
		const fp = makeFakePi();
		compact(fp.pi as never);
		subagent(fp.pi as never);
		const legacyBeforeAgentStartHandlers = fp.handlers.get("before_agent_start")?.length ?? 0;
		surface(fp.pi as never);
		assert.equal(fp.tools.get("compact_context")?.promptGuidelines, undefined);
		assert.equal(fp.tools.get("subagent")?.promptGuidelines, undefined);
		assert.equal(fp.tools.get("subagent")?.description.includes("No agents discovered yet"), false,
			"legacy tool schema remains byte-stable rather than gaining dynamic status text");
		assert.equal(fp.handlers.get("before_agent_start")?.length ?? 0, legacyBeforeAgentStartHandlers,
			"inactive surface mode registers no additional prompt mutation hook");
		const append = await readFile(resolve("harness/APPEND_SYSTEM.md"), "utf8");
		assert.equal(append.includes(AMBIENT_TOOL_GUIDANCE), true);
	});
} else {
	test("inactive tools contribute no schema, snippet, guideline, or ambient prompt bytes", async () => {
		const { makeFakePi } = await import("./integration-harness.ts");
		const [{ default: compact }, { default: spans }, { default: plan }, { default: subagent }, { default: surface }] = await Promise.all([
			import("../extensions/compact-tool.ts"),
			import("../extensions/span-tools.ts"),
			import("../extensions/plan-runner.ts"),
			import("../vendor/pi-subagent/index.ts"),
			import("../extensions/active-tool-prompts.ts"),
		]);
		const fp = makeFakePi();
		compact(fp.pi as never);
		spans(fp.pi as never);
		plan(fp.pi as never);
		subagent(fp.pi as never);
		surface(fp.pi as never);

		const append = await readFile(resolve("harness/APPEND_SYSTEM.md"), "utf8");
		assert.equal(append.includes(AMBIENT_TOOL_GUIDANCE), true, "legacy rollback text stays available on disk");
		let systemPrompt = `base\n\n${append}`;
		for (const handler of fp.handlers.get("before_agent_start") ?? []) {
			const result = await handler({ prompt: "test", systemPrompt }, { cwd: process.cwd(), hasUI: false, ui: { notify() {} } });
			if (result?.systemPrompt) systemPrompt = result.systemPrompt;
		}
		assert.equal(systemPrompt.includes("compact_context"), false);
		assert.equal(systemPrompt.includes("plan_write"), false);
		assert.equal(systemPrompt.includes("subagent("), false);
		assert.equal(systemPrompt.includes('"agent": "agent-name"'), false, "inactive subagent JSON examples are absent");
		assert.equal(systemPrompt.includes("How to call the subagent tool"), false, "inactive vendor manual is absent");
		assert.equal(systemPrompt.includes("## Reports"), true, "invariant guidance remains");

		const toolSurface = (active: string[]) => JSON.stringify(
			active.map((name) => fp.tools.get(name)).filter(Boolean).map((definition) => ({
				name: definition.name,
				description: definition.description,
				parameters: definition.parameters,
				promptSnippet: definition.promptSnippet,
				promptGuidelines: definition.promptGuidelines,
			})),
		);
		const inactive = toolSurface([]);
		for (const name of ["compact_context", "search_spans", "read_span", "plan_write", "plan_update", "subagent"]) {
			assert.equal(inactive.includes(name), false);
			const active = toolSurface([name]);
			assert.equal(active.includes(name), true);
			assert.equal(active.includes("promptGuidelines"), true);
			assert.equal(toolSurface([]).includes(name), false, "manual disable removes the complete contribution again");
		}

		const cwd = await mkdtemp(resolve(tmpdir(), "active-tool-prompts-"));
		try {
			fp.pi.setActiveTools(["subagent"]);
			for (const handler of fp.handlers.get("session_start") ?? []) {
				await handler({}, { cwd, hasUI: false, ui: { notify() {} } });
			}
			const applyHooks = async (initial: string): Promise<string> => {
				let current = initial;
				for (const handler of fp.handlers.get("before_agent_start") ?? []) {
					const result = await handler({ prompt: "test", systemPrompt: current }, { cwd, hasUI: false, ui: { notify() {} } });
					if (result?.systemPrompt) current = result.systemPrompt;
				}
				return current;
			};
			assert.equal((await applyHooks("base")).includes("Available Subagents"), true,
				"the active tool receives its discovered-agent data");
			fp.pi.setActiveTools([]);
			assert.equal((await applyHooks("base")).includes("Available Subagents"), false,
				"manual disable removes dynamic subagent prompt data");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("ambient guidance stripping is exact and leaves unrelated prompt bytes untouched", () => {
		const prompt = `prefix\n\n${AMBIENT_TOOL_GUIDANCE}\n\nsuffix`;
		assert.equal(stripAmbientToolGuidance(prompt), "prefix\n\nsuffix");
	});
}
