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
import { fileTag, normalizeText } from "../lib/hashline-core.ts";
import { registerHashline, withMutationQueues, type HashlineIo } from "../extensions/hashline.ts";
import { callTool, expectToolError, makeFakePi } from "./integration-harness.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "pi-hl-"));
const tagOf = (path: string) => fileTag(normalizeText(readFileSync(path, "utf8")));

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
	await expectToolError(fp, "edit", { input: "[huge.txt#deadbeef]\nreplace 1..1:\n+x\n" }, cwd, /purpose-built bounded span tool/);
});

test("hashline: single-file edit applies with the live tag", async () => {
	const fp = fresh();
	const cwd = tmp();
	writeFileSync(join(cwd, "a.txt"), "hello\n");
	const patch = `[a.txt#${tagOf(join(cwd, "a.txt"))}]\nreplace 1..1:\n+HELLO\n`;
	await callTool(fp, "edit", { input: patch }, cwd);
	assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "HELLO\n");
});

test("hashline: concurrent same-file edits are queued and preserve both changes", async () => {
	const fp = fresh();
	const cwd = tmp();
	const path = join(cwd, "race.txt");
	writeFileSync(path, "one\ntwo\nthree\nfour\nfive\n");
	await callTool(fp, "read", { path: "race.txt" }, cwd); // records the shared baseline snapshot
	const tag = tagOf(path);
	const first = `[race.txt#${tag}]\nreplace 1..1:\n+ONE\n`;
	const second = `[race.txt#${tag}]\nreplace 5..5:\n+FIVE\n`;
	await Promise.all([
		callTool(fp, "edit", { input: first }, cwd),
		callTool(fp, "edit", { input: second }, cwd),
	]);
	assert.equal(readFileSync(path, "utf8"), "ONE\ntwo\nthree\nfour\nFIVE\n");
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

test("hashline: ATOMIC — a bad tag in a later section leaves earlier files UNTOUCHED", async () => {
	const fp = fresh();
	const cwd = tmp();
	writeFileSync(join(cwd, "f1.txt"), "aaa\n");
	writeFileSync(join(cwd, "f2.txt"), "bbb\n");
	// section 1 valid, section 2 carries a tag that is neither live nor snapshotted
	const patch =
		`[f1.txt#${tagOf(join(cwd, "f1.txt"))}]\nreplace 1..1:\n+AAA\n` +
		`[f2.txt#deadbeef]\nreplace 1..1:\n+BBB\n`;
	// The diagnosis names what was actually checked (the snapshot LRU), not a session
	// boundary the module-scope store does not have.
	await expectToolError(fp, "edit", { input: patch }, cwd, /no retained snapshot carries this tag/);
	// the whole patch must have rolled back — f1 is NOT half-applied
	assert.equal(readFileSync(join(cwd, "f1.txt"), "utf8"), "aaa\n", "earlier file must be untouched on a later-section failure");
	assert.equal(readFileSync(join(cwd, "f2.txt"), "utf8"), "bbb\n");
});

test("hashline: same-file SAME-TAG sections merge into one exact apply (adjacent lines ok)", async () => {
	const fp = fresh();
	const cwd = tmp();
	writeFileSync(join(cwd, "f.txt"), "one\ntwo\nthree\n");
	await callTool(fp, "read", { path: "f.txt" }, cwd);
	const tag = tagOf(join(cwd, "f.txt"));
	// both sections carry the ORIGINAL tag (composed against one read) and sit
	// within ±2 lines of each other — the self-relocation path fails here
	// (pre-existing, verified against the old code); the merge pre-pass makes it exact
	const patch =
		`[f.txt#${tag}]\nreplace 1..1:\n+ONE\n` +
		`[f.txt#${tag}]\nreplace 3..3:\n+THREE\n`;
	await callTool(fp, "edit", { input: patch }, cwd);
	assert.equal(readFileSync(join(cwd, "f.txt"), "utf8"), "ONE\ntwo\nTHREE\n");
});

test("hashline: same-file CHAINED-TAG section applies against the in-memory intermediate", async () => {
	const fp = fresh();
	const cwd = tmp();
	writeFileSync(join(cwd, "f.txt"), "one\ntwo\nthree\n");
	const tag1 = tagOf(join(cwd, "f.txt"));
	const intermediate = "ONE\ntwo\nthree\n";
	const tag2 = fileTag(normalizeText(intermediate)); // the tag section 1's result WILL have
	const patch =
		`[f.txt#${tag1}]\nreplace 1..1:\n+ONE\n` +
		`[f.txt#${tag2}]\nreplace 3..3:\n+THREE\n`; // different tag -> chains on the buffer, no merge
	await callTool(fp, "edit", { input: patch }, cwd);
	assert.equal(readFileSync(join(cwd, "f.txt"), "utf8"), "ONE\ntwo\nTHREE\n",
		"section 2 matched the intermediate buffer's live tag without any snapshot");
});

test("hashline: multi-section failure message says NOTHING was applied", async () => {
	const fp = fresh();
	const cwd = tmp();
	writeFileSync(join(cwd, "f1.txt"), "aaa\n");
	const patch =
		`[f1.txt#${tagOf(join(cwd, "f1.txt"))}]\nreplace 1..1:\n+AAA\n` +
		`[f2.txt#deadbeef]\nreplace 1..1:\n+BBB\n`;
	await expectToolError(fp, "edit", { input: patch }, cwd, /NONE were applied.*re-emit the ENTIRE patch/);
});

test("hashline: phase-2 WRITE failure rolls earlier files back (I/O atomicity)", async () => {
	const cwd = tmp();
	const failingPath = join(cwd, "f2.txt");
	const fp = fresh({
		writeTarget: async (path, text) => {
			if (path === failingPath) throw Object.assign(new Error("injected target write failure"), { code: "EIO" });
			await writeFile(path, text, "utf8");
		},
	});
	writeFileSync(join(cwd, "f1.txt"), "aaa\n");
	writeFileSync(failingPath, "bbb\n");
	const patch =
		`[f1.txt#${tagOf(join(cwd, "f1.txt"))}]\nreplace 1..1:\n+AAA\n` +
		`[f2.txt#${tagOf(join(cwd, "f2.txt"))}]\nreplace 1..1:\n+BBB\n`;
	await expectToolError(fp, "edit", { input: patch }, cwd, /every target was restored to its pre-patch state/);
	assert.equal(readFileSync(join(cwd, "f1.txt"), "utf8"), "aaa\n",
		"f1 was written in phase 2, then ROLLED BACK when f2's write failed");
	assert.equal(readFileSync(failingPath, "utf8"), "bbb\n");
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
