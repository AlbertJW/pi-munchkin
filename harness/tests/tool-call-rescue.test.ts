import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fire, makeFakePi } from "./integration-harness.ts";
import { detectPseudoToolCall, rescueMessage } from "../extensions/tool-call-rescue.ts";
import {
	buildControlProposal, emitControlDecision, setControlArbiterActive,
} from "../lib/control-proposal.ts";

// Run: cd ~/.pi/agent && TELEMETRY_FILE=$(mktemp) TELEMETRY_SOURCE=test \
//        npx -y tsx --test tests/tool-call-rescue.test.ts
// (TELEMETRY_FILE is not optional: without it these tests append REAL rows to
//  ~/.pi/agent/telemetry/events.jsonl tagged source=\"interactive\", polluting the
//  live telemetry stream the harness is measured from.)

test("detects the measured qwen artifact shapes", () => {
	const qwen = detectPseudoToolCall('<tool_call></tool_call>\n<function=bash>{"command":"ls"}</function>');
	assert.equal(qwen?.signature, "function-tag");
	assert.equal(qwen?.toolName, "bash");

	const bare = detectPseudoToolCall("I will call the tool now: <tool_call>");
	assert.equal(bare?.signature, "tool-call-tag");
	assert.equal(bare?.toolName, null);

	const fenced = detectPseudoToolCall('Here is the call:\n```json\n{"name": "read", "arguments": {"path": "a.ts"}}\n```');
	assert.equal(fenced?.signature, "fenced-json-call");
	assert.equal(fenced?.toolName, "read");
});

test("does not fire on prose, non-call JSON, or ordinary code fences", () => {
	assert.equal(detectPseudoToolCall("I ran the tests and they pass."), null);
	assert.equal(detectPseudoToolCall('```json\n{"status": "ok", "count": 3}\n```'), null);
	assert.equal(detectPseudoToolCall("```js\nconsole.log(1)\n```"), null);
	assert.equal(detectPseudoToolCall(""), null);
});

test("rescue message carries the self-correction instruction and tool name", () => {
	const msg = rescueMessage({ signature: "function-tag", toolName: "bash" });
	assert.match(msg, /not a valid tool call/);
	assert.match(msg, /`bash`/);
	assert.match(msg, /REAL tool call/);
});

test("extension: dark by default; steers at most twice; detection keeps recording", async () => {
	const fp = makeFakePi();
	const sent = fp.sent;
	const prev = process.env.TOOL_CALL_RESCUE;
	try {
		// ADOPTED 2026-08-07: default-on (was dark candidate c49) — =off kills, unset registers.
		process.env.TOOL_CALL_RESCUE = "off";
		const off = await import(`../extensions/tool-call-rescue.ts?off=${Date.now()}-${Math.random()}`);
		off.default(fp.pi as never);
		assert.equal(fp.handlers.size, 0, "TOOL_CALL_RESCUE=off kills it");

		delete process.env.TOOL_CALL_RESCUE; // unset = default-on
		const on = await import(`../extensions/tool-call-rescue.ts?on=${Date.now()}-${Math.random()}`);
		on.default(fp.pi as never);
		await fire(fp, "session_start", {});
		const pseudo = {
			turnIndex: 1,
			message: { role: "assistant", content: [{ type: "text", text: "<function=bash>ls</function>" }] },
		};
		await fire(fp, "turn_end", pseudo);
		await fire(fp, "turn_end", pseudo);
		await fire(fp, "turn_end", pseudo); // damper: third detection, no steer
		assert.equal(sent.length, 2, "max 2 rescues per session");

		const real = {
			turnIndex: 4,
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "<tool_call> mentioned in passing" },
					{ type: "toolCall", id: "x", name: "bash", arguments: {} },
				],
			},
		};
		await fire(fp, "turn_end", real);
		assert.equal(sent.length, 2, "real toolCall present — never fires");

		await fire(fp, "session_start", {});
		await fire(fp, "turn_end", pseudo);
		assert.equal(sent.length, 3, "damper resets per session");

		// Now assertable for the first time: the inline fake dropped the options
		// argument, so the rescue's DELIVERY MODE was never checked. A rescue that
		// pi silently drops would revive nothing — the exact class of defect this
		// candidate exists to fix.
		for (const d of fp.deliveries) {
			assert.equal(d.deliverAs, "steer");
			assert.equal(d.effective, "delivered", "a rescue must actually reach the model");
		}
	} finally {
		if (prev === undefined) delete process.env.TOOL_CALL_RESCUE; else process.env.TOOL_CALL_RESCUE = prev;
	}
});

