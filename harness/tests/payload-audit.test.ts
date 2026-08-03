import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fire, makeFakePi } from "./integration-harness.ts";
import { analyzePayload } from "../extensions/payload-audit.ts";

// Run: cd ~/.pi/agent && TELEMETRY_FILE=$(mktemp) TELEMETRY_SOURCE=test \
//        npx -y tsx --test tests/payload-audit.test.ts
// (TELEMETRY_FILE is not optional: without it these tests append REAL rows to
//  ~/.pi/agent/telemetry/events.jsonl tagged source=\"interactive\", polluting the
//  live telemetry stream the harness is measured from.)

const msg = (role: string, content: unknown, extra: Record<string, unknown> = {}) => ({ role, content, ...extra });

test("prefix stability: pure append is stable; edited history reports first divergence", () => {
	const p1 = { model: "m", messages: [msg("system", "S"), msg("user", "hi")], tools: [{ name: "bash" }] };
	const a1 = analyzePayload(p1, null);
	assert.equal(a1.row.prefix_stable, true);

	const p2 = { model: "m", messages: [...p1.messages, msg("assistant", "ok")], tools: p1.tools };
	const a2 = analyzePayload(p2, a1.serialized);
	assert.equal(a2.row.prefix_stable, true, "append-only keeps the prefix");
	assert.equal(a2.row.system_sha256, a1.row.system_sha256);
	assert.equal(a2.row.tools_sha256, a1.row.tools_sha256);

	const p3 = { model: "m", messages: [msg("system", "S CHANGED"), ...p2.messages.slice(1)], tools: p1.tools };
	const a3 = analyzePayload(p3, a2.serialized);
	assert.equal(a3.row.prefix_stable, false);
	assert.equal(a3.row.first_divergence, 0, "system change breaks at index 0");

	const p4 = { model: "m", messages: p2.messages.slice(0, 2), tools: p1.tools };
	const a4 = analyzePayload(p4, a2.serialized);
	assert.equal(a4.row.prefix_stable, false, "truncated history is a break too");
	assert.equal(a4.row.first_divergence, 2);
});

test("thinking replay and lens position are detected", () => {
	const payload = {
		model: "m",
		messages: [
			msg("system", "S"),
			msg("user", "q"),
			msg("assistant", "<think>secret plan</think>answer", { reasoning_content: "secret plan" }),
			msg("user", [{ type: "text", text: "next" }, { type: "text", text: "\n\n[session-state — ground truth]" }]),
		],
	};
	const { row } = analyzePayload(payload, null);
	assert.equal(row.think_tag_count, 1);
	assert.equal(row.reasoning_field_count, 1);
	assert.equal(row.lens_present, true);
	assert.equal(row.lens_tail_only, true, "lens in the LAST message only");

	const early = { ...payload, messages: [msg("user", "[session-state early]"), ...payload.messages] };
	assert.equal(analyzePayload(early, null).row.lens_tail_only, false);
});

test("extension: flag off registers nothing; flag on records rows to the trace file", async () => {
	const fp = makeFakePi();
	const prev = process.env.PAYLOAD_AUDIT;
	const work = mkdtempSync(join(tmpdir(), "payload-audit-"));
	try {
		delete process.env.PAYLOAD_AUDIT;
		const off = await import(`../extensions/payload-audit.ts?off=${Date.now()}-${Math.random()}`);
		off.default(fp.pi as never);
		assert.equal(fp.handlers.size, 0, "dark by default");

		process.env.PAYLOAD_AUDIT = "on";
		const on = await import(`../extensions/payload-audit.ts?on=${Date.now()}-${Math.random()}`);
		on.default(fp.pi as never);
		await fire(fp, "session_start", {}, { cwd: work });
		await fire(fp, "before_provider_request", { payload: { model: "m", messages: [msg("user", "a")] } });
		await fire(fp, "before_provider_request", { payload: { model: "m", messages: [msg("user", "a"), msg("assistant", "b")] } });
		const rows = readFileSync(join(work, ".pi", "traces", "payload-audit.jsonl"), "utf8")
			.trim().split("\n").map((l) => JSON.parse(l));
		assert.equal(rows.length, 2);
		assert.equal(rows[0].seq, 1);
		assert.equal(rows[1].prefix_stable, true);
	} finally {
		if (prev === undefined) delete process.env.PAYLOAD_AUDIT; else process.env.PAYLOAD_AUDIT = prev;
		rmSync(work, { recursive: true, force: true });
	}
});
