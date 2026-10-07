import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { clearGoal, createGoal, GOAL_LEDGER_MAX_BYTES, goalRevision, goalStoragePath, inspectGoal, loadGoalLedger, mutateGoal, readCurrentGoal, updateGoal, writeGoal } from "../lib/goal-state.ts";

const moduleUrl = new URL("../lib/goal-state.ts", import.meta.url).href;
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "goal-transaction-"));
	return { root, cwd: join(root, "worktree"), env: { ...process.env, PI_CODING_AGENT_DIR: root, GOAL_SCOPE: "worktree", TELEMETRY: "off" } };
}

function child(cwd: string, env: NodeJS.ProcessEnv, label: string, action = "update") {
	const code = `
		import { mutateGoal, updateGoal, pauseGoal, clearGoal } from ${JSON.stringify(moduleUrl)};
		process.send({ type: 'ready' });
		await new Promise(resolve => process.once('message', resolve));
		try {
			if (process.env.GOAL_TEST_ACTION === 'clear') await clearGoal(process.env.GOAL_TEST_CWD);
			else await mutateGoal(process.env.GOAL_TEST_CWD, async goal => {
				process.send({ type: 'read' });
				await new Promise(resolve => process.once('message', resolve));
				return { goal: process.env.GOAL_TEST_ACTION === 'pause' ? pauseGoal(goal) : updateGoal(goal, { progressEvidence: [process.env.GOAL_TEST_LABEL] }), result: null };
			});
			process.send({ type: 'done' });
		} catch (error) { process.send({ type: 'error', message: error.message }); }
		process.disconnect();
	`;
	const proc = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code], {
		env: { ...env, GOAL_TEST_CWD: cwd, GOAL_TEST_LABEL: label, GOAL_TEST_ACTION: action }, stdio: ["ignore", "ignore", "pipe", "ipc"],
	});
	const messages: Array<{ type: string; message?: string }> = [];
	proc.on("message", message => messages.push(message as typeof messages[number]));
	const exited = once(proc, "exit");
	return { proc, messages, exited };
}

async function waitFor(c: ReturnType<typeof child>, type: string) {
	const deadline = Date.now() + 8_000;
	while (!c.messages.some(message => message.type === type)) {
		assert.equal(c.proc.exitCode, null, `child exited before ${type}: ${JSON.stringify(c.messages)}`);
		assert.ok(Date.now() < deadline, `child timed out before ${type}: ${JSON.stringify(c.messages)}`);
		await new Promise(resolve => setTimeout(resolve, 10));
	}
}

async function stop(proc: ChildProcess) {
	if (proc.exitCode !== null || proc.signalCode !== null) return;
	const exit = once(proc, "exit"); proc.kill("SIGKILL"); await exit;
}

test("cross-process goal updates read after the preceding writer commits", async () => {
	const { root, cwd, env } = fixture();
	const children: ReturnType<typeof child>[] = [];
	try {
		await mutateGoal(cwd, () => ({ goal: createGoal({ cwd, objective: "Preserve both observations" }), result: null }), env);
		const a = child(cwd, env, "A"), b = child(cwd, env, "B"); children.push(a, b);
		await Promise.all([waitFor(a, "ready"), waitFor(b, "ready")]);
		a.proc.send("start"); await waitFor(a, "read");
		b.proc.send("start");
		// A is deliberately held in its transaction while B is fully started.
		await new Promise(resolve => setTimeout(resolve, 200));
		const earlyRead = b.messages.some(message => message.type === "read");
		a.proc.send("commit"); await waitFor(a, "done");
		await waitFor(b, "read"); b.proc.send("commit"); await waitFor(b, "done");
		assert.deepEqual((await readCurrentGoal(cwd, env))?.evidence, ["A", "B"]);
		assert.equal(earlyRead, false, "second writer must not enter the reducer under another process's lock");
	} finally { await Promise.all(children.map(c => stop(c.proc))); rmSync(root, { recursive: true, force: true }); }
});

