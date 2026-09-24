// Integration tests for the hashline edit tool's MULTI-FILE apply, focused on
// transactionality: a patch spanning several files must be all-or-nothing. The
// atomicity test FAILS on the pre-2026-07-14 sequential-write loop (file 1 is
// written before file 2's bad tag throws) and PASSES once apply is two-phase.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileTag } from "../lib/hashline-core.ts";
import { registerHashline, withMutationQueues, type HashlineIo } from "../extensions/hashline.ts";
import { callTool, expectToolError, makeFakePi } from "./integration-harness.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "pi-hl-"));
const tagOf = (path: string) => fileTag(readFileSync(path));

function fresh(io?: HashlineIo) {
	const fp = makeFakePi();
	registerHashline(fp.pi as any, io);
	return fp;
}

test("hashline read: the 50 KiB result cap is BYTES, not UTF-16 code units", async () => {
	// The cap protects the context window, so it has to be measured in the units the
	// context is billed in. Enforced with `.length` it counted code units, so a CJK
	// file returned ~3x the budget — and the in-line hard cut could split a surrogate
	// pair, putting a lone surrogate into the tool result and from there into telemetry.
	const fp = fresh();
	const cwd = tmp();
	// 30k CJK chars/line: under the cap by code units, far over it by bytes.
	writeFileSync(join(cwd, "cjk.txt"), `${"界".repeat(30_000)}\n`.repeat(4), "utf8");
	const result = await callTool(fp, "read", { path: "cjk.txt", limit: 4 }, cwd);
	const text = result.content.map((block: { text?: string }) => block.text ?? "").join("");
	assert.ok(Buffer.byteLength(text, "utf8") <= 60 * 1024, `read returned ${Buffer.byteLength(text, "utf8")} bytes against a 50 KiB cap`);

	// And an emoji line must never be cut mid-pair.
	writeFileSync(join(cwd, "emoji.txt"), `${"😀".repeat(40_000)}\n`, "utf8");
	const emoji = await callTool(fp, "read", { path: "emoji.txt", limit: 1 }, cwd);
	const emojiText = emoji.content.map((block: { text?: string }) => block.text ?? "").join("");
	assert.ok(Buffer.byteLength(emojiText, "utf8") <= 60 * 1024);
	for (let i = 0; i < emojiText.length; i += 1) {
		const code = emojiText.charCodeAt(i);
		if (code >= 0xD800 && code <= 0xDBFF) {
			const next = emojiText.charCodeAt(i + 1);
			assert.ok(next >= 0xDC00 && next <= 0xDFFF, `lone high surrogate at ${i}`);
			i += 1;
		} else {
			assert.ok(!(code >= 0xDC00 && code <= 0xDFFF), `lone low surrogate at ${i}`);
		}
	}
});

test("hashline: oversized image and text are refused by stat preflight", async () => {
	const fp = fresh();
	const cwd = tmp();
	writeFileSync(join(cwd, "huge.png"), "");
	truncateSync(join(cwd, "huge.png"), 4 * 1024 * 1024 + 1);
	await expectToolError(fp, "read", { path: "huge.png" }, cwd, /Image too large/);
	writeFileSync(join(cwd, "huge.txt"), "");
	truncateSync(join(cwd, "huge.txt"), 16 * 1024 * 1024 + 1);
	await expectToolError(fp, "read", { path: "huge.txt", limit: 1 }, cwd, /limit parameter only bounds returned context/);
	await expectToolError(fp, "edit", { input: `[huge.txt#${fileTag(readFileSync(join(cwd, "huge.txt")))}]\nreplace 1..1:\n+x\n` }, cwd, /purpose-built bounded span tool/);
});

test("hashline: single-file edit applies with the live tag", async () => {
	const fp = fresh();
	const cwd = tmp();
	writeFileSync(join(cwd, "a.txt"), "hello\n");
	const patch = `[a.txt#${tagOf(join(cwd, "a.txt"))}]\nreplace 1..1:\n+HELLO\n`;
	await callTool(fp, "edit", { input: patch }, cwd);
	assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "HELLO\n");
});

