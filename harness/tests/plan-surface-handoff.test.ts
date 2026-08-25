// plan-surface-handoff — the plan-runner (6) → tool-activation (22) → run-capsule (26)
// ordering, exercised in the SHIPPED storage mode.
//
// Why a separate file: plan-runner.integration.test.ts sets `PLAN_STORAGE=project`
// at module scope, so the entire planner suite runs in the ROLLBACK configuration.
// That is the one mode in which plan state is readable at session_start, which is
// why none of its 15 tests could see the two defects pinned here. Under the shipped
// default (PLAN_STORAGE=capsule, RUN_CAPSULE=recovery) the state lives inside a run
// capsule whose identity run-capsule publishes twenty manifest slots AFTER
// plan-runner reads it, so at session_start:
//
//   * `readState` returns undefined,
//   * `__pi_active_plan_context` is never set,
//   * tool-activation's `activePlan` is therefore false and the plan tools are
//     deferred even in the middle of a live plan, and
//   * the "interrupted plan" notice — the only affordance telling a user their plan
//     is resumable — is never reached.
//
// The corrected answer only exists once `capsule/identity` lands. These tests assert
// it actually arrives at both consumers.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HARNESS_SIGNAL_CHANNEL } from "../lib/harness-signals.ts";
import { runCapsuleDirectory } from "../lib/run-capsule-store.ts";
import { captureInitialToolSurface } from "../lib/session-bootstrap.ts";
import { fire, makeCtx, makeFakePi, resetPiGlobals } from "./integration-harness.ts";

const TOOLS = [
	"read", "bash", "edit", "write", "search_spans", "read_span", "recall",
	"verify_project", "capability", "web_search", "web_read", "subagent",
];

/** A plan left open by a DIFFERENT process — what an interrupted session leaves behind. */
function writeInterruptedPlan(agentDir: string, cwd: string, capsuleId: string): void {
	const directory = runCapsuleDirectory(agentDir, cwd, capsuleId);
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, "plan-state.json"), JSON.stringify({
		schema_version: 4,
		run_id: "plan-20260825T120000",
		request: "resume the interrupted work",
		summary: "Two items were left open when the previous process exited.",
		phase: "executing",
		created_at: "2026-08-25T12:00:00.000Z",
		updated_at: "2026-08-25T12:05:00.000Z",
		// Not this process's marker: that is precisely what "interrupted" means.
		writer: "00000000-0000-4000-8000-000000000000",
		items: [
			{ id: "item-1", title: "First open item", status: "in_progress" },
			{ id: "item-2", title: "Second open item", status: "pending" },
		],
	}, null, 2));
}

async function boot() {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-plan-handoff-agent-"));
	const cwd = mkdtempSync(join(tmpdir(), "pi-plan-handoff-cwd-"));
	const capsuleId = randomUUID();
	writeInterruptedPlan(agentDir, cwd, capsuleId);

	const prior = {
		agent: process.env.PI_CODING_AGENT_DIR, telemetry: process.env.TELEMETRY,
		storage: process.env.PLAN_STORAGE, profile: process.env.MUNCHKIN_TOOL_PROFILE,
	};
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.TELEMETRY = "off";
	delete process.env.PLAN_STORAGE;        // shipped default: capsule
	delete process.env.MUNCHKIN_TOOL_PROFILE; // shipped default: core

	const fp = makeFakePi();
	for (const name of TOOLS) fp.pi.registerTool({ name, parameters: { type: "object" } } as never);
	// Manifest order, and it matters: plan-runner strips the plan tools before
	// tool-activation derives the pool it can restore them from.
	const stamp = `${Date.now()}-${Math.random()}`;
	(await import(`../extensions/plan-runner.ts?handoff=${stamp}`)).default(fp.pi as never);
	(await import(`../extensions/tool-activation.ts?handoff=${stamp}`)).default(fp.pi as never);

	fp.pi.setActiveTools([...TOOLS, "plan_write", "plan_update"]);
	captureInitialToolSurface(fp.pi as never);
	const { ctx, notes } = makeCtx(cwd);
	await fire(fp, "session_start", { reason: "new" }, ctx);

	return {
		fp, cwd, notes, capsuleId, agentDir,
		/** What run-capsule does at manifest index 26, long after the two above ran. */
		async publishCapsuleIdentity() {
			(globalThis as Record<string, unknown>).__pi_run_capsule_identity = { cwd, capsuleId, runIdHash: null };
			fp.pi.events.emit(HARNESS_SIGNAL_CHANNEL, { v: 1, type: "capsule/identity" });
			// plan-runner parks the re-read on `pendingRebind` and drains it here.
			await fire(fp, "before_agent_start", {}, ctx);
		},
		restore() {
			for (const [key, value] of [
				["PI_CODING_AGENT_DIR", prior.agent], ["TELEMETRY", prior.telemetry],
				["PLAN_STORAGE", prior.storage], ["MUNCHKIN_TOOL_PROFILE", prior.profile],
			] as const) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
			resetPiGlobals();
		},
	};
}