test("a rescue the arbiter DROPS does not spend the session budget", async () => {
	// MAX_RESCUES bounds what the model RECEIVES. The budget used to be charged when
	// the proposal was emitted, and `tool_rescue` is the second-lowest arbiter
	// priority — so under the shipped CONTROL_ARBITER=enforce two lost boundaries
	// exhausted the session budget without the model ever seeing a rescue
	// (2026-08-21).
	const fp = makeFakePi();
	const telemetry = join(mkdtempSync(join(tmpdir(), "rescue-")), "events.jsonl");
	const previous = {
		rescue: process.env.TOOL_CALL_RESCUE, control: process.env.CONTROL_ARBITER,
		telemetry: process.env.TELEMETRY, file: process.env.TELEMETRY_FILE,
		source: process.env.TELEMETRY_SOURCE,
	};
	Object.assign(process.env, {
		CONTROL_ARBITER: "enforce", TELEMETRY: "on", TELEMETRY_FILE: telemetry,
		TELEMETRY_SOURCE: "test",
	});
	delete process.env.TOOL_CALL_RESCUE;
	try {
		const on = await import(`../extensions/tool-call-rescue.ts?arbiter=${Date.now()}-${Math.random()}`);
		on.default(fp.pi as never);
		// An arbiter is live on this bus, so the extension defers delivery to it.
		setControlArbiterActive(fp.pi.events as never, true);
		await fire(fp, "session_start", {});
		const pseudo = (turnIndex: number) => ({
			turnIndex,
			message: { role: "assistant", content: [{ type: "text", text: "<function=bash>ls</function>" }] },
		});
		const decide = (turnIndex: number, source: "loop-breaker" | "tool-call-rescue") => {
			emitControlDecision(fp.pi.events as never, {
				v: 1, boundarySequence: turnIndex, mode: "enforce", proposalCount: 2,
				collisionCount: 1, legacyActionCount: 0,
				winner: buildControlProposal({
					boundarySequence: turnIndex,
					kind: source === "loop-breaker" ? "failure_recovery" : "tool_rescue",
					reason: source === "loop-breaker" ? "session_repeat" : "pseudo_tool_call",
					source, cooldownKey: `k:${turnIndex}`,
					messageFactory: source === "loop-breaker" ? "loop-tier" : "tool-rescue",
					legacyActed: false,
				}),
			});
		};
		// Three boundaries lost to a higher-priority proposal: nothing delivered,
		// nothing charged.
		for (const turnIndex of [1, 2, 3]) {
			await fire(fp, "turn_end", pseudo(turnIndex));
			decide(turnIndex, "loop-breaker");
		}
		// The budget is intact, so two real deliveries still get through.
		for (const turnIndex of [4, 5]) {
			await fire(fp, "turn_end", pseudo(turnIndex));
			decide(turnIndex, "tool-call-rescue");
		}
		// ...and only then is it exhausted.
		await fire(fp, "turn_end", pseudo(6));
		decide(6, "tool-call-rescue");

		const steered = readFileSync(telemetry, "utf8").split("\n").filter(Boolean)
			.map((line) => JSON.parse(line) as Record<string, unknown>)
			.filter((row) => row.ext === "tool-call-rescue" && row.kind === "steered");
		assert.deepEqual(steered.map((row) => row.delivered), [false, false, false, true, true],
			"dropped proposals must record delivered:false and cost nothing");
		assert.deepEqual(steered.map((row) => row.turnIndex), [1, 2, 3, 4, 5]);
	} finally {
		setControlArbiterActive(fp.pi.events as never, false);
		for (const [key, value] of Object.entries({
			TOOL_CALL_RESCUE: previous.rescue, CONTROL_ARBITER: previous.control,
			TELEMETRY: previous.telemetry, TELEMETRY_FILE: previous.file,
			TELEMETRY_SOURCE: previous.source,
		})) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
	}
});