test("hashline: read advertises the exact raw-byte SHA-256 and preserves the declared tool schemas", async () => {
	if (process.env.HASHLINE === "off") return;
	const fp = fresh();
	assert.deepEqual([...fp.tools.keys()].sort(), ["edit", "read"]);
	const read = fp.tools.get("read")! as any;
	const edit = fp.tools.get("edit")! as any;
	assert.deepEqual(Object.keys(read.parameters.properties).sort(), ["limit", "offset", "path"]);
	assert.deepEqual(read.parameters.required, ["path"]);
	assert.equal(read.parameters.properties.path.type, "string");
	assert.equal(read.parameters.properties.offset.type, "number");
	assert.equal(read.parameters.properties.offset.minimum, 1);
	assert.equal(read.parameters.properties.limit.type, "number");
	assert.equal(read.parameters.properties.limit.minimum, 1);
	assert.deepEqual(Object.keys(edit.parameters.properties), ["input"]);
	assert.deepEqual(edit.parameters.required, ["input"]);
	assert.equal(edit.parameters.properties.input.type, "string");
	const cwd = tmp();
	const bytes = Buffer.from("\uFEFFone\r\ntwo ", "utf8");
	writeFileSync(join(cwd, "tag.txt"), bytes);
	const result = await callTool(fp, "read", { path: "tag.txt" }, cwd);
	const output = result.content.map((block: { text?: string }) => block.text ?? "").join("");
	assert.ok(output.startsWith(`[tag.txt#${fileTag(bytes)}]\n`));
	assert.match(read.description, /exact-byte SHA-256/);
});

test("hashline: invalid UTF-8 is rejected by read and edit without altering original bytes", async () => {
	const fp = fresh();
	const cwd = tmp();
	const path = join(cwd, "invalid.txt");
	const original = Buffer.from([0xff, 0x61, 0x80]);
	writeFileSync(path, original);
	await expectToolError(fp, "read", { path }, cwd, /not valid UTF-8/);
	const patch = `[invalid.txt#${fileTag(original)}]\nreplace 1:\n+valid`;
	await expectToolError(fp, "edit", { input: patch }, cwd, /not valid UTF-8/);
	assert.deepEqual(readFileSync(path), original);
});

test("hashline: invalid proposed NUL and surrogate content fails before any target write", async () => {
	const cwd = tmp();
	const path = join(cwd, "f.txt");
	let writes = 0;
	const fp = fresh({
		writeTarget: async (target, text) => { writes += 1; await writeFile(target, text, "utf8"); },
	});
	const cases = [
		{ index: 0, patchBody: "+b\0c", error: /NUL byte/ },
		{ index: 1, patchBody: "+b\uD800c", error: /unpaired surrogate/ },
		{ index: 2, patchBody: "+b\uDC00c", error: /unpaired surrogate/ },
		{ index: 3, patchBody: "+ordinary\uD800", error: /unpaired surrogate/ },
		{ index: 4, patchBody: "+line\uD800\n+next", error: /unpaired surrogate/ },
	] as const;
	for (const { index, patchBody, error } of cases) {
		const original = Buffer.from(`source-${index}\n`);
		writeFileSync(path, original);
		const patch = `[f.txt#${fileTag(original)}]\nreplace 1:\n${patchBody}`;
		await expectToolError(fp, "edit", { input: patch }, cwd, error);
		assert.equal(writes, 0, "invalid proposed content must be rejected before the first target write");
		assert.deepEqual(readFileSync(path), original);
	}
});

