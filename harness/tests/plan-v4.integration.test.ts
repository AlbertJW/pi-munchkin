import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callTool, fire, makeCtx, makeFakePi } from "./integration-harness.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "pi-v4-"));

function reflection(stage: "interpretation" | "evidence", evidence = false) {
	return {
		stage,
		requirements: ["add adaptive behavior"],
		constraints: ["keep scope small"],
		non_goals: ["framework rewrite"],
		assumptions: [],
		evidence_refs: evidence ? ["src/example.ts:1"] : [],
		uncertainties: [],
		capability_use: ["bash"],
		scope_cuts: ["defer speculative abstraction"],
		test_seams: ["node tests"],
		signals: stage === "interpretation" ? { repository_behavior: true, capability_dependent: true } : {},
	};
}

function steps(status1 = "pending", status2 = "pending") {
	return [
		{
			step_id: "behavior",
			title: "Add adaptive behavior",
			kind: "behavior",
			status: status1,
			objective: "Expose one observable behavior",
			acceptance: ["new behavior is observable"],
			covers: ["add adaptive behavior"],
			hard_depends_on: ["evidence"],
			soft_after: [],
			required_capabilities: ["bash"],
			risk: "medium",
			information_value: "medium",
			effort: "low",
			expected_files: ["src/example.ts", "test/example.test.ts"],
			invalidated_by: ["repository convention differs"],
			test: {
				paths: ["test/example.test.ts"],
				command: "node --test behavior",
				red_expectation: "new assertion fails",
				green_expectation: "new assertion passes",
			},
		},
		{
			step_id: "evidence",
			title: "Confirm repository seam",
			kind: "support",
			status: status2,
			objective: "Confirm the smallest implementation seam",
			acceptance: ["seam is evidenced"],
			covers: [],
			hard_depends_on: [],
			soft_after: [],
			required_capabilities: ["bash"],
			risk: "low",
			information_value: "high",
			effort: "low",
			expected_files: ["src/example.ts"],
			invalidated_by: [],
			validation: "node --test evidence",
		},
	];
}

async function setup(overrides: Record<string, string> = {}) {
	Object.assign(process.env, {
		PLAN_SYNTHESIS_V1: "on",
		PLAN_TDD_EVIDENCE: "on",
		PLAN_DYNAMIC_ROUTE: "on",
		PLAN_STEP_CONTEXT: "current",
		...overrides,
	});
	const runtime = await import(`../lib/plan-v4-runtime.ts?v4=${Date.now()}-${Math.random()}`);
	const fp = makeFakePi();
	runtime.registerPlanV4(fp.pi as any);
	for (const name of ["bash", "edit", "subagent"]) {
		fp.tools.set(name, { name, description: `${name} tool`, sourceInfo: { source: "builtin", path: "builtin" } });
	}
	fp.pi.setActiveTools([...fp.tools.keys()]);
	return fp;
}

