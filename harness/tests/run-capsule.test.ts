import assert from "node:assert/strict";
import {
	existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installRunKernel } from "../extensions/run-kernel.ts";
import runCapsule from "../extensions/run-capsule.ts";
import loopBreaker from "../extensions/loop-breaker.ts";
import { emptyState, projectRunStateToBlackboard } from "../lib/blackboard.ts";
import {
	CapsuleCheckpointQueue, latestRunStateEntry, makeRunStateEntry, newCapsuleId,
	readLatestRunCapsule, RUN_STATE_ENTRY_TYPE, runCapsuleDirectory, writeRunCapsule,
} from "../lib/run-capsule-store.ts";
import { renderRunCapsule, renderRunStatus } from "../lib/run-capsule-renderer.ts";
import { RunStateStoreV1, validateRunStateSnapshot } from "../lib/run-kernel-state.ts";
import type { RunEventV1, RunStateV1 } from "../lib/run-kernel-types.ts";
import { fire, makeCtx, makeFakePi } from "./integration-harness.ts";

const H = "a".repeat(64);

function session(sequence = 1): RunEventV1 {
	return {
		v: 1, type: "run/session-started", sequence, atMs: sequence,
		sessionIdHash: H, runIdHash: H, generation: 1, surfaceHash: H,
		piVersion: "0.83.2", provider: "local", model: "small",
		activeToolCount: 4, allToolCount: 8, preservedExplicitTools: false,
		detectedGateHash: H, sandboxPosture: "unknown",
		legacy: {
			planActive: false, planItemActive: false, planItemHash: null,
			planOpenItems: null, planBlockedItems: null, verifyKnown: false,
			verifyMutated: false, verifyOk: false,
		},
	};
}

function validState(): RunStateV1 {
	const store = new RunStateStoreV1();
	assert.equal(store.apply(session()).applied, true);
	return store.snapshot();
}

function withEnv(values: Record<string, string | undefined>, work: () => Promise<void>): Promise<void> {
	const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) delete process.env[key]; else process.env[key] = value;
	}
	return work().finally(() => {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
	});
}

test("private capsule writes atomically outside the worktree with private modes", async () => {
	const agentDirectory = mkdtempSync(join(tmpdir(), "run-capsule-agent-"));
	const cwd = mkdtempSync(join(tmpdir(), "run-capsule-worktree-"));
	const before = readdirSync(cwd);
	const capsuleId = newCapsuleId();
	const state = validState();
	const result = await writeRunCapsule({ agentDirectory, cwd, capsuleId, state, markdown: renderRunCapsule(state) });
	assert.equal(result.ok, true);
	assert.deepEqual(readdirSync(cwd), before);
	const directory = runCapsuleDirectory(agentDirectory, cwd, capsuleId);
	assert.equal(statSync(directory).mode & 0o777, 0o700);
	for (const file of ["state-v1.json", "capsule.md"]) assert.equal(statSync(join(directory, file)).mode & 0o777, 0o600);
	assert.equal(readdirSync(directory).some((name) => name.endsWith(".tmp")), false);
});

test("concurrent runs use unique directories and remain independently restorable", async () => {
	const agentDirectory = mkdtempSync(join(tmpdir(), "run-capsule-concurrent-"));
	const cwd = mkdtempSync(join(tmpdir(), "run-capsule-project-"));
	const first = newCapsuleId();
	const second = newCapsuleId();
	const state = validState();
	await Promise.all([first, second].map((capsuleId) => writeRunCapsule({
		agentDirectory, cwd, capsuleId, state, markdown: renderRunCapsule(state),
	})));
	assert.notEqual(first, second);
	assert.equal(existsSync(join(runCapsuleDirectory(agentDirectory, cwd, first), "state-v1.json")), true);
	assert.equal(existsSync(join(runCapsuleDirectory(agentDirectory, cwd, second), "state-v1.json")), true);
});