test("hashline: invalid proposal in the last file of a multi-file patch causes zero writes", async () => {
	const cwd = tmp();
	const firstPath = join(cwd, "first.txt");
	const lastPath = join(cwd, "last.txt");
	const firstOriginal = Buffer.from("first\n");
	const lastOriginal = Buffer.from("last\n");
	writeFileSync(firstPath, firstOriginal);
	writeFileSync(lastPath, lastOriginal);
	let writes = 0;
	const fp = fresh({
		writeTarget: async (target, text) => { writes += 1; await writeFile(target, text, "utf8"); },
	});
	const patch =
		`[first.txt#${fileTag(firstOriginal)}]\nreplace 1:\n+FIRST\n` +
		`[last.txt#${fileTag(lastOriginal)}]\nreplace 1:\n+invalid\uD800`;
	await expectToolError(fp, "edit", { input: patch }, cwd, /unpaired surrogate/);
	assert.equal(writes, 0, "all targets must finish proposed-content validation before the first write");
	assert.deepEqual(readFileSync(firstPath), firstOriginal);
	assert.deepEqual(readFileSync(lastPath), lastOriginal);
});

test("hashline: exact HASHLINE=off leaves native tools unshadowed", async () => {
	const previous = process.env.HASHLINE;
	process.env.HASHLINE = "off";
	try {
		const extension = await import(`../extensions/hashline.ts?off=${Date.now()}-${Math.random()}`);
		const fp = makeFakePi();
		extension.default(fp.pi as any);
		assert.equal(fp.tools.has("read"), false);
		assert.equal(fp.tools.has("edit"), false);
	} finally {
		if (previous === undefined) delete process.env.HASHLINE;
		else process.env.HASHLINE = previous;
	}
});

test("hashline: concurrent same-file edits are queued and preserve both changes", async () => {
	const fp = fresh();
	const cwd = tmp();
	const path = join(cwd, "race.txt");
	writeFileSync(path, "one\ntwo\nthree\nfour\nfive\n");
	await callTool(fp, "read", { path: "race.txt" }, cwd);
	const tag = tagOf(path);
	const first = `[race.txt#${tag}]\nreplace 1..1:\n+ONE\n`;
	const second = `[race.txt#${tag}]\nreplace 5..5:\n+FIVE\n`;
	const results = await Promise.allSettled([
		callTool(fp, "edit", { input: first }, cwd),
		callTool(fp, "edit", { input: second }, cwd),
	]);
	assert.equal(results[0].status, "fulfilled");
	assert.equal(results[1].status, "fulfilled");
	assert.equal((results[1] as PromiseFulfilledResult<Awaited<ReturnType<typeof callTool>>>).value.isError, true);
	assert.match((results[1] as PromiseFulfilledResult<Awaited<ReturnType<typeof callTool>>>).value.content.map((block) => block.text ?? "").join(""), /stale tag/);
	assert.equal(readFileSync(path, "utf8"), "ONE\ntwo\nthree\nfour\nfive\n");
});

test("hashline counterfactual: the legacy unqueued read/write transaction loses one concurrent edit", async () => {
	const cwd = tmp();
	const path = join(cwd, "legacy-race.txt");
	writeFileSync(path, "one\ntwo\nthree\nfour\nfive\n");
	let ready = 0;
	let release!: () => void;
	const released = new Promise<void>((resolve) => { release = resolve; });
	let bothReady!: () => void;
	const readsComplete = new Promise<void>((resolve) => { bothReady = resolve; });
	const legacyTransaction = async (replace: (text: string) => string) => {
		const snapshot = readFileSync(path, "utf8");
		ready += 1;
		if (ready === 2) bothReady();
		await released;
		writeFileSync(path, replace(snapshot));
	};
	const first = legacyTransaction((text) => text.replace("one", "ONE"));
	const second = legacyTransaction((text) => text.replace("five", "FIVE"));
	await readsComplete;
	release();
	await Promise.all([first, second]);
	assert.notEqual(readFileSync(path, "utf8"), "ONE\ntwo\nthree\nfour\nFIVE\n",
		"both legacy transactions wrote from the same stale snapshot, so one update must be absent");
});