test("v4 integration: reflection gates write, artifacts persist, routing jumps, and observed RED/GREEN gates completion", async () => {
	const fp = await setup();
	const cwd = tmp();
	const { ctx } = makeCtx(cwd);
	await fp.commands.get("plan").handler("add adaptive behavior", ctx);

	const early = await callTool(fp, "plan_write", {
		summary: "too early",
		final_validation: "node --test final",
		items: steps(),
	}, cwd);
	assert.equal(early.isError, true);
	assert.match(early.content[0].text, /reflection sequence incomplete/);

	const first = await callTool(fp, "plan_reflect", reflection("interpretation"), cwd);
	assert.match(first.content[0].text, /evidence/);
	const second = await callTool(fp, "plan_reflect", reflection("evidence", true), cwd);
	assert.match(second.content[0].text, /Reflection complete/);
	const written = await callTool(fp, "plan_write", {
		summary: "Evidence first, then one behavior increment.",
		final_validation: "node --test final",
		items: steps(),
	}, cwd);
	assert.equal(written.isError, undefined);
	const state0 = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
	assert.equal(state0.schema_version, 4);
	assert.ok(existsSync(join(cwd, ".pi", "plans", state0.run_id, "CONTEXT.md")));
	assert.ok(existsSync(join(cwd, ".pi", "plans", state0.run_id, "01-add-adaptive-behavior.md")));
	assert.ok(existsSync(join(cwd, ".pi", "plans", state0.run_id, "02-confirm-repository-seam.md")));

	await callTool(fp, "plan_go", {}, cwd);
	const illegal = await callTool(fp, "plan_route", {
		action: "select",
		target_step: "behavior",
		observed_outcome: "start",
		evidence_receipts: [],
		invalidated_assumptions: [],
		reason: "try behavior first",
	}, cwd);
	assert.equal(illegal.isError, true);
	assert.match(illegal.content[0].text, /unmet hard dependencies/);
	const selectedEvidence = await callTool(fp, "plan_route", {
		action: "select",
		target_step: "evidence",
		observed_outcome: "behavior is blocked",
		evidence_receipts: ["blocked-behavior"],
		invalidated_assumptions: [],
		reason: "jump to the independent evidence step",
	}, cwd);
	assert.match(selectedEvidence.content[0].text, /Selected evidence/);

	await fire(fp, "tool_call", { toolName: "bash", toolCallId: "ev-green", input: { command: "node --test evidence" } }, ctx);
	await fire(fp, "tool_result", { toolName: "bash", toolCallId: "ev-green", input: {}, content: [{ type: "text", text: "pass" }], isError: false }, ctx);
	await callTool(fp, "plan_route", {
		action: "checkpoint",
		current_step: "evidence",
		observed_outcome: "validation passed",
		evidence_receipts: ["ev-green"],
		invalidated_assumptions: [],
		reason: "GREEN boundary",
	}, cwd);
	await callTool(fp, "plan_write", {
		summary: "Evidence confirmed.",
		final_validation: "node --test final",
		items: steps("pending", "done"),
	}, cwd);
	await callTool(fp, "plan_route", {
		action: "select",
		target_step: "behavior",
		observed_outcome: "dependency is done",
		evidence_receipts: ["ev-green"],
		invalidated_assumptions: [],
		reason: "implement behavior",
	}, cwd);
	const parentEdit = await fire(fp, "tool_call", { toolName: "edit", toolCallId: "parent-edit", input: { path: "src/example.ts" } }, ctx);
	assert.equal(parentEdit, undefined, "current-context profile allows parent mutation");

	await fire(fp, "tool_call", { toolName: "bash", toolCallId: "red", input: { command: "node --test behavior" } }, ctx);
	await fire(fp, "tool_result", { toolName: "bash", toolCallId: "red", input: {}, content: [{ type: "text", text: "expected failure" }], isError: true }, ctx);
	await callTool(fp, "plan_route", {
		action: "checkpoint", current_step: "behavior", observed_outcome: "RED observed",
		evidence_receipts: ["red"], invalidated_assumptions: [], reason: "RED boundary",
	}, cwd);
	await fire(fp, "tool_call", { toolName: "bash", toolCallId: "green", input: { command: "node --test behavior" } }, ctx);
	await fire(fp, "tool_result", { toolName: "bash", toolCallId: "green", input: {}, content: [{ type: "text", text: "pass" }], isError: false }, ctx);
	await callTool(fp, "plan_route", {
		action: "checkpoint", current_step: "behavior", observed_outcome: "GREEN observed",
		evidence_receipts: ["green"], invalidated_assumptions: [], reason: "GREEN boundary",
	}, cwd);
	await fire(fp, "tool_call", { toolName: "bash", toolCallId: "final", input: { command: "node --test final" } }, ctx);
	await fire(fp, "tool_result", { toolName: "bash", toolCallId: "final", input: {}, content: [{ type: "text", text: "all pass" }], isError: false }, ctx);
	const complete = await callTool(fp, "plan_write", {
		summary: "Complete and verified.",
		final_validation: "node --test final",
		items: steps("done", "done"),
	}, cwd);
	assert.equal(complete.isError, undefined);
	const finalState = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
	assert.equal(finalState.items[0].red_receipt.exit_code, 1);
	assert.equal(finalState.items[0].green_receipt.exit_code, 0);
	assert.equal(finalState.final_receipt.exit_code, 0);
});

test("v4 one-shot path starts only when the model explicitly calls plan_reflect", async () => {
	const fp = await setup();
	const cwd = tmp();
	const { ctx } = makeCtx(cwd);
	await fire(fp, "before_agent_start", {
		prompt: "add adaptive behavior",
		systemPrompt: "test",
		systemPromptOptions: {},
	}, ctx);
	assert.equal(existsSync(join(cwd, ".pi", "plan-state.json")), false, "capturing the request does not dispatch or create a plan");
	const reflected = await callTool(fp, "plan_reflect", reflection("interpretation"), cwd);
	assert.match(reflected.content[0].text, /Next required stage: evidence/);
	const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
	assert.equal(state.request, "add adaptive behavior");
	assert.equal(state.schema_version, 4);
	assert.equal(state.autonomy, "yolo");
});

