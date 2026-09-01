import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
	acceptGoal, blockGoal, cancelGoal, createGoal, goalAmbientSummary, goalScopeIdentity, goalStoragePath, inspectGoal,
	mutateGoal, pauseGoal, readCurrentGoal, readExecutableGoal, readGoal, readGoals, settleGoal, updateGoal, validateGoal,
	renderGoalRecoveryBrief,
} from "../lib/goal-state.ts";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "pi-goal-"));
	const env = { ...process.env, PI_CODING_AGENT_DIR: root };
	const cwd = join(root, "worktree");
	return { root, env, cwd };
}

test("goal state is private, persistent, and supports an advisory proposal before activation", async () => {
	const { root, env, cwd } = fixture();
	try {
		const proposal = createGoal({ cwd, objective: "Ship the bounded change", status: "proposed", proposal: { source: "skill", note: "This is a recommendation." }, criteria: [{ id: "tests", text: "Tests pass", required: true }, { id: "docs", text: "Docs are updated", required: false }] });
		await mutateGoal(cwd, async (previous) => { assert.equal(previous, undefined); return { goal: proposal, result: proposal }; }, env);
		assert.equal((await readCurrentGoal(cwd, env))?.status, "proposed");
		const accepted = acceptGoal((await readCurrentGoal(cwd, env))!);
		await mutateGoal(cwd, async () => ({ goal: accepted, result: accepted }), env);
		assert.equal((await readGoal(cwd, env))?.status, "active");
		assert.match(readFileSync(goalStoragePath(cwd, env), "utf8"), /goal_id/);
		assert.equal((await readGoals(cwd, env)).length, 1);
		assert.equal((await readCurrentGoal(cwd, env))!.proposal?.source, "skill");
		assert.equal(goalAmbientSummary(accepted)?.status, "active");
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("goal criteria IDs are unique and ambient objective text is byte-bounded", () => {
	const { root, cwd } = fixture();
	try {
		assert.throws(() => createGoal({ cwd, objective: "duplicate", criteria: [{ id: "same", text: "one" }, { id: "same", text: "two" }] }), /duplicate criterion id/);
		const goal = createGoal({ cwd, objective: "😀".repeat(400) });
		const summary = goalAmbientSummary(goal)!;
		assert.ok(Buffer.byteLength(String(summary.objective), "utf8") <= 240);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("malformed criteria are rejected without throwing from the validator", () => {
	const { root, cwd } = fixture();
	try {
		const goal = createGoal({ cwd, objective: "validator safety" });
		const errors = validateGoal({ ...goal, criteria: [null] } as any);
		assert.ok(errors.includes("invalid criteria"));
		assert.equal(errors.some((error) => error === "goal must be an object"), false);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("project-scoped goals use and enforce the project identity", async () => {
	const { root, cwd } = fixture();
	const env = { ...process.env, PI_CODING_AGENT_DIR: root, GOAL_SCOPE: "project" };
	try {
		const goal = createGoal({ cwd, objective: "Share across worktrees", scope: "project" });
		await mutateGoal(cwd, async () => ({ goal, result: goal }), env);
		assert.equal((await readGoal(cwd, env))?.scope, "project");
		const mismatched = createGoal({ cwd, objective: "Wrong scope", scope: "worktree" });
		await assert.rejects(() => mutateGoal(cwd, async () => ({ goal: mismatched, result: mismatched }), env), /scope does not match/);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("project-scoped goals are shared by linked worktrees through the common Git root", async () => {
	const { root, env } = fixture();
	const project = join(root, "repo");
	const gitCommon = join(project, ".git");
	const worktreeA = join(root, "worktree-a");
	const worktreeB = join(root, "worktree-b");
	const projectEnv = { ...env, GOAL_SCOPE: "project" };
	try {
		mkdirSync(join(gitCommon, "worktrees"), { recursive: true });
		mkdirSync(worktreeA, { recursive: true });
		mkdirSync(worktreeB, { recursive: true });
		writeFileSync(join(worktreeA, ".git"), `gitdir: ${join(gitCommon, "worktrees", "a")}\n`);
		writeFileSync(join(worktreeB, ".git"), `gitdir: ${join(gitCommon, "worktrees", "b")}\n`);
		assert.equal(goalScopeIdentity(worktreeA, "project"), project);
		assert.equal(goalScopeIdentity(worktreeB, "project"), project);
		const goal = createGoal({ cwd: worktreeA, objective: "Shared project outcome", scope: "project" });
		await mutateGoal(worktreeA, async () => ({ goal, result: goal }), projectEnv);
		assert.equal((await readGoal(worktreeB, projectEnv))?.goal_id, goal.goal_id);
		assert.equal(goalStoragePath(worktreeA, projectEnv), goalStoragePath(worktreeB, projectEnv));
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("goal updates require known criteria and 80/20 settlement carries evidence and deferrals", () => {
		const { root, env, cwd } = fixture();
		try {
			const active = createGoal({ cwd, objective: "Document the system", criteria: [{ id: "core", text: "Core docs are correct", required: true }, { id: "examples", text: "Examples are polished", required: false }] });
			const progressed = updateGoal(active, { criteria: [{ id: "core", status: "met", evidence: ["npm test: 625 passed"] }, { id: "examples", status: "deferred" }], progressEvidence: ["reviewed current source"], residualRisks: ["examples may need a later polish pass"] });
			const paused = pauseGoal(active);
			assert.throws(() => updateGoal(paused, { progressEvidence: ["must not mutate while paused"] }), /resume an inactive goal/);
			assert.throws(() => settleGoal(paused, { outcome: "complete", deliveredValue: "not allowed", confidence: 1, residualRisks: [], evidence: ["none"] }), /resume it first/);
			assert.equal(progressed.criteria[0].status, "met");
			assert.throws(() => updateGoal(active, { criteria: [{ id: "missing", status: "met" }] }), /unknown criterion/);
			assert.throws(() => settleGoal(progressed, { outcome: "complete", deliveredValue: "Core docs corrected", confidence: 0.8, residualRisks: [], evidence: ["gate passed"] }), /every criterion/);
			const settled = settleGoal(progressed, { outcome: "accepted_80_20", deliveredValue: "Core docs corrected", confidence: 0.8, residualRisks: ["examples deferred"], deferred: [{ value: "polish examples", risk: "minor clarity debt", rationale: "Not required for the current acceptance bar." }], evidence: ["gate passed"] });
			assert.equal(settled.status, "accepted_80_20");
			assert.equal(settled.deferred.length, 1);
			assert.deepEqual(validateGoal(settled), []);
		} finally { rmSync(root, { recursive: true, force: true }); }
});

test("80/20 settlement refuses unmet optional criteria that were not explicitly deferred", () => {
	// The deferral guard must be a correspondence, not a count: one deferred entry
	// must not unlock an arbitrary number of optional criteria that are still open.
	const { root, cwd } = fixture();
	try {
		const active = createGoal({ cwd, objective: "Correspondence, not count", criteria: [
			{ id: "core", text: "Core work lands", required: true },
			{ id: "examples", text: "Examples are polished", required: false },
			{ id: "docs", text: "Docs are refreshed", required: false },
		] });
		const progressed = updateGoal(active, { criteria: [{ id: "core", status: "met", evidence: ["verified"] }, { id: "examples", status: "deferred" }] });
		const settlement = {
			outcome: "accepted_80_20" as const, deliveredValue: "Core work landed", confidence: 0.8,
			residualRisks: ["deferred polish"], deferred: [{ value: "polish examples", risk: "clarity debt", rationale: "Not needed for acceptance." }],
			evidence: ["gate passed"],
		};
		assert.throws(() => settleGoal(progressed, settlement), /explicitly deferred: docs/);
		const marked = updateGoal(progressed, { criteria: [{ id: "docs", status: "deferred" }] });
		const settled = settleGoal(marked, settlement);
		assert.equal(settled.status, "accepted_80_20");
		assert.throws(
			() => settleGoal(updateGoal(active, { criteria: [{ id: "core", status: "met", evidence: ["verified"] }, { id: "examples", status: "deferred" }, { id: "docs", status: "deferred" }] }), { ...settlement, deferred: [] }),
			/deferred rationale/,
			"deferred criteria still demand at least one recorded deferral",
		);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("completed goals remain in the private ledger while a later goal can become the sole active head", async () => {
	const { root, env, cwd } = fixture();
	try {
		const first = createGoal({ cwd, objective: "First objective" });
		const done = settleGoal(updateGoal(first, { criteria: [{ id: "criterion-1", status: "met", evidence: ["verified"] }] }), { outcome: "complete", deliveredValue: "Done", confidence: 1, residualRisks: [], evidence: ["verified"] });
		await mutateGoal(cwd, async () => ({ goal: done, result: done }), env);
		assert.equal(await readGoal(cwd, env), undefined);
		const second = createGoal({ cwd, objective: "Second objective" });
		await mutateGoal(cwd, async () => ({ goal: second, result: second }), env);
		assert.equal((await readGoal(cwd, env))?.goal_id, second.goal_id);
		assert.equal((await readGoals(cwd, env)).length, 2);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("cancelling the active goal clears the ledger pointer instead of leaving a terminal active id", async () => {
	const { root, env, cwd } = fixture();
	try {
		const active = createGoal({ cwd, objective: "Cancel safely" });
		await mutateGoal(cwd, async () => ({ goal: active, result: active }), env);
		const cancelled = cancelGoal(active);
		await mutateGoal(cwd, async () => ({ goal: cancelled, result: cancelled }), env);
		assert.equal(await readGoal(cwd, env), undefined);
		const ledger = JSON.parse(readFileSync(goalStoragePath(cwd, env), "utf8")) as { current_goal_id: string | null; goals: Array<{ status: string }> };
		assert.equal(ledger.current_goal_id, null);
		assert.equal(ledger.goals[0]?.status, "cancelled");
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("malformed ledgers fail closed without throwing from recovery reads", async () => {
	const { root, env, cwd } = fixture();
	try {
		const path = goalStoragePath(cwd, env);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify({ schema_version: 1, scope: "worktree", cwd_hash: "0".repeat(64), active_goal_id: "goal-bad", goals: null }));
		assert.equal(await readGoal(cwd, env), undefined);
		assert.deepEqual(await readGoals(cwd, env), []);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("a malformed ledger with a non-terminal goal but no active pointer is ignored", async () => {
	const { root, env, cwd } = fixture();
	try {
		const goal = createGoal({ cwd, objective: "must have an active pointer" });
		const path = goalStoragePath(cwd, env);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify({ schema_version: 1, scope: "worktree", cwd_hash: goal.cwd_hash, active_goal_id: null, goals: [goal] }));
		assert.equal(await readGoal(cwd, env), undefined);
		assert.deepEqual(await readGoals(cwd, env), []);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("goal recovery brief honors a hard UTF-8 byte cap", () => {
	const { root, env, cwd } = fixture();
	try {
		const goal = createGoal({ cwd, objective: "😀".repeat(400) });
		for (const maxBytes of [1, 8, 32, 1_024]) {
			const brief = renderGoalRecoveryBrief(goal, maxBytes);
			assert.ok(Buffer.byteLength(brief, "utf8") <= maxBytes, `brief exceeded ${maxBytes} bytes`);
		}
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("current goal identity is separate from execution authority", async () => {
	const { root, env, cwd } = fixture();
	try {
		const active = createGoal({ cwd, objective: "Respect pause authority" });
		await mutateGoal(cwd, async () => ({ goal: active, result: active }), env);
		assert.equal((await readExecutableGoal(cwd, env))?.goal_id, active.goal_id);
		const paused = pauseGoal(active);
		await mutateGoal(cwd, async () => ({ goal: paused, result: paused }), env);
		assert.equal((await readCurrentGoal(cwd, env))?.status, "paused");
		assert.equal(await readExecutableGoal(cwd, env), undefined);
		assert.equal(await readGoal(cwd, env), undefined, "legacy active read must not restart a paused goal");
		assert.equal(renderGoalRecoveryBrief(paused), "", "inactive goals must not inject recovery steering");
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("v1 ledgers migrate as current state without granting execution authority", async () => {
	const { root, env, cwd } = fixture();
	try {
		const paused = pauseGoal(createGoal({ cwd, objective: "Migrate without restart" }));
		const legacyGoal = { ...paused, schema_version: 1 };
		const legacyPath = goalStoragePath(cwd, env).replace(/goal-v2\.json$/, "goal-v1.json");
		mkdirSync(dirname(legacyPath), { recursive: true });
		writeFileSync(legacyPath, JSON.stringify({
			schema_version: 1, scope: paused.scope, cwd_hash: paused.cwd_hash,
			active_goal_id: paused.goal_id, goals: [legacyGoal],
		}));
		assert.equal((await readCurrentGoal(cwd, env))?.status, "paused");
		assert.equal(await readExecutableGoal(cwd, env), undefined);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("blocked is an evidence-bearing model transition but remains user-resumable only", () => {
	const { root, cwd } = fixture();
	try {
		const active = createGoal({ cwd, objective: "Stop honestly when external evidence is missing" });
		const blocked = blockGoal(active, {
			reason: "The required service is unavailable.", evidence: ["health check refused"],
			unblockCondition: "User restores the service and invokes /goal-resume.",
		});
		assert.equal(blocked.status, "blocked");
		assert.match(blocked.residual_risks.join("\n"), /required service/);
		assert.match(blocked.evidence.join("\n"), /health check refused/);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("bounded execution context preserves criterion semantics and paged inspection preserves full contract", () => {
	const { root, cwd } = fixture();
	try {
		const sentinel = "FULL-CONSTRAINT-SENTINEL";
		const goal = createGoal({
			cwd, objective: "Recover the real contract", constraints: [sentinel.repeat(20)],
			criteria: [{ id: "semantic", text: "FULL-CRITERION-SENTINEL must remain discoverable", required: true }],
		});
		const brief = renderGoalRecoveryBrief(goal, 2_304);
		assert.match(brief, /pi\.goal-context\/v2/);
		assert.match(brief, /semantic/);
		assert.match(brief, /FULL-CRITERION-SENTINEL/);
		const first = inspectGoal(goal, "all", undefined, 256);
		assert.ok(first.text.length <= 256);
		let text = first.text;
		let cursor = first.next_cursor;
		while (cursor) {
			const page = inspectGoal(goal, "all", cursor, 256);
			text += page.text;
			cursor = page.next_cursor;
		}
		assert.match(text, /FULL-CONSTRAINT-SENTINEL/);
		assert.match(text, /FULL-CRITERION-SENTINEL/);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