test("hashline: file queues serialize overlaps but leave disjoint targets parallel", async () => {
	let releaseFirst!: () => void;
	let firstEntered!: () => void;
	let otherEnteredResolve!: () => void;
	const entered = new Promise<void>((resolve) => { firstEntered = resolve; });
	const otherEnteredPromise = new Promise<void>((resolve) => { otherEnteredResolve = resolve; });
	const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
	let sameEntered = false;
	let otherEntered = false;
	const first = withMutationQueues(["/virtual/a"], async () => {
		firstEntered();
		await release;
	});
	await entered;
	const same = withMutationQueues(["/virtual/a"], async () => { sameEntered = true; });
	const other = withMutationQueues(["/virtual/b"], async () => { otherEntered = true; otherEnteredResolve(); });
	await Promise.race([
		otherEnteredPromise,
		new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("disjoint queue did not enter")), 1_000)),
	]);
	assert.equal(sameEntered, false, "an overlapping target must wait");
	assert.equal(otherEntered, true, "a disjoint target must remain parallel");
	releaseFirst();
	await Promise.all([first, same, other]);
	assert.equal(sameEntered, true);
});

test("hashline: file queues canonicalize symlink aliases before lock ordering", async () => {
	const cwd = tmp();
	const target = join(cwd, "target.txt");
	const alias = join(cwd, "alias.txt");
	const other = join(cwd, "other.txt");
	writeFileSync(target, "x\n");
	writeFileSync(other, "y\n");
	symlinkSync(target, alias);
	let release!: () => void;
	let entered!: () => void;
	const held = new Promise<void>((resolve) => { release = resolve; });
	const firstEntered = new Promise<void>((resolve) => { entered = resolve; });
	let aliasEntered = false;
	const first = withMutationQueues([target], async () => { entered(); await held; });
	await firstEntered;
	const second = withMutationQueues([alias], async () => { aliasEntered = true; });
	let otherEntered!: () => void;
	const otherAdmission = new Promise<void>((resolve) => { otherEntered = resolve; });
	const disjoint = withMutationQueues([other], async () => { otherEntered(); });
	await Promise.race([
		otherAdmission,
		new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("disjoint alias control did not enter")), 1_000)),
	]);
	assert.equal(aliasEntered, false, "two names for one file must share one queue");
	release();
	await Promise.all([first, second, disjoint]);
	assert.equal(aliasEntered, true);
});

test("hashline: multi-file edit applies both sections", async () => {
	const fp = fresh();
	const cwd = tmp();
	writeFileSync(join(cwd, "f1.txt"), "aaa\n");
	writeFileSync(join(cwd, "f2.txt"), "bbb\n");
	const patch =
		`[f1.txt#${tagOf(join(cwd, "f1.txt"))}]\nreplace 1..1:\n+AAA\n` +
		`[f2.txt#${tagOf(join(cwd, "f2.txt"))}]\nreplace 1..1:\n+BBB\n`;
	await callTool(fp, "edit", { input: patch }, cwd);
	assert.equal(readFileSync(join(cwd, "f1.txt"), "utf8"), "AAA\n");
	assert.equal(readFileSync(join(cwd, "f2.txt"), "utf8"), "BBB\n");
});

test("hashline: a stale tag with a repeated block rejects without relocating or writing any target", async () => {
	const fp = fresh();
	const cwd = tmp();
	writeFileSync(join(cwd, "f1.txt"), "aaa\n");
	writeFileSync(join(cwd, "f2.txt"), "bbb\n");
	// The stale target text still exists, but a newly inserted duplicate changes the exact-byte digest.
	writeFileSync(join(cwd, "f2.txt"), "bbb\nbbb\n");
	const patch =
		`[f1.txt#${tagOf(join(cwd, "f1.txt"))}]\nreplace 1..1:\n+AAA\n` +
		`[f2.txt#${fileTag(Buffer.from("bbb\n"))}]\nreplace 1..1:\n+BBB\n`;
	await expectToolError(fp, "edit", { input: patch }, cwd, /stale tag.*Nothing in this patch was applied/);
	// the whole patch must have rolled back — f1 is NOT half-applied
	assert.equal(readFileSync(join(cwd, "f1.txt"), "utf8"), "aaa\n", "earlier file must be untouched on a later-section failure");
	assert.equal(readFileSync(join(cwd, "f2.txt"), "utf8"), "bbb\nbbb\n");
});