test("v4 integration: backtrack stales transitive dependents without touching source files", async () => {
	const fp = await setup();
	const cwd = tmp();
	const { ctx } = makeCtx(cwd);
	await fp.commands.get("plan").handler("add adaptive behavior", ctx);
	await callTool(fp, "plan_reflect", reflection("interpretation"), cwd);
	await callTool(fp, "plan_reflect", reflection("evidence", true), cwd);
	await callTool(fp, "plan_write", {
		summary: "two steps",
		final_validation: "node --test final",
		items: steps(),
	}, cwd);
	const before = readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8");
	const routed = await callTool(fp, "plan_route", {
		action: "backtrack",
		target_step: "evidence",
		observed_outcome: "new convention found",
		evidence_receipts: ["reveal"],
		invalidated_assumptions: ["repository convention differs"],
		reason: "later evidence invalidated the seam",
	}, cwd);
	assert.equal(routed.isError, undefined);
	const after = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
	assert.deepEqual(after.items.map((item: any) => item.status), ["pending", "stale"]);
	assert.equal(existsSync(join(cwd, "src", "example.ts")), false, `routing must not create source files; prior state bytes=${before.length}`);
});

test("v4 route churn blocks after three consecutive no-evidence changes", async () => {
	const fp = await setup();
	const cwd = tmp();
	const { ctx } = makeCtx(cwd);
	await fp.commands.get("plan").handler("add adaptive behavior", ctx);
	await callTool(fp, "plan_reflect", reflection("interpretation"), cwd);
	await callTool(fp, "plan_reflect", reflection("evidence", true), cwd);
	await callTool(fp, "plan_write", { summary: "route churn", final_validation: "node --test final", items: steps() }, cwd);
	await callTool(fp, "plan_go", {}, cwd);
	await callTool(fp, "plan_route", {
		action: "select", target_step: "evidence", observed_outcome: "ready",
		evidence_receipts: [], invalidated_assumptions: [], reason: "select",
	}, cwd);
	let last: any;
	for (let index = 0; index < 4; index += 1) {
		last = await callTool(fp, "plan_route", {
			action: "checkpoint", current_step: "evidence", observed_outcome: "unchanged",
			evidence_receipts: [], invalidated_assumptions: [], reason: "reconsider",
		}, cwd);
	}
	assert.equal(last.isError, true);
	assert.match(last.content[0].text, /Route churn limit reached/);
	const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
	assert.equal(state.items.find((item: any) => item.id === "evidence").status, "blocked");
});

test("v4 checkpoint clears a doomed route when a required capability disappears", async () => {
	const fp = await setup();
	const cwd = tmp();
	const { ctx } = makeCtx(cwd);
	await fp.commands.get("plan").handler("add adaptive behavior", ctx);
	await callTool(fp, "plan_reflect", reflection("interpretation"), cwd);
	await callTool(fp, "plan_reflect", reflection("evidence", true), cwd);
	await callTool(fp, "plan_write", { summary: "capability anomaly", final_validation: "node --test final", items: steps() }, cwd);
	await callTool(fp, "plan_go", {}, cwd);
	await callTool(fp, "plan_route", {
		action: "select", target_step: "evidence", observed_outcome: "ready",
		evidence_receipts: [], invalidated_assumptions: [], reason: "select",
	}, cwd);
	fp.pi.setActiveTools(fp.pi.getActiveTools().filter((name: string) => name !== "bash"));
	const checkpoint = await callTool(fp, "plan_route", {
		action: "checkpoint", current_step: "evidence", observed_outcome: "bash disappeared",
		evidence_receipts: [], invalidated_assumptions: [], reason: "capability anomaly",
	}, cwd);
	assert.equal(checkpoint.isError, true);
	assert.match(checkpoint.content[0].text, /Required capability became unavailable/);
	const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
	assert.equal(state.route.selected_step_id, undefined);
	assert.equal(state.items.find((item: any) => item.id === "evidence").status, "pending");
});

