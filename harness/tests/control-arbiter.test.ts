import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ControlArbiterQueue } from "../lib/control-arbiter.ts";
import {
	buildControlProposal, controlEnforces, emitControlProposal, onControlDecision, setControlArbiterActive,
	type ControlEffect, type ControlKind,
	type ControlProposalEnvelope,
} from "../lib/control-proposal.ts";
import { fire, makeFakePi } from "./integration-harness.ts";

function envelope(kind: ControlKind, boundarySequence = 1, effect: ControlEffect = "message"): ControlProposalEnvelope {
	return {
		proposal: buildControlProposal({
			boundarySequence, kind, reason: kind === "verification_required" ? "exact_gate_missing" : "loop_strategy_change",
			source: kind === "verification_required" ? "verify-gate" : "loop-breaker",
			cooldownKey: `${kind}:${boundarySequence}`, messageFactory: kind === "verification_required" ? "verify-wrap" : "loop-tier",
			effect, legacyActed: true,
		}),
		delivery: { message: kind },
	};
}

test("arbiter picks one highest-priority proposal and reports collisions", () => {
	const queue = new ControlArbiterQueue();
	queue.add(envelope("context_hint"));
	queue.add(envelope("verification_required"));
	queue.add(envelope("failure_recovery"));
	queue.add(envelope("safety_consequence"));
	const { decision, delivery } = queue.decide(1, "shadow");
	assert.equal(decision.proposalCount, 4);
	assert.equal(decision.collisionCount, 3);
	assert.equal(decision.legacyActionCount, 4);
	assert.equal(decision.winner?.kind, "safety_consequence");
	assert.equal(delivery?.message, "safety_consequence");
	assert.equal(queue.decide(1, "shadow").decision.proposalCount, 0, "a boundary is consumed once");
});

test("duplicate proposal IDs count once and ties preserve emission order", () => {
	const queue = new ControlArbiterQueue();
	const first = envelope("failure_recovery");
	const second = envelope("failure_recovery");
	queue.add(first);
	queue.add(first);
	queue.add(second);
	const { decision } = queue.decide(1, "shadow");
	assert.equal(decision.proposalCount, 2);
	assert.equal(decision.winner?.proposalIdHash, first.proposal.proposalIdHash);
});

test("pending control memory is bounded across boundaries, not per boundary", () => {
	const queue = new ControlArbiterQueue();
	for (let boundary = 0; boundary < 129; boundary++) queue.add(envelope("context_hint", boundary));
	assert.equal(queue.decide(0, "shadow").decision.proposalCount, 0);
	assert.equal(queue.decide(128, "shadow").decision.proposalCount, 1);
});

test("in-memory delivery text is bounded before it enters the pending queue", () => {
	const queue = new ControlArbiterQueue();
	const huge = envelope("context_hint");
	huge.delivery.message = "x".repeat(20_000);
	queue.add(huge);
	assert.equal(queue.decide(1, "enforce").delivery?.message?.length, 4000);
});

async function installed(mode: "shadow" | "enforce", telemetry: "off" | "on") {
	const oldMode = process.env.CONTROL_ARBITER;
	const oldTelemetry = process.env.TELEMETRY;
	process.env.CONTROL_ARBITER = mode;
	process.env.TELEMETRY = telemetry;
	const fp = makeFakePi();
	const decisions: unknown[] = [];
	onControlDecision(fp.pi.events as never, (decision) => decisions.push(decision));
	const mod = await import(`../extensions/control-arbiter.ts?mode=${mode}-${telemetry}-${Date.now()}-${Math.random()}`);
	mod.default(fp.pi as never);
	if (oldMode === undefined) delete process.env.CONTROL_ARBITER; else process.env.CONTROL_ARBITER = oldMode;
	if (oldTelemetry === undefined) delete process.env.TELEMETRY; else process.env.TELEMETRY = oldTelemetry;
	return { fp, decisions };
}