test("hashline: same-file SAME-TAG sections merge into one exact apply (adjacent lines ok)", async () => {
	const fp = fresh();
	const cwd = tmp();
	writeFileSync(join(cwd, "f.txt"), "one\ntwo\nthree\n");
	const tag = tagOf(join(cwd, "f.txt"));
	// Same-stage hunks merge, even when another file section intervenes.
	writeFileSync(join(cwd, "g.txt"), "other\n");
	const patch =
		`[f.txt#${tag}]\nreplace 1..1:\n+ONE\n` +
		`[g.txt#${tagOf(join(cwd, "g.txt"))}]\nreplace 1..1:\n+OTHER\n` +
		`[f.txt#${tag}]\nreplace 3..3:\n+THREE\n`;
	await callTool(fp, "edit", { input: patch }, cwd);
	assert.equal(readFileSync(join(cwd, "f.txt"), "utf8"), "ONE\ntwo\nTHREE\n");
	assert.equal(readFileSync(join(cwd, "g.txt"), "utf8"), "OTHER\n");
});

test("hashline: same-file CHAINED-TAG section applies against the in-memory intermediate", async () => {
	const fp = fresh();
	const cwd = tmp();
	writeFileSync(join(cwd, "f.txt"), "one\ntwo\nthree\n");
	const tag1 = tagOf(join(cwd, "f.txt"));
	const intermediate = "ONE\ntwo\nthree\n";
	const tag2 = fileTag(Buffer.from(intermediate)); // the exact intermediate bytes after stage 1
	const patch =
		`[f.txt#${tag1}]\nreplace 1..1:\n+ONE\n` +
		`[f.txt#${tag2}]\nreplace 3..3:\n+THREE\n`; // different tag -> chains on the buffer, no merge
	await callTool(fp, "edit", { input: patch }, cwd);
	assert.equal(readFileSync(join(cwd, "f.txt"), "utf8"), "ONE\ntwo\nTHREE\n",
		"section 2 matched the exact intermediate byte digest");
});

test("hashline: chained-stage receipts aggregate operations and preview prior changes at final locations", async () => {
	const fp = fresh();
	const cwd = tmp();
	const path = join(cwd, "f.txt");
	const original = "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n";
	writeFileSync(path, original);
	const intermediate = original.replace("seven", "SEVEN");
	const patch =
		`[f.txt#${fileTag(Buffer.from(original))}]\nreplace 7:\n+SEVEN\n` +
		`[f.txt#${fileTag(Buffer.from(intermediate))}]\ninsert before 6:\n+INSERTED`;
	const result = await callTool(fp, "edit", { input: patch }, cwd);
	const text = result.content.map((block: { text?: string }) => block.text ?? "").join("");
	assert.match(text, /Applied 2 hunk\(s\).*\(1 replace, 1 insert, 0 delete\)/);
	assert.match(text, /8:SEVEN/, "prior stage's changed line 7 moves to final line 8 and must appear in the preview");
	assert.equal((result as any).details.firstChangedLine, 6);
	assert.equal(readFileSync(path, "utf8"), "one\ntwo\nthree\nfour\nfive\nINSERTED\nsix\nSEVEN\neight\n");
});

test("hashline: returning to a closed earlier source stage is rejected", async () => {
	const fp = fresh();
	const cwd = tmp();
	writeFileSync(join(cwd, "f.txt"), "one\ntwo\n");
	const first = tagOf(join(cwd, "f.txt"));
	const second = fileTag(Buffer.from("ONE\ntwo\n"));
	const patch = `[f.txt#${first}]\nreplace 1:\n+ONE\n[f.txt#${second}]\nreplace 2:\n+TWO\n[f.txt#${first}]\nreplace 1:\n+ONE-AGAIN`;
	await expectToolError(fp, "edit", { input: patch }, cwd, /ambiguous return to an earlier source stage/);
	assert.equal(readFileSync(join(cwd, "f.txt"), "utf8"), "one\ntwo\n");
});