test("v4 spawn profile blocks parent mutation and requires explicit executor spawn", async () => {
	const fp = await setup({ PLAN_STEP_CONTEXT: "spawn" });
	const cwd = tmp();
	const { ctx } = makeCtx(cwd);
	await fp.commands.get("plan").handler("add adaptive behavior", ctx);
	await callTool(fp, "plan_reflect", reflection("interpretation"), cwd);
	await callTool(fp, "plan_reflect", reflection("evidence", true), cwd);
	await callTool(fp, "plan_write", { summary: "spawned work", final_validation: "node --test final", items: steps() }, cwd);
	await callTool(fp, "plan_go", {}, cwd);
	await callTool(fp, "plan_route", {
		action: "select", target_step: "evidence", observed_outcome: "ready",
		evidence_receipts: [], invalidated_assumptions: [], reason: "select evidence",
	}, cwd);
	const edit = await fire(fp, "tool_call", { toolName: "edit", toolCallId: "edit-1", input: {} }, ctx);
	assert.equal(edit.block, true);
	assert.match(edit.reason, /subagent\(executor/);
	const wrong = await fire(fp, "tool_call", {
		toolName: "subagent", toolCallId: "sub-wrong", input: { agent: "explorer", mode: "spawn" },
	}, ctx);
	assert.equal(wrong.block, true);
	const allowed = await fire(fp, "tool_call", {
		toolName: "subagent", toolCallId: "sub-ok", input: {
			agent: "executor",
			mode: "spawn",
			task: "evidence: Confirm the smallest implementation seam. Acceptance: seam is evidenced. Run node --test evidence.",
		},
	}, ctx);
	assert.equal(allowed, undefined);
	await fire(fp, "tool_result", {
		toolName: "subagent", toolCallId: "sub-ok", input: {}, content: [{ type: "text", text: "done" }],
		details: {
			results: [{
				usage: { input: 12, output: 4 },
				messages: [
					{ role: "assistant", content: [{ type: "toolCall", id: "child-test", name: "bash", arguments: { command: "node --test evidence" } }] },
					{ role: "toolResult", toolCallId: "child-test", isError: false, content: [{ type: "text", text: "pass" }] },
				],
			}],
		},
		isError: false,
	}, ctx);
	const duplicate = await fire(fp, "tool_call", {
		toolName: "subagent",
		toolCallId: "sub-duplicate",
		input: {
			agent: "executor",
			mode: "spawn",
			task: "evidence: Confirm the smallest implementation seam. Acceptance: seam is evidenced. Run node --test evidence.",
		},
	}, ctx);
	assert.equal(duplicate.block, true);
	assert.match(duplicate.reason, /already has its one spawn receipt/);
	const spawnState = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
	assert.equal(spawnState.items.find((item: any) => item.id === "evidence").green_receipt.exit_code, 0);
	const trace = readFileSync(join(cwd, ".pi", "traces", "plan-runner.jsonl"), "utf8");
	assert.match(trace, /plan_subagent/);
});

test("v4 Plannotator bridge is explicit, timeout-bounded, and approval is content-SHA bound", async () => {
	const fp = await setup({ PLAN_PLANNOTATOR_BRIDGE: "on", PLAN_REVIEW_TIMEOUT_MS: "100", PLAN_STEP_CONTEXT: "current" });
	const cwd = tmp();
	const { ctx, notes } = makeCtx(cwd);
	await fp.commands.get("plan").handler("add adaptive behavior", ctx);
	await callTool(fp, "plan_reflect", reflection("interpretation"), cwd);
	await callTool(fp, "plan_reflect", reflection("evidence", true), cwd);
	await callTool(fp, "plan_write", {
		summary: "review me",
		final_validation: "node --test final",
		items: steps(),
	}, cwd);

	await fp.commands.get("plan-review").handler("", ctx);
	assert.ok(notes.some((note) => /listener unavailable/.test(note)));
	let state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
	assert.equal(state.review.status, "pending");
	const held = await callTool(fp, "plan_go", {}, cwd);
	assert.equal(held.isError, true);
	assert.match(held.content[0].text, /review is pending/);

	let statusQueries = 0;
	fp.pi.events.on("plannotator:request", (raw: unknown) => {
		const request = raw as { action: string; respond(value: unknown): void };
		if (request.action === "plan-review") {
			request.respond({ status: "handled", result: { status: "pending", reviewId: "review-1" } });
		} else if (request.action === "review-status") {
			statusQueries += 1;
			request.respond({ status: "handled", result: { status: "pending", reviewId: "review-1" } });
		}
	});
	await fp.commands.get("plan-review").handler("", ctx);
	state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
	assert.equal(state.review.status, "pending");
	assert.equal(state.review.review_id, "review-1");
	await fire(fp, "session_start", {}, ctx);
	assert.equal(statusQueries, 1, "restart recovery queries Plannotator by reviewId");
	fp.pi.events.emit("plannotator:review-result", {
		reviewId: "review-1",
		approved: true,
		feedback: "",
	});
	await new Promise((resolve) => setTimeout(resolve, 20));
	state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
	assert.equal(state.review.status, "approved");
	const started = await callTool(fp, "plan_go", {}, cwd);
	assert.equal(started.isError, undefined);

	await callTool(fp, "plan_write", {
		summary: "reviewed content changed",
		final_validation: "node --test final",
		items: steps().map((step) => step.step_id === "behavior"
			? { ...step, acceptance: [...step.acceptance, "reviewed edge case is covered"] }
			: step),
	}, cwd);
	state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
	assert.equal(state.review.status, "pending");
});

test("v4 non-testable behavior needs explicit approval and the smallest alternative validation", async () => {
	const fp = await setup({ PLAN_PLANNOTATOR_BRIDGE: "off", PLAN_STEP_CONTEXT: "current" });
	const cwd = tmp();
	const { ctx } = makeCtx(cwd);
	await fp.commands.get("plan").handler("document a manual-only behavior", ctx);
	const base = {
		requirements: ["document a manual-only behavior"],
		constraints: [],
		non_goals: [],
		assumptions: [],
		uncertainties: [],
		capability_use: ["bash"],
		scope_cuts: [],
		test_seams: ["syntax validation only"],
	};
	await callTool(fp, "plan_reflect", {
		...base, stage: "interpretation", evidence_refs: [], signals: { test_exception: true },
	}, cwd);
	await callTool(fp, "plan_reflect", {
		...base, stage: "evidence", evidence_refs: ["docs/manual.md:1"], signals: {},
	}, cwd);
	await callTool(fp, "plan_reflect", {
		...base, stage: "critique", evidence_refs: ["no executable interface exists"], signals: { test_exception: true },
	}, cwd);
	const item = {
		step_id: "manual",
		title: "Document manual behavior",
		kind: "behavior",
		status: "pending",
		objective: "Document the manual-only behavior",
		acceptance: ["operator instructions are explicit"],
		covers: ["document a manual-only behavior"],
		hard_depends_on: [],
		soft_after: [],
		required_capabilities: ["bash"],
		risk: "low",
		information_value: "low",
		effort: "low",
		expected_files: ["docs/manual.md"],
		invalidated_by: [],
		test_exception: {
			reason: "No executable interface exists",
			validation: "node --test test/manual-validation.test.js",
		},
	};
	const manualWritten = await callTool(fp, "plan_write", {
		summary: "one manual behavior",
		final_validation: "node --test final",
		items: [item],
	}, cwd);
	assert.equal(manualWritten.isError, undefined, manualWritten.content[0].text);
	const held = await callTool(fp, "plan_go", {}, cwd);
	assert.equal(held.isError, true);
	assert.match(held.content[0].text, /explicit user or approved review/);
	await fp.commands.get("plan-approve-exceptions").handler("", ctx);
	const started = await callTool(fp, "plan_go", {}, cwd);
	assert.equal(started.isError, undefined);
	await callTool(fp, "plan_route", {
		action: "select", target_step: "manual", observed_outcome: "approved",
		evidence_receipts: ["user-approval"], invalidated_assumptions: [], reason: "run alternative validation",
	}, cwd);
	await fire(fp, "tool_call", { toolName: "bash", toolCallId: "manual-green", input: { command: "node --test test/manual-validation.test.js" } }, ctx);
	await fire(fp, "tool_result", { toolName: "bash", toolCallId: "manual-green", input: {}, content: [{ type: "text", text: "valid" }], isError: false }, ctx);
	await callTool(fp, "plan_route", {
		action: "checkpoint", current_step: "manual", observed_outcome: "alternative validation passed",
		evidence_receipts: ["manual-green"], invalidated_assumptions: [], reason: "validation boundary",
	}, cwd);
	await fire(fp, "tool_call", { toolName: "bash", toolCallId: "manual-final", input: { command: "node --test final" } }, ctx);
	await fire(fp, "tool_result", { toolName: "bash", toolCallId: "manual-final", input: {}, content: [{ type: "text", text: "pass" }], isError: false }, ctx);
	const done = await callTool(fp, "plan_write", {
		summary: "manual behavior complete",
		final_validation: "node --test final",
		items: [{ ...item, status: "done" }],
	}, cwd);
	assert.equal(done.isError, undefined);
});