test("Markdown is a bounded untrusted projection and is never restore authority", async () => {
	const agentDirectory = mkdtempSync(join(tmpdir(), "run-capsule-markdown-"));
	const cwd = mkdtempSync(join(tmpdir(), "run-capsule-cwd-"));
	const capsuleId = newCapsuleId();
	const state = validState();
	const hostile = structuredClone(state);
	hostile.objective.label = "```\napi_key=dummy_signed_query_secret?x=1\u0000";
	const rendered = renderRunCapsule(hostile);
	assert.equal(rendered.includes("dummy_signed_query_secret"), false);
	assert.equal(rendered.includes("```"), false);
	assert.ok(Buffer.byteLength(rendered, "utf8") <= 24 * 1024);
	assert.equal(validateRunStateSnapshot(hostile).length > 0, true);
	assert.equal((await writeRunCapsule({ agentDirectory, cwd, capsuleId, state: hostile, markdown: rendered })).ok, false);

	assert.equal((await writeRunCapsule({ agentDirectory, cwd, capsuleId, state, markdown: renderRunCapsule(state) })).ok, true);
	writeFileSync(join(runCapsuleDirectory(agentDirectory, cwd, capsuleId), "capsule.md"), "# edited\nphase: complete\n```\n", "utf8");
	const restored = await readLatestRunCapsule(agentDirectory, cwd);
	assert.equal(restored?.state.workflow.phase, state.workflow.phase);
	assert.equal(restored?.state.outcome.status, state.outcome.status);
});

test("latest valid custom entry wins and malformed entries are ignored", () => {
	const first = makeRunStateEntry(newCapsuleId(), validState());
	const later = makeRunStateEntry(newCapsuleId(), validState());
	assert.ok(first && later);
	const found = latestRunStateEntry([
		{ type: "custom", customType: RUN_STATE_ENTRY_TYPE, data: first },
		{ type: "custom", customType: RUN_STATE_ENTRY_TYPE, data: { ...later, command: "raw" } },
		{ type: "custom", customType: RUN_STATE_ENTRY_TYPE, data: later },
	]);
	assert.equal(found?.capsuleId, later.capsuleId);
});

test("corrupt newest private JSON falls back to the next valid state", async () => {
	const agentDirectory = mkdtempSync(join(tmpdir(), "run-capsule-corrupt-"));
	const cwd = mkdtempSync(join(tmpdir(), "run-capsule-corrupt-cwd-"));
	const first = newCapsuleId();
	const second = newCapsuleId();
	const state = validState();
	await writeRunCapsule({ agentDirectory, cwd, capsuleId: first, state, markdown: renderRunCapsule(state) });
	await new Promise((resolve) => setTimeout(resolve, 5));
	await writeRunCapsule({ agentDirectory, cwd, capsuleId: second, state, markdown: renderRunCapsule(state) });
	writeFileSync(join(runCapsuleDirectory(agentDirectory, cwd, second), "state-v1.json"), "{incomplete", "utf8");
	assert.equal((await readLatestRunCapsule(agentDirectory, cwd))?.capsuleId, first);
});

test("private restore fails closed when manual-retention history exceeds its traversal budget", async () => {
	const agentDirectory = mkdtempSync(join(tmpdir(), "run-capsule-budget-"));
	const cwd = mkdtempSync(join(tmpdir(), "run-capsule-budget-cwd-"));
	for (let index = 0; index < 65; index++) {
		mkdirSync(runCapsuleDirectory(agentDirectory, cwd, newCapsuleId()), { recursive: true });
	}
	assert.equal(await readLatestRunCapsule(agentDirectory, cwd), null);
});

test("checkpoint queue coalesces normal updates and flushes the newest state", async () => {
	const written: RunStateV1[] = [];
	const queue = new CapsuleCheckpointQueue(async (state) => {
		written.push(state);
		return { ok: true, stateBytes: 1, markdownBytes: 1, failureClass: null };
	});
	const first = validState();
	const second = structuredClone(first);
	second.context.compactionGeneration = 2;
	const third = structuredClone(first);
	third.context.compactionGeneration = 3;
	queue.request(first);
	queue.request(second);
	queue.request(third);
	await queue.flush();
	assert.equal(written.length, 1);
	assert.equal(written[0].context.compactionGeneration, 3);
});

