import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fire, makeCtx, makeFakePi } from "./integration-harness.ts";
import loopBreaker from "../extensions/loop-breaker.ts";
import verifyGate from "../extensions/verify-gate.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "pi-control-delivery-"));

function assistantTurn(content: unknown[], turnIndex: number, toolResults: unknown[] = []) {
	return {
		message: { role: "assistant", provider: "local-llamacpp", content },
		turnIndex,
		toolResults,
	};
}

test("loop-breaker correction is steering, not a queued follow-up", async () => {
	const fp = makeFakePi();
	loopBreaker(fp.pi as any);
	await fire(fp, "session_start", {});
	const read = { type: "toolCall", id: "read-1", name: "read", arguments: { path: "src/app.ts", offset: 0 } };

	await fire(fp, "turn_end", assistantTurn([read], 1));
	await fire(fp, "turn_end", assistantTurn([{ ...read, id: "read-2" }], 2));

	assert.equal(fp.deliveries.length, 1);
	assert.match(fp.deliveries[0].text, /^\[loop-breaker\]/);
	assert.equal(fp.deliveries[0].deliverAs, "steer");
});

test("verify-gate correction is steering, not a queued follow-up", async () => {
	const fp = makeFakePi();
	verifyGate(fp.pi as any);
	const cwd = tmp();
	const { ctx } = makeCtx(cwd);
	await fire(fp, "session_start", {}, ctx);

	const edit = { type: "toolCall", id: "edit-1", name: "edit", arguments: { path: "src/app.ts" } };
	await fire(fp, "turn_end", assistantTurn([edit], 1, [{
		toolCallId: "edit-1", toolName: "edit", isError: false,
		content: [{ type: "text", text: "updated" }],
	}]));
	await fire(fp, "turn_end", assistantTurn([{ type: "text", text: "Done." }], 2));

	assert.equal(fp.deliveries.length, 1);
	assert.match(fp.deliveries[0].text, /^\[verify-gate\]/);
	assert.equal(fp.deliveries[0].deliverAs, "steer");
});
