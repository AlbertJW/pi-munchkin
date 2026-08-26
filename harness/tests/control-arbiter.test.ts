import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ControlArbiterQueue } from "../lib/control-arbiter.ts";
import {
	buildControlProposal, controlArbiterMode, controlEnforces, emitControlProposal, onControlDecision, setControlArbiterActive,
	type ControlEffect, type ControlKind,
	type ControlProposalEnvelope,
} from "../lib/control-proposal.ts";
import { emitRivalProposal, fire, makeFakePi, resetPiGlobals } from "./integration-harness.ts";
import { boardState, noteTool, resetBoard } from "../lib/blackboard.ts";

function envelope(kind: ControlKind, boundarySequence = 1, effect: ControlEffect = "message"): ControlProposalEnvelope {
	return {
		proposal: buildControlProposal({
			boundarySequence, kind, reason: kind === "verification_required" ? "exact_gate_missing" : "loop_recovery",
			source: kind === "verification_required" ? "verify-gate" : "loop-breaker",
			cooldownKey: `${kind}:${boundarySequence}`, messageFactory: kind === "verification_required" ? "verify-wrap" : "loop-tier",
			effect, legacyActed: true,
		}),
		delivery: { message: kind },
	};
}

function lensEnvelope(boundarySequence = 1, message = "[harness summary]\nstate"): ControlProposalEnvelope {
	return {
		proposal: buildControlProposal({
			boundarySequence, kind: "context_hint", reason: "state_lens", source: "session-blackboard",
			cooldownKey: `lens:${boundarySequence}`, messageFactory: "state-lens", effect: "message", legacyActed: false,
		}),
		delivery: { message },
	};
}