test("shadow compares a winner without delivering; enforce delivers exactly one", async () => {
	for (const mode of ["shadow", "enforce"] as const) {
		const { fp, decisions } = await installed(mode, "off");
		for (const proposal of [envelope("tool_rescue"), envelope("verification_required")]) {
			emitControlProposal(fp.pi.events as never, proposal.proposal, proposal.delivery);
		}
		await fire(fp, "turn_end", { turnIndex: 1, message: { role: "assistant", content: [] }, toolResults: [] }, {});
		assert.equal(decisions.length, 1);
		assert.equal(fp.sent.length, mode === "enforce" ? 1 : 0);
		if (mode === "enforce") assert.equal(fp.sent[0], "verification_required");
	}
});

test("off mode registers no handlers or control subscriber", async () => {
	const previous = process.env.CONTROL_ARBITER;
	process.env.CONTROL_ARBITER = "off";
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/control-arbiter.ts?off=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		assert.equal(fp.handlers.size, 0);
		assert.equal(fp.busHandlers.size, 0);
	} finally {
		if (previous === undefined) delete process.env.CONTROL_ARBITER; else process.env.CONTROL_ARBITER = previous;
	}
});

test("enforce fails safe when an explicitly selected surface omits the arbiter", () => {
	const previous = process.env.CONTROL_ARBITER;
	process.env.CONTROL_ARBITER = "enforce";
	try {
		const fp = makeFakePi();
		assert.equal(controlEnforces(fp.pi.events as never), false);
		setControlArbiterActive(fp.pi.events as never, true);
		assert.equal(controlEnforces(fp.pi.events as never), true);
		setControlArbiterActive(fp.pi.events as never, false);
		assert.equal(controlEnforces(fp.pi.events as never), false);
	} finally {
		if (previous === undefined) delete process.env.CONTROL_ARBITER; else process.env.CONTROL_ARBITER = previous;
	}
});

test("tier-three abort wins without an automatic continuation message", async () => {
	const { fp } = await installed("enforce", "off");
	let aborted = 0;
	const abort = envelope("safe_abort", 4, "abort");
	abort.delivery = { abort: () => { aborted += 1; }, message: "must-not-send" };
	emitControlProposal(fp.pi.events as never, abort.proposal, abort.delivery);
	emitControlProposal(fp.pi.events as never, envelope("verification_required", 4).proposal, { message: "verify" });
	await fire(fp, "turn_end", { turnIndex: 4, message: { role: "assistant", content: [] }, toolResults: [] }, {});
	assert.equal(aborted, 1);
	assert.deepEqual(fp.sent, []);
});

test("dormant micro-gate delivers through the arbiter when explicitly enabled", async () => {
	const previous = {
		CONTROL_ARBITER: process.env.CONTROL_ARBITER,
		MICRO_GATE: process.env.MICRO_GATE,
		MICRO_GATE_SLOP: process.env.MICRO_GATE_SLOP,
		TELEMETRY: process.env.TELEMETRY,
	};
	process.env.CONTROL_ARBITER = "enforce";
	process.env.MICRO_GATE = "on";
	process.env.MICRO_GATE_SLOP = "off";
	process.env.TELEMETRY = "off";
	const cwd = mkdtempSync(join(tmpdir(), "control-micro-gate-"));
	writeFileSync(join(cwd, "broken.js"), "function broken( {\n");
	try {
		const fp = makeFakePi();
		const nonce = `${Date.now()}-${Math.random()}`;
		const [micro, arbiter] = await Promise.all([
			import(`../extensions/micro-gate.ts?control=${nonce}`),
			import(`../extensions/control-arbiter.ts?micro=${nonce}`),
		]);
		micro.default(fp.pi as never);
		arbiter.default(fp.pi as never);
		await fire(fp, "turn_end", {
			turnIndex: 3,
			message: { role: "assistant", content: [{ type: "toolCall", id: "m", name: "edit", arguments: { path: "broken.js" } }] },
			toolResults: [],
		}, { cwd, ui: { notify() {} } });
		assert.equal(fp.sent.length, 1);
		assert.match(fp.sent[0], /^\[micro-gate\]/);
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
	}
});