test("ledger I/O failure returns only a safe class and leaves RunState intact", async () => {
	const root = mkdtempSync(join(tmpdir(), "run-capsule-io-failure-"));
	const blockedAgentDirectory = join(root, "not-a-directory");
	writeFileSync(blockedAgentDirectory, "sentinel", "utf8");
	const state = validState();
	const before = JSON.stringify(state);
	const result = await writeRunCapsule({
		agentDirectory: blockedAgentDirectory,
		cwd: root,
		capsuleId: newCapsuleId(),
		state,
		markdown: renderRunCapsule(state),
	});
	assert.equal(result.ok, false);
	assert.equal(result.failureClass, "unknown");
	assert.equal(JSON.stringify(result).includes(root), false);
	assert.equal(JSON.stringify(state), before);
});

test("restore is closed, sequence-safe, and blackboard projection is non-mutating", () => {
	const original = validState();
	original.context.usagePct = 42;
	original.plan.accepted = true;
	original.plan.openItems = 2;
	const store = new RunStateStoreV1();
	assert.equal(store.restore(original), true);
	assert.equal(store.apply(session(2)).applied, true);
	assert.equal(store.snapshot().plan.openItems, 2);
	assert.equal(store.restore({ ...original, command: "raw" }), false);
	const board = emptyState();
	const projected = projectRunStateToBlackboard(board, original);
	assert.equal(board.plan.runId, null);
	assert.equal(projected.plan.openItems, 2);
	assert.equal(projected.context.pct, 42);
});

test("default shadow capsule persists without sending model-visible text", async () => {
	const agentDirectory = mkdtempSync(join(tmpdir(), "run-capsule-integration-"));
	const cwd = mkdtempSync(join(tmpdir(), "run-capsule-integration-cwd-"));
	await withEnv({ PI_CODING_AGENT_DIR: agentDirectory, RUN_CAPSULE: undefined, TELEMETRY: "off" }, async () => {
		const fp = makeFakePi();
		let id = 0;
		const controller = installRunKernel(fp.pi as never, {
			idFactory: () => `capsule-${++id}`, detectGate: async () => null, surfaceHash: () => H,
		});
		runCapsule(fp.pi as never);
		const { ctx } = makeCtx(cwd);
		await fire(fp, "session_start", { reason: "new" }, ctx);
		await fire(fp, "before_agent_start", { prompt: "inspect", systemPrompt: "", systemPromptOptions: {} }, ctx);
		await fire(fp, "agent_start", {}, ctx);
		await fire(fp, "agent_end", { messages: [{ role: "assistant", content: [{ type: "text", text: "done" }] }] }, ctx);
		await fire(fp, "agent_settled", {}, ctx);
		await fire(fp, "agent_settled", {}, ctx);
		assert.equal(fp.sent.length, 0);
		assert.equal(fp.entries.length, 1);
		assert.equal(fp.entries[0].type, RUN_STATE_ENTRY_TYPE);
		assert.equal((fp.entries[0].data as { state: RunStateV1 }).state.outcome.status, "complete");
		assert.equal(controller.getState().outcome.status, "complete");
		assert.equal(fp.commands.has("run-status"), true);
		assert.equal(readdirSync(cwd).length, 0);
	});
});

test("phase transitions are checkpointed before the originating tool boundary returns", async () => {
	const agentDirectory = mkdtempSync(join(tmpdir(), "run-capsule-phase-"));
	const cwd = mkdtempSync(join(tmpdir(), "run-capsule-phase-cwd-"));
	await withEnv({ PI_CODING_AGENT_DIR: agentDirectory, RUN_CAPSULE: "shadow", TELEMETRY: "off" }, async () => {
		const fp = makeFakePi();
		let id = 0;
		installRunKernel(fp.pi as never, {
			idFactory: () => `phase-${++id}`, detectGate: async () => null, surfaceHash: () => H,
		});
		runCapsule(fp.pi as never);
		const { ctx } = makeCtx(cwd);
		await fire(fp, "session_start", { reason: "new" }, ctx);
		await fire(fp, "agent_start", {}, ctx);
		await fire(fp, "tool_execution_start", { toolCallId: "r1", toolName: "read", args: { path: "safe.txt" } }, ctx);
		const restored = await readLatestRunCapsule(agentDirectory, cwd);
		assert.equal(restored?.state.workflow.phase, "local_recon");
	});
});