test("hashline: an external write during planning is detected before the first target write", async () => {
	const cwd = tmp();
	const path = join(cwd, "f.txt");
	writeFileSync(path, "before\n");
	let writes = 0;
	const fp = fresh({
		beforeCommit: async () => { writeFileSync(path, "external\n"); },
		writeTarget: async (target, text) => { writes += 1; await writeFile(target, text, "utf8"); },
	});
	const patch = `[f.txt#${tagOf(path)}]\nreplace 1:\n+agent`;
	await expectToolError(fp, "edit", { input: patch }, cwd, /changed while this patch was being validated.*Nothing in this patch was written/);
	assert.equal(writes, 0);
	assert.equal(readFileSync(path, "utf8"), "external\n");
});

test("hashline: multi-section failure message says NOTHING was applied", async () => {
	const fp = fresh();
	const cwd = tmp();
	writeFileSync(join(cwd, "f1.txt"), "aaa\n");
	const patch =
		`[f1.txt#${tagOf(join(cwd, "f1.txt"))}]\nreplace 1..1:\n+AAA\n` +
		`[f2.txt#${"0".repeat(64)}]\nreplace 1..1:\n+BBB\n`;
	await expectToolError(fp, "edit", { input: patch }, cwd, /Nothing in this patch was written/);
});

test("hashline: write failure rolls back only attempted paths, including partial failing write", async () => {
	const cwd = tmp();
	const failingPath = join(cwd, "f2.txt");
	const unattemptedPath = join(cwd, "f3.txt");
	const attempts: string[] = [];
	const fp = fresh({
		writeTarget: async (path, text) => {
			attempts.push(path);
			if (path.endsWith("/f2.txt")) {
				await writeFile(path, Buffer.from(text).subarray(0, 2));
				throw Object.assign(new Error("injected target write failure"), { code: "EIO" });
			}
			await writeFile(path, text, "utf8");
		},
	});
	writeFileSync(join(cwd, "f1.txt"), "aaa\n");
	writeFileSync(failingPath, "bbb\n");
	writeFileSync(unattemptedPath, "ccc\n");
	const patch =
		`[f1.txt#${tagOf(join(cwd, "f1.txt"))}]\nreplace 1..1:\n+AAA\n` +
		`[f2.txt#${tagOf(join(cwd, "f2.txt"))}]\nreplace 1..1:\n+BBB\n` +
		`[f3.txt#${tagOf(unattemptedPath)}]\nreplace 1..1:\n+CCC`;
	await expectToolError(fp, "edit", { input: patch }, cwd, /attempted target was restored byte-for-byte and unattempted targets were untouched/);
	assert.deepEqual(attempts.map((path) => path.slice(path.lastIndexOf("/") + 1)), ["f1.txt", "f2.txt"]);
	assert.equal(readFileSync(join(cwd, "f1.txt"), "utf8"), "aaa\n",
		"f1 was written in phase 2, then ROLLED BACK when f2's write failed");
	assert.equal(readFileSync(failingPath, "utf8"), "bbb\n");
	assert.equal(readFileSync(unattemptedPath, "utf8"), "ccc\n");
});

test("hashline: ATOMIC — an out-of-range hunk in a later section rolls back the earlier one", async () => {
	const fp = fresh();
	const cwd = tmp();
	writeFileSync(join(cwd, "f1.txt"), "aaa\n");
	writeFileSync(join(cwd, "f2.txt"), "bbb\n");
	const patch =
		`[f1.txt#${tagOf(join(cwd, "f1.txt"))}]\nreplace 1..1:\n+AAA\n` +
		`[f2.txt#${tagOf(join(cwd, "f2.txt"))}]\nreplace 5..9:\n+BBB\n`; // f2 has 1 line
	await expectToolError(fp, "edit", { input: patch }, cwd, /.?/);
	assert.equal(readFileSync(join(cwd, "f1.txt"), "utf8"), "aaa\n", "earlier file untouched on a later apply error");
});