test("real verify and rescue producers collide into one verification intervention", async () => {
	const previous = {
		CONTROL_ARBITER: process.env.CONTROL_ARBITER,
		TOOL_CALL_RESCUE: process.env.TOOL_CALL_RESCUE,
		TELEMETRY: process.env.TELEMETRY,
	};
	process.env.TOOL_CALL_RESCUE = "on";
	process.env.TELEMETRY = "off";
	try {
		for (const mode of ["shadow", "enforce"] as const) {
			process.env.CONTROL_ARBITER = mode;
			const cwd = mkdtempSync(join(tmpdir(), `control-collision-${mode}-`));
			writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
			const fp = makeFakePi();
			const nonce = `${mode}-${Date.now()}-${Math.random()}`;
			const [verify, rescue, arbiter] = await Promise.all([
				import(`../extensions/verify-gate.ts?collision=${nonce}`),
				import(`../extensions/tool-call-rescue.ts?collision=${nonce}`),
				import(`../extensions/control-arbiter.ts?collision=${nonce}`),
			]);
			verify.default(fp.pi as never);
			rescue.default(fp.pi as never);
			arbiter.default(fp.pi as never);
			const ctx = { cwd, ui: { notify() {} } };
			await fire(fp, "session_start", { reason: "new" }, ctx);
			await fire(fp, "turn_end", {
				turnIndex: 1,
				message: { role: "assistant", content: [{ type: "toolCall", id: "m", name: "edit", arguments: { path: "src/a.ts" } }] },
				toolResults: [],
			}, ctx);
			await fire(fp, "turn_end", {
				turnIndex: 2,
				message: { role: "assistant", content: [{ type: "text", text: '<tool_call>{"name":"read","arguments":{"path":"src/a.ts"}}</tool_call>' }] },
				toolResults: [],
			}, ctx);
			assert.equal(fp.sent.length, mode === "shadow" ? 2 : 1);
			assert.match(fp.sent[0], /^\[verify-gate\]/);
		}
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
	}
});

test("telemetry on and off produce identical control decisions and messages", async () => {
	const run = async (telemetryMode: "on" | "off") => {
		const previous = {
			CONTROL_ARBITER: process.env.CONTROL_ARBITER,
			TELEMETRY: process.env.TELEMETRY,
			TELEMETRY_FILE: process.env.TELEMETRY_FILE,
		};
		process.env.CONTROL_ARBITER = "enforce";
		process.env.TELEMETRY = telemetryMode;
		process.env.TELEMETRY_FILE = join(mkdtempSync(join(tmpdir(), "control-telemetry-")), "events.jsonl");
		try {
			const fp = makeFakePi();
			const decisions: unknown[] = [];
			onControlDecision(fp.pi.events as never, (decision) => decisions.push(decision));
			const mod = await import(`../extensions/control-arbiter.ts?equivalence=${telemetryMode}-${Date.now()}-${Math.random()}`);
			mod.default(fp.pi as never);
			const proposal = envelope("verification_required", 9);
			emitControlProposal(fp.pi.events as never, proposal.proposal, { message: "verify-once" });
			await fire(fp, "turn_end", { turnIndex: 9, message: { role: "assistant", content: [] }, toolResults: [] }, {});
			return { sent: [...fp.sent], decision: decisions[0] };
		} finally {
			for (const [key, value] of Object.entries(previous)) {
				if (value === undefined) delete process.env[key]; else process.env[key] = value;
			}
		}
	};
	const off = await run("off");
	const on = await run("on");
	assert.deepEqual(on.sent, off.sent);
	assert.deepEqual(
		{ ...(on.decision as Record<string, unknown>), winner: (on.decision as { winner: { proposalIdHash: string } }).winner && "winner" },
		{ ...(off.decision as Record<string, unknown>), winner: (off.decision as { winner: { proposalIdHash: string } }).winner && "winner" },
	);
});