test("off mode registers no capsule handlers or command; recovery mode remains non-injecting", async () => {
	for (const mode of ["off", "recovery"] as const) {
		await withEnv({ RUN_CAPSULE: mode, TELEMETRY: "off" }, async () => {
			const fp = makeFakePi();
			runCapsule(fp.pi as never);
			if (mode === "off") {
				assert.equal(fp.handlers.size, 0);
				assert.equal(fp.commands.size, 0);
				assert.equal(fp.busHandlers.size, 0);
			} else {
				assert.equal(fp.commands.has("run-status"), true);
				assert.deepEqual(fp.sent, []);
			}
		});
	}
});

test("resume restores the latest valid custom state before current-session metadata", async () => {
	const agentDirectory = mkdtempSync(join(tmpdir(), "run-capsule-resume-"));
	const cwd = mkdtempSync(join(tmpdir(), "run-capsule-resume-cwd-"));
	await withEnv({ PI_CODING_AGENT_DIR: agentDirectory, RUN_CAPSULE: "shadow", TELEMETRY: "off" }, async () => {
		const first = makeFakePi();
		let firstId = 0;
		const firstController = installRunKernel(first.pi as never, {
			idFactory: () => `first-${++firstId}`, detectGate: async () => null, surfaceHash: () => H,
		});
		runCapsule(first.pi as never);
		const firstContext = makeCtx(cwd).ctx;
		await fire(first, "session_start", { reason: "new" }, firstContext);
		await fire(first, "before_agent_start", { prompt: "inspect", systemPrompt: "", systemPromptOptions: {} }, firstContext);
		await fire(first, "agent_start", {}, firstContext);
		await fire(first, "agent_end", { messages: [] }, firstContext);
		await fire(first, "agent_settled", {}, firstContext);
		const originalRun = firstController.getState().identity.runIdHash;
		const originalSession = firstController.getState().identity.sessionIdHash;
		const saved = first.entries.at(-1)?.data;
		assert.ok(saved);

		const second = makeFakePi();
		let secondId = 0;
		const nextSurface = "b".repeat(64);
		const secondController = installRunKernel(second.pi as never, {
			idFactory: () => `second-${++secondId}`, detectGate: async () => null, surfaceHash: () => nextSurface,
		});
		runCapsule(second.pi as never);
		const secondContext = makeCtx(cwd).ctx;
		secondContext.sessionManager.getBranch = () => [{ type: "custom", customType: RUN_STATE_ENTRY_TYPE, data: saved }];
		await fire(second, "session_start", { reason: "resume" }, secondContext);
		const restored = secondController.getState();
		assert.equal(restored.identity.runIdHash, originalRun);
		assert.notEqual(restored.identity.sessionIdHash, originalSession);
		assert.equal(restored.identity.surfaceHash, nextSurface);
		assert.equal(restored.identity.generation, 2);
		assert.equal(restored.lifecycle.state, "starting");
		assert.deepEqual(second.sent, []);
	});
});

test("run status contains no artifact path, URL, command, or endpoint", () => {
	const text = renderRunStatus(validState());
	assert.equal(/(?:\/Users\/|\/private\/|https?:|command|endpoint)/i.test(text), false);
});

test("snapshot schema rejects raw fields and invalid bounded values", () => {
	const state = validState();
	assert.ok(validateRunStateSnapshot({ ...state, output: "raw tool result" }).length > 0);
	const invalidContext = structuredClone(state);
	invalidContext.context.usagePct = 101;
	assert.ok(validateRunStateSnapshot(invalidContext).length > 0);
	const invalidCapabilities = structuredClone(state);
	invalidCapabilities.capabilities.activeToolCount = invalidCapabilities.capabilities.allToolCount + 1;
	assert.ok(validateRunStateSnapshot(invalidCapabilities).length > 0);
});

test("default shadow registers no prompt-context handler", async () => {
	await withEnv({ RUN_CAPSULE: undefined, TELEMETRY: "off" }, async () => {
		const fp = makeFakePi();
		runCapsule(fp.pi as never);
		assert.equal(fp.handlers.has("context"), false);
		assert.equal(fp.handlers.has("before_agent_start"), false);
		assert.deepEqual(fp.sent, []);
	});
});

