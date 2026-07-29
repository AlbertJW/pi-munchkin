import assert from "node:assert/strict";
import test from "node:test";
import { extractSpecPaths, steerMessage } from "../extensions/spec-adherence.ts";

// Run: cd ~/.pi/agent && npx -y tsx --test tests/spec-adherence.test.ts

test("extracts only prompt-named paths that exist under cwd", () => {
	const onDisk = new Set(["/w/docs/naming.md", "/w/data/charmap.json"]);
	const exists = (p: string) => onDisk.has(p);
	const prompt = "See docs/naming.md (authoritative) and data/charmap.json; ignore ghost.md and /etc/passwd.txt and ../up.md";
	assert.deepEqual(extractSpecPaths(prompt, "/w", exists), ["docs/naming.md", "data/charmap.json"]);
	assert.deepEqual(extractSpecPaths("no paths here", "/w", exists), []);
	assert.deepEqual(extractSpecPaths("./docs/naming.md twice, docs/naming.md again", "/w", exists), ["docs/naming.md"]);
});

test("steer message names the path and the corrective action", () => {
	const msg = steerMessage("docs/naming.md");
	assert.match(msg, /docs\/naming\.md/);
	assert.match(msg, /Read it before the next attempt/);
});

test("extension lifecycle: arm → fail twice → steer once per unread spec, dark off", async () => {
	const handlers = new Map<string, (event: unknown, ctx?: unknown) => Promise<unknown>>();
	const sent: string[] = [];
	const fakePi = {
		on: (name: string, fn: never) => handlers.set(name, fn),
		sendUserMessage: (text: string) => sent.push(text),
	};
	const prev = process.env.SPEC_ADHERENCE;
	try {
		delete process.env.SPEC_ADHERENCE;
		const off = await import(`../extensions/spec-adherence.ts?off=${Date.now()}-${Math.random()}`);
		off.default(fakePi as never);
		assert.equal(handlers.size, 0, "dark by default");

		process.env.SPEC_ADHERENCE = "on";
		const mod = await import(`../extensions/spec-adherence.ts?on=${Date.now()}-${Math.random()}`);
		mod.default(fakePi as never);
		// cwd = repo root so a real file (README.md) exists for extraction.
		await handlers.get("session_start")!({}, { cwd: `${process.cwd()}` });
		await handlers.get("before_agent_start")!({ prompt: "Fix slugs per README.md, the authoritative spec." });

		const failEdit = { toolName: "edit", args: { path: "src/x.ts" }, isError: true };
		await handlers.get("turn_end")!({ turnIndex: 1 });
		assert.equal(sent.length, 0, "no steer before failures accumulate");

		await handlers.get("tool_execution_end")!(failEdit);
		await handlers.get("turn_end")!({ turnIndex: 2 });
		assert.equal(sent.length, 0, "one failure is not enough");

		await handlers.get("tool_execution_end")!(failEdit);
		await handlers.get("turn_end")!({ turnIndex: 3 });
		assert.equal(sent.length, 1, "two failing mutations + unread spec → steer");
		assert.match(sent[0], /README\.md/);

		await handlers.get("turn_end")!({ turnIndex: 4 });
		assert.equal(sent.length, 1, "once per path — no repeat");
	} finally {
		if (prev === undefined) delete process.env.SPEC_ADHERENCE; else process.env.SPEC_ADHERENCE = prev;
	}
});

test("reading the spec (read tool or bash cat) suppresses the steer", async () => {
	const handlers = new Map<string, (event: unknown, ctx?: unknown) => Promise<unknown>>();
	const sent: string[] = [];
	const fakePi = {
		on: (name: string, fn: never) => handlers.set(name, fn),
		sendUserMessage: (text: string) => sent.push(text),
	};
	const prev = process.env.SPEC_ADHERENCE;
	process.env.SPEC_ADHERENCE = "on";
	try {
		const mod = await import(`../extensions/spec-adherence.ts?read=${Date.now()}-${Math.random()}`);
		mod.default(fakePi as never);
		await handlers.get("session_start")!({}, { cwd: `${process.cwd()}` });
		await handlers.get("before_agent_start")!({ prompt: "Follow README.md exactly." });
		await handlers.get("tool_execution_end")!({ toolName: "bash", args: { command: "cat README.md | head -50" }, isError: false });
		await handlers.get("tool_execution_end")!({ toolName: "edit", args: {}, isError: true });
		await handlers.get("tool_execution_end")!({ toolName: "edit", args: {}, isError: true });
		await handlers.get("turn_end")!({ turnIndex: 3 });
		assert.equal(sent.length, 0, "spec was read via bash cat — no steer");
	} finally {
		if (prev === undefined) delete process.env.SPEC_ADHERENCE; else process.env.SPEC_ADHERENCE = prev;
	}
});