test("clear cannot be undone by an already-running goal update", async () => {
	const { root, cwd, env } = fixture();
	const children: ReturnType<typeof child>[] = [];
	try {
		await mutateGoal(cwd, () => ({ goal: createGoal({ cwd, objective: "Respect cancellation" }), result: null }), env);
		const a = child(cwd, env, "A"), b = child(cwd, env, "B", "clear"); children.push(a, b);
		await Promise.all([waitFor(a, "ready"), waitFor(b, "ready")]);
		a.proc.send("start"); await waitFor(a, "read"); b.proc.send("start");
		await new Promise(resolve => setTimeout(resolve, 200));
		a.proc.send("commit"); await waitFor(a, "done"); await waitFor(b, "done");
		assert.equal(await readCurrentGoal(cwd, env), undefined);
		const ledger = JSON.parse(readFileSync(goalStoragePath(cwd, env), "utf8"));
		assert.equal(ledger.goals[0].status, "cancelled");
		assert.deepEqual(ledger.goals[0].evidence, ["A"]);
	} finally { await Promise.all(children.map(c => stop(c.proc))); rmSync(root, { recursive: true, force: true }); }
});

test("cross-process pause rejects a waiting update before it can commit", async () => {
	const { root, cwd, env } = fixture();
	const children: ReturnType<typeof child>[] = [];
	try {
		await writeGoal(createGoal({ cwd, objective: "Pause is authoritative" }), cwd, env);
		const a = child(cwd, env, "pause", "pause"), b = child(cwd, env, "late"); children.push(a, b);
		await Promise.all([waitFor(a, "ready"), waitFor(b, "ready")]);
		a.proc.send("start"); await waitFor(a, "read"); b.proc.send("start");
		a.proc.send("commit"); await waitFor(a, "done");
		await waitFor(b, "read"); b.proc.send("commit"); await waitFor(b, "error");
		assert.match(b.messages.find(message => message.type === "error")!.message!, /only an active goal/);
		const goal = await readCurrentGoal(cwd, env);
		assert.equal(goal?.status, "paused"); assert.deepEqual(goal?.evidence, []);
	} finally { await Promise.all(children.map(c => stop(c.proc))); rmSync(root, { recursive: true, force: true }); }
});

test("a killed writer preserves its lock and ledger until stopped-session recovery", async () => {
	const { root, cwd, env } = fixture();
	let writer: ReturnType<typeof child> | undefined;
	try {
		await writeGoal(createGoal({ cwd, objective: "Recover interruption" }), cwd, env);
		const path = goalStoragePath(cwd, env), before = readFileSync(path, "utf8");
		writer = child(cwd, env, "uncommitted"); await waitFor(writer, "ready");
		writer.proc.send("start"); await waitFor(writer, "read"); await stop(writer.proc);
		const owner = JSON.parse(readFileSync(join(`${path}.lock`, "owner.json"), "utf8"));
		assert.equal(owner.pid, writer.proc.pid);
		assert.equal(readFileSync(path, "utf8"), before);
		// This fixture owns every process using the scope, and the writer is dead.
		rmSync(`${path}.lock`, { recursive: true });
		await mutateGoal(cwd, goal => ({ goal: updateGoal(goal!, { progressEvidence: ["recovered"] }), result: null }), env);
		assert.deepEqual((await readCurrentGoal(cwd, env))?.evidence, ["recovered"]);
	} finally { if (writer) await stop(writer.proc); rmSync(root, { recursive: true, force: true }); }
});