test("recovery mode injects one brief after compaction and none on ordinary context calls", async () => {
	const agentDirectory = mkdtempSync(join(tmpdir(), "run-capsule-recovery-context-"));
	const cwd = mkdtempSync(join(tmpdir(), "run-capsule-recovery-context-cwd-"));
	await withEnv({ PI_CODING_AGENT_DIR: agentDirectory, RUN_CAPSULE: "recovery", TELEMETRY: "off" }, async () => {
		const fp = makeFakePi();
		installRunKernel(fp.pi as never, { idFactory: () => "recovery-context-id", detectGate: async () => null, surfaceHash: () => H });
		runCapsule(fp.pi as never);
		const { ctx } = makeCtx(cwd);
		await fire(fp, "session_start", { reason: "new" }, ctx);
		await fire(fp, "agent_start", {}, ctx);
		await fire(fp, "session_compact", { reason: "manual", willRetry: false }, ctx);
		const first = await fire(fp, "context", { messages: [{ role: "user", content: [{ type: "text", text: "continue" }] }] }, ctx);
		const injected = first.at(-1) as { role?: string; customType?: string; content?: string };
		assert.equal(injected.role, "custom");
		assert.equal(injected.customType, "pi-munchkin:recovery-brief");
		assert.match(String(injected.content), /recovery_reason: compaction/);
		const second = await fire(fp, "context", { messages: [{ role: "user", content: [{ type: "text", text: "ordinary" }] }] }, ctx);
		assert.equal(second.length, 1);
	});
});

test("recovery provider failure injects only on the unsettled retry window", async () => {
	const agentDirectory = mkdtempSync(join(tmpdir(), "run-capsule-recovery-provider-"));
	const cwd = mkdtempSync(join(tmpdir(), "run-capsule-recovery-provider-cwd-"));
	await withEnv({ PI_CODING_AGENT_DIR: agentDirectory, RUN_CAPSULE: "recovery", LOOP_EPISODE_MODE: "shadow", TELEMETRY: "off" }, async () => {
		const fp = makeFakePi();
		installRunKernel(fp.pi as never, { idFactory: () => "recovery-provider-id", detectGate: async () => null, surfaceHash: () => H });
		loopBreaker(fp.pi as never);
		runCapsule(fp.pi as never);
		const { ctx } = makeCtx(cwd);
		await fire(fp, "session_start", { reason: "new" }, ctx);
		await fire(fp, "agent_start", {}, ctx);
		await fire(fp, "after_provider_response", { status: 500, headers: {} }, ctx);
		await fire(fp, "agent_end", { messages: [] }, ctx);
		const retry = await fire(fp, "context", { messages: [] }, ctx);
		assert.match(String((retry.at(-1) as { content?: unknown })?.content), /recovery_reason: provider_retry/);
		await fire(fp, "agent_settled", {}, ctx);
		const ordinary = await fire(fp, "context", { messages: [] }, ctx);
		assert.equal(ordinary.length, 0);
	});
});

test("recovery resume commands append one brief without starting a model turn", async () => {
	const agentDirectory = mkdtempSync(join(tmpdir(), "run-capsule-recovery-resume-"));
	const cwd = mkdtempSync(join(tmpdir(), "run-capsule-recovery-resume-cwd-"));
	await withEnv({ PI_CODING_AGENT_DIR: agentDirectory, RUN_CAPSULE: "recovery", LOOP_EPISODE_MODE: "shadow", TELEMETRY: "off" }, async () => {
		const fp = makeFakePi();
		installRunKernel(fp.pi as never, { idFactory: () => "recovery-resume-id", detectGate: async () => null, surfaceHash: () => H });
		loopBreaker(fp.pi as never);
		runCapsule(fp.pi as never);
		const { ctx } = makeCtx(cwd);
		await fire(fp, "session_start", { reason: "new" }, ctx);
		await fire(fp, "agent_start", {}, ctx);
		await fp.commands.get("loop-resume")?.handler("", ctx);
		await fp.commands.get("run-resume")?.handler("", ctx);
		assert.equal(fp.customDeliveries.length, 2);
		assert.equal(fp.customDeliveries.every((item) => item.api === "sendMessage" && item.triggerTurn === false && item.effective === "queued-next-turn"), true);
		assert.equal(fp.deliveries.some((item) => item.api === "sendUserMessage"), false);
	});
});