test("arbiter picks one highest-priority proposal and reports collisions", () => {
	const queue = new ControlArbiterQueue();
	queue.add(envelope("context_hint"));
	queue.add(envelope("verification_required"));
	queue.add(envelope("failure_recovery"));
	queue.add(envelope("plan_resolution"));
	const { decision, delivery } = queue.decide(1, "shadow");
	assert.equal(decision.proposalCount, 4);
	assert.equal(decision.collisionCount, 3);
	assert.equal(decision.legacyActionCount, 4);
	assert.equal(decision.winner?.kind, "failure_recovery");
	assert.equal(delivery?.message, "failure_recovery");
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

test("enforce merges the lens before one correction and reserves the intact tail", () => {
	const queue = new ControlArbiterQueue();
	const correction = `[loop-breaker]\n${"c".repeat(3850)}`;
	const winner = envelope("failure_recovery");
	winner.delivery.message = correction;
	queue.add(lensEnvelope(1, `[harness summary]\n${"l".repeat(4000)}`));
	queue.add(winner);
	const result = queue.decide(1, "enforce");
	assert.equal(result.lensMerged, true);
	assert.equal(result.delivery?.message?.length, 4000);
	assert.ok(result.delivery?.message?.startsWith("[harness summary]"));
	assert.ok(result.delivery?.message?.endsWith(correction), "the corrective message is never truncated");
});

test("repeated-failure recovery wins and retains the exact verification requirement at the end", () => {
	const queue = new ControlArbiterQueue();
	const recovery = envelope("failure_recovery");
	recovery.delivery.message = `[loop-breaker] failure_class=compile_or_lint; observed=repeated_failure; required=obtain_discriminating_fact.\n${"r".repeat(3600)}`;
	const verification = envelope("verification_required");
	verification.delivery.message = "[verify-gate] Exact project gate required after the latest mutation.";
	queue.add(lensEnvelope(1, `[harness summary]\n${"l".repeat(4000)}`));
	queue.add(verification);
	queue.add(recovery);
	const result = queue.decide(1, "enforce");
	assert.equal(result.decision.winner?.kind, "failure_recovery");
	assert.equal(result.verificationMerged, true);
	assert.equal(result.lensMerged, true);
	assert.equal(result.delivery?.message?.length, 4000);
	assert.ok(result.delivery?.message?.startsWith("[harness summary]"));
	assert.ok(result.delivery?.message?.endsWith(verification.delivery.message!),
		"the exact verification requirement is the intact final suffix");
});

test("only verify-gate exact requirements supplement recovery", () => {
	const queue = new ControlArbiterQueue();
	queue.add(envelope("failure_recovery"));
	const research = envelope("verification_required");
	research.proposal = buildControlProposal({
		boundarySequence: 1, kind: "verification_required", reason: "research_unverified",
		source: "ketch", cooldownKey: "research", messageFactory: "research-wrap", legacyActed: false,
	});
	research.delivery.message = "research reminder";
	queue.add(research);
	const result = queue.decide(1, "enforce");
	assert.equal(result.verificationMerged, false);
	assert.equal(result.delivery?.message, "failure_recovery");
});

test("shadow leaves legacy lens and correction delivery separate", () => {
	const queue = new ControlArbiterQueue();
	queue.add(lensEnvelope());
	queue.add(envelope("failure_recovery"));
	const result = queue.decide(1, "shadow");
	assert.equal(result.lensMerged, false);
	assert.equal(result.delivery?.message, "failure_recovery");
});

test("abort and shutdown effects never acquire a lens or continuation", () => {
	for (const effect of ["abort", "shutdown"] as const) {
		const queue = new ControlArbiterQueue();
		queue.add(lensEnvelope());
		queue.add(envelope("failure_recovery"));
		queue.add(envelope("safe_abort", 1, effect));
		const result = queue.decide(1, "enforce");
		assert.equal(result.lensMerged, false);
		assert.equal(result.verificationMerged, false);
		assert.equal(result.decision.winner?.effect, effect, "terminal effects outrank every message kind");
		assert.equal(result.delivery?.message, "safe_abort");
	}
});

test("explicit shadow remains a rollback after the default changes", () => {
	assert.equal(controlArbiterMode({}, "enforce"), "enforce");
	assert.equal(controlArbiterMode({ CONTROL_ARBITER: "shadow" }, "enforce"), "shadow");
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

test("enforce emits one merged message with correction intact", async () => {
	const { fp } = await installed("enforce", "off");
	const correction = "CORRECTION MUST REMAIN INTACT";
	const winner = envelope("failure_recovery", 7);
	winner.delivery.message = correction;
	for (const proposal of [lensEnvelope(7), winner]) {
		emitControlProposal(fp.pi.events as never, proposal.proposal, proposal.delivery);
	}
	await fire(fp, "turn_end", { turnIndex: 7, message: { role: "assistant", content: [] }, toolResults: [] }, {});
	assert.equal(fp.sent.length, 1);
	assert.match(fp.sent[0], /^\[harness summary\]/);
	assert.ok(fp.sent[0].endsWith(correction));
});

test("manifest-order blackboard and arbiter produce one merged loop correction", async () => {
	const previous = {
		CONTROL_ARBITER: process.env.CONTROL_ARBITER,
		STATE_LENS: process.env.STATE_LENS,
		TELEMETRY: process.env.TELEMETRY,
		TELEMETRY_SOURCE: process.env.TELEMETRY_SOURCE,
	};
	process.env.CONTROL_ARBITER = "enforce";
	process.env.STATE_LENS = "steer";
	process.env.TELEMETRY = "off";
	process.env.TELEMETRY_SOURCE = "gate"; // suppress cockpit I/O in this control test
	try {
		const fp = makeFakePi();
		const nonce = `${Date.now()}-${Math.random()}`;
		const [blackboard, arbiter] = await Promise.all([
			import(`../extensions/session-blackboard.ts?merged=${nonce}`),
			import(`../extensions/control-arbiter.ts?merged=${nonce}`),
		]);
		// This is manifest order: the producer subscribes before the arbiter.
		blackboard.default(fp.pi as never);
		arbiter.default(fp.pi as never);
		resetBoard();
		noteTool(boardState(), { toolName: "bash", args: { command: "npm test" }, isError: true, errorText: "failed" });
		const correction = "CHANGE STRATEGY NOW";
		const loop = envelope("failure_recovery", 9);
		loop.delivery.message = correction;
		emitControlProposal(fp.pi.events as never, loop.proposal, loop.delivery);
		await fire(fp, "turn_end", { turnIndex: 9, message: { role: "assistant", content: [] }, toolResults: [] }, {
			getContextUsage: () => null, hasUI: false,
		});
		assert.equal(fp.sent.length, 1);
		assert.match(fp.sent[0], /^\[harness summary\]/);
		assert.ok(fp.sent[0].endsWith(correction));
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
		resetBoard();
	}
});

test("manifest-order loop recovery, exact verification, and lens produce one complete correction", async () => {
	const previous = {
		CONTROL_ARBITER: process.env.CONTROL_ARBITER,
		STATE_LENS: process.env.STATE_LENS,
		TELEMETRY: process.env.TELEMETRY,
		TELEMETRY_SOURCE: process.env.TELEMETRY_SOURCE,
	};
	process.env.CONTROL_ARBITER = "enforce";
	process.env.STATE_LENS = "steer";
	process.env.TELEMETRY = "off";
	process.env.TELEMETRY_SOURCE = "gate";
	try {
		const fp = makeFakePi();
		const nonce = `${Date.now()}-${Math.random()}`;
		const [loop, blackboard, arbiter] = await Promise.all([
			import(`../extensions/loop-breaker.ts?combined=${nonce}`),
			import(`../extensions/session-blackboard.ts?combined=${nonce}`),
			import(`../extensions/control-arbiter.ts?combined=${nonce}`),
		]);
		// Real relative manifest order: loop producer, lens producer, arbiter.
		loop.default(fp.pi as never);
		blackboard.default(fp.pi as never);
		arbiter.default(fp.pi as never);
		resetBoard();
		const cwd = mkdtempSync(join(tmpdir(), "control-loop-verify-"));
		const ctx = { cwd, getContextUsage: () => null, hasUI: false, ui: { notify() {} }, abort() {}, shutdown() {} };
		await fire(fp, "session_start", { reason: "new" }, ctx);
		noteTool(boardState(), {
			toolName: "bash", args: { command: "npm test" }, isError: true, errorText: "failed",
		});
		const readTurn = (turnIndex: number) => ({
			turnIndex,
			message: { role: "assistant", provider: "local-llama", content: [
				{ type: "toolCall", id: `read-${turnIndex}`, name: "read", arguments: { path: "src/a.ts" } },
			] },
			toolResults: [],
		});
		await fire(fp, "turn_end", readTurn(1), ctx);
		const exactRequirement = "[verify-gate] The exact gate `npm test` has not passed after the latest mutation. Run it before handoff.";
		const verification = envelope("verification_required", 2);
		emitControlProposal(fp.pi.events as never, verification.proposal, { message: exactRequirement });
		await fire(fp, "turn_end", readTurn(2), ctx);
		assert.equal(fp.sent.length, 1, "the collision boundary emits exactly one message");
		const combined = fp.sent[0]!;
		assert.match(combined, /^\[harness summary\]/);
		assert.match(combined, /\[loop-breaker\]/);
		assert.match(combined, /\[verify-gate\]/);
		assert.ok(combined.endsWith(exactRequirement),
			"the exact verification requirement remains intact at the final suffix");
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
		resetBoard();
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
	const lens = lensEnvelope(4, "must-not-merge");
	emitControlProposal(fp.pi.events as never, lens.proposal, lens.delivery);
	emitControlProposal(fp.pi.events as never, envelope("verification_required", 4).proposal, { message: "verify" });
	await fire(fp, "turn_end", { turnIndex: 4, message: { role: "assistant", content: [] }, toolResults: [] }, {});
	assert.equal(aborted, 1);
	assert.deepEqual(fp.sent, []);
});

test("shutdown wins without a lens or automatic continuation message", async () => {
	const { fp } = await installed("enforce", "off");
	let shutdowns = 0;
	const stop = envelope("safe_abort", 5, "shutdown");
	stop.delivery = { shutdown: () => { shutdowns += 1; }, message: "must-not-send" };
	emitControlProposal(fp.pi.events as never, stop.proposal, stop.delivery);
	const lens = lensEnvelope(5, "must-not-merge");
	emitControlProposal(fp.pi.events as never, lens.proposal, lens.delivery);
	await fire(fp, "turn_end", { turnIndex: 5, message: { role: "assistant", content: [] }, toolResults: [] }, {});
	assert.equal(shutdowns, 1);
	assert.deepEqual(fp.sent, []);
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

// --- the invariant this suite never had ------------------------------------
//
// Every other test here asserts what the ARBITER emitted. None asserts what a
// PRODUCER looks like after losing. That is the blind spot that let the
// charge-at-proposal defect survive at fourteen sites after being fixed at two.
//
// The shape below is the one to copy when migrating each remaining producer: drive
// real contention through a REAL arbiter, and assert the loser can still act.
// tool-call-rescue is the reference implementation, so this passes today — that is
// the point. It pins the behaviour the other producers must be brought to.

test("a producer that LOSES the boundary keeps its budget (tool-call-rescue reference)", async () => {
	const previous = {
		rescue: process.env.TOOL_CALL_RESCUE, control: process.env.CONTROL_ARBITER,
		telemetry: process.env.TELEMETRY, source: process.env.TELEMETRY_SOURCE,
	};
	Object.assign(process.env, { CONTROL_ARBITER: "enforce", TELEMETRY: "off", TELEMETRY_SOURCE: "test" });
	delete process.env.TOOL_CALL_RESCUE;
	try {
		const fp = makeFakePi();
		const nonce = `${Date.now()}-${Math.random()}`;
		// Manifest order: tool-call-rescue is index 4, the arbiter is 24. The arbiter
		// marks itself active on load, so the producer defers delivery to it.
		const [rescue, arbiter] = await Promise.all([
			import(`../extensions/tool-call-rescue.ts?loser=${nonce}`),
			import(`../extensions/control-arbiter.ts?loser=${nonce}`),
		]);
		rescue.default(fp.pi as never);
		arbiter.default(fp.pi as never);
		await fire(fp, "session_start", {});

		const pseudoCall = (turnIndex: number) => ({
			turnIndex,
			message: { role: "assistant", content: [{ type: "text", text: "<function=bash>ls</function>" }] },
			toolResults: [],
		});
		const rescuesSent = () => fp.sent.filter((message) => /pseudo|function=|tool call/i.test(message)).length;

		// Boundaries 1-2: a higher-priority rival wins, so the rescue is composed and
		// dropped. MAX_RESCUES is 2 — if losing spent the budget, it is now gone.
		for (const turnIndex of [1, 2]) {
			emitRivalProposal(fp, turnIndex);
			await fire(fp, "turn_end", pseudoCall(turnIndex), {});
		}
		assert.equal(rescuesSent(), 0, "precondition: a losing rescue reaches the model zero times");

		// Boundaries 3-4: uncontested. A budget that was never spent still has two.
		for (const turnIndex of [3, 4]) await fire(fp, "turn_end", pseudoCall(turnIndex), {});
		assert.equal(rescuesSent(), 2, "losing boundaries consumed the session rescue budget");

		// Boundary 5: genuinely exhausted now, so silence here is correct, not a bug.
		await fire(fp, "turn_end", pseudoCall(5), {});
		assert.equal(rescuesSent(), 2, "the budget must still be a real bound once actually spent");
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
		resetPiGlobals();
	}
});

test("a terminal winner takes no merged supplements, so its losers are genuinely dropped", async () => {
	// The distinction `emitRivalProposal({terminal:true})` exists for. Both merge
	// rescues (control-arbiter.ts:51-84) require a `message` winner, so under a
	// terminal winner verify-gate's nag and the lens are dropped outright rather than
	// delivered as a suffix. Any charge-on-delivery work must treat these as losses.
	const queue = new ControlArbiterQueue();
	const nag = envelope("verification_required", 11);
	const terminal = envelope("safe_abort", 11, "abort");
	queue.add(nag);
	queue.add(terminal);
	const { decision, delivery, verificationMerged, lensMerged } = queue.decide(11, "enforce");
	assert.equal(decision.winner?.effect, "abort");
	assert.equal(verificationMerged, false, "a terminal winner must not carry the nag");
	assert.equal(lensMerged, false);
	// The queue still hands back the winner's OWN delivery — the arbiter extension is
	// what declines to send it for a terminal effect (control-arbiter.ts:36-43). What
	// matters here is that the nag's text was not appended to it.
	assert.equal(delivery?.message, "safe_abort", "the winner's own delivery, unmodified");
	assert.equal(delivery?.message?.includes("verification_required"), false, "the nag must not ride along");
});