test("capsule storage: the plan tools reach the surface once the capsule identity lands", async () => {
	const run = await boot();
	try {
		// Precondition — the defect's starting state, not an accident of the fixture:
		// plan state is genuinely unreadable this early, so the plan tools are deferred
		// despite two open items on disk.
		assert.equal(run.fp.pi.getActiveTools().includes("plan_write"), false, "precondition: deferred at session_start");
		assert.equal((globalThis as Record<string, unknown>).__pi_active_plan_context, undefined);

		await run.publishCapsuleIdentity();

		const active = run.fp.pi.getActiveTools();
		assert.ok(active.includes("plan_write"), "plan_write never returned after the identity arrived");
		assert.ok(active.includes("plan_update"), "plan_update never returned after the identity arrived");
		assert.ok((globalThis as Record<string, unknown>).__pi_active_plan_context, "active plan context still unpublished");
	} finally { run.restore(); }
});

test("capsule storage: an interrupted plan announces itself exactly once", async () => {
	const run = await boot();
	try {
		assert.equal(run.notes.length, 0, "precondition: nothing announced before the identity exists");

		await run.publishCapsuleIdentity();
		const announcements = run.notes.filter((note) => note.includes("Interrupted plan"));
		assert.equal(announcements.length, 1, "the interrupted-plan notice never reached the user");
		assert.match(announcements[0], /2 open item\(s\)/);
		assert.match(announcements[0], /\/plan-go/);

		// A second identity announcement (a reload mid-session) must not re-nag.
		await run.publishCapsuleIdentity();
		assert.equal(run.notes.filter((note) => note.includes("Interrupted plan")).length, 1, "notice repeated");
	} finally { run.restore(); }
});

test("capsule storage: a settled plan with no open items restores nothing and says nothing", async () => {
	const run = await boot();
	try {
		// Overwrite with a plan that has nothing left to do: the repair is for live
		// work, and a done plan must not drag the plan tools back onto the surface.
		const directory = runCapsuleDirectory(run.agentDir, run.cwd, run.capsuleId);
		writeFileSync(join(directory, "plan-state.json"), JSON.stringify({
			schema_version: 4, run_id: "plan-20260825T120000", request: "finished work",
			summary: "Everything is done.", phase: "executing",
			created_at: "2026-08-25T12:00:00.000Z", updated_at: "2026-08-25T12:05:00.000Z",
			writer: "00000000-0000-4000-8000-000000000000",
			items: [{ id: "item-1", title: "Only item", status: "done" }],
		}, null, 2));

		await run.publishCapsuleIdentity();
		assert.equal(run.fp.pi.getActiveTools().includes("plan_write"), false, "a settled plan re-armed the plan tools");
		assert.equal(run.notes.filter((note) => note.includes("Interrupted plan")).length, 0);
	} finally { run.restore(); }
});