test("invalid authority cannot be replaced through mutate, direct write, or clear", async () => {
	const { root, cwd, env } = fixture();
	try {
		const goal = createGoal({ cwd, objective: "Keep damaged authority intact" });
		const path = goalStoragePath(cwd, env); mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path.replace("goal-v2.json", "goal-v1.json"), JSON.stringify({ ...goal, schema_version: 1 }));
		for (const invalid of ["{broken", "null", " ".repeat(GOAL_LEDGER_MAX_BYTES + 1), JSON.stringify({ schema_version: 99 }), JSON.stringify({ schema_version: 2, scope: "worktree", cwd_hash: "f".repeat(64), current_goal_id: null, goals: [] })]) {
			writeFileSync(path, invalid);
			let called = false;
			await assert.rejects(mutateGoal(cwd, () => { called = true; return { goal, result: null }; }, env), /goal ledger.*(invalid|unsupported|identity)/i);
			assert.equal(called, false, "a reducer must never see corrupt authority as absence");
			await assert.rejects(writeGoal(goal, cwd, env), /goal ledger/i);
			await assert.rejects(clearGoal(cwd, env), /goal ledger/i);
			assert.equal(readFileSync(path, "utf8"), invalid);
			assert.equal(await readCurrentGoal(cwd, env), undefined, "recovery remains fail-closed");
		}
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("direct writes cannot replace an existing goal from an unchecked stale snapshot", async () => {
	const { root, cwd, env } = fixture();
	try {
		const goal = createGoal({ cwd, objective: "Direct writer fence" });
		await writeGoal(goal, cwd, env);
		await mutateGoal(cwd, current => ({ goal: updateGoal(current!, { progressEvidence: ["new"] }), result: null }), env);
		await assert.rejects(writeGoal(updateGoal(goal, { progressEvidence: ["stale"] }), cwd, env), /revision|mutateGoal/);
		assert.deepEqual((await readCurrentGoal(cwd, env))?.evidence, ["new"]);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("inspection cursors bind the section, complete revision, and valid character boundary", () => {
	const goal = createGoal({ cwd: "/tmp/goal-cursor", objective: "Inspect", criteria: [{ text: "😀".repeat(100) }] });
	const page = inspectGoal(goal, "criteria", undefined, 100);
	assert.ok(page.next_cursor);
	assert.throws(() => inspectGoal(goal, "all", page.next_cursor!), /cursor/);
	assert.throws(() => inspectGoal(updateGoal(goal, { progressEvidence: ["new"] }), "criteria", page.next_cursor!), /cursor/);
	assert.throws(() => inspectGoal(goal, "criteria", "0".repeat(16) + ":100"), /cursor/);
	let text = page.text;
	let cursor: string | null = page.next_cursor;
	while (cursor) { const next = inspectGoal(goal, "criteria", cursor, 100); text += next.text; cursor = next.next_cursor; }
	assert.equal(text, JSON.stringify(goal.criteria, null, 2) + "\n");
});

test("direct writes require the exact revision and accept a current revision", async () => {
	const { root, cwd, env } = fixture();
	try {
		const goal = createGoal({ cwd, objective: "Compare and swap" });
		await writeGoal(goal, cwd, env);
		const updated = updateGoal(goal, { progressEvidence: ["current"] });
		await writeGoal(updated, cwd, env, goalRevision(goal));
		await assert.rejects(writeGoal(updated, cwd, env, goalRevision(goal)), /revision/);
		await assert.rejects(writeGoal(createGoal({ cwd, objective: "Missing revision" }), cwd, env, goalRevision(goal)), /revision/);
		assert.deepEqual((await readCurrentGoal(cwd, env))?.evidence, ["current"]);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("a dangling authority link is inaccessible and preserved", async () => {
	const { root, cwd, env } = fixture();
	try {
		const path = goalStoragePath(cwd, env);
		mkdirSync(dirname(path), { recursive: true });
		symlinkSync(join(root, "missing-ledger"), path);
		assert.equal((await loadGoalLedger(cwd, env)).kind, "inaccessible");
		await assert.rejects(writeGoal(createGoal({ cwd, objective: "Preserve link" }), cwd, env), /inaccessible/);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
