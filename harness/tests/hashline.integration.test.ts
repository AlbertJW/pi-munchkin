// Integration tests for the hashline edit tool's MULTI-FILE apply, focused on
// transactionality: a patch spanning several files must be all-or-nothing. The
// atomicity test FAILS on the pre-2026-07-14 sequential-write loop (file 1 is
// written before file 2's bad tag throws) and PASSES once apply is two-phase.
import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileTag, normalizeText } from "../lib/hashline-core.ts";
import { callTool, makeFakePi } from "./integration-harness.ts";

const hashline = (await import("../extensions/hashline.ts")).default;
const tmp = () => mkdtempSync(join(tmpdir(), "pi-hl-"));
const tagOf = (path: string) => fileTag(normalizeText(readFileSync(path, "utf8")));

function fresh() {
	const fp = makeFakePi();
	hashline(fp.pi as any);
	return fp;
}

test("hashline: single-file edit applies with the live tag", async () => {
	const fp = fresh();
	const cwd = tmp();
	writeFileSync(join(cwd, "a.txt"), "hello\n");
	const patch = `[a.txt#${tagOf(join(cwd, "a.txt"))}]\nreplace 1..1:\n+HELLO\n`;
	await callTool(fp, "edit", { input: patch }, cwd);
	assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "HELLO\n");
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
	await assert.rejects(() => callTool(fp, "edit", { input: patch }, cwd), /tag is not from this session/);
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
	await assert.rejects(() => callTool(fp, "edit", { input: patch }, cwd), /NONE were applied.*re-emit the ENTIRE patch/);
});

test("hashline: phase-2 WRITE failure rolls earlier files back (I/O atomicity)", async () => {
	const fp = fresh();
	const cwd = tmp();
	writeFileSync(join(cwd, "f1.txt"), "aaa\n");
	writeFileSync(join(cwd, "f2.txt"), "bbb\n");
	chmodSync(join(cwd, "f2.txt"), 0o444); // readable (phase 1 passes) but NOT writable (phase 2 fails)
	const patch =
		`[f1.txt#${tagOf(join(cwd, "f1.txt"))}]\nreplace 1..1:\n+AAA\n` +
		`[f2.txt#${tagOf(join(cwd, "f2.txt"))}]\nreplace 1..1:\n+BBB\n`;
	await assert.rejects(() => callTool(fp, "edit", { input: patch }, cwd), /every target was restored to its pre-patch state/);
	assert.equal(readFileSync(join(cwd, "f1.txt"), "utf8"), "aaa\n",
		"f1 was written in phase 2, then ROLLED BACK when f2's write failed");
	chmodSync(join(cwd, "f2.txt"), 0o644);
});

test("hashline: ATOMIC — an out-of-range hunk in a later section rolls back the earlier one", async () => {
	const fp = fresh();
	const cwd = tmp();
	writeFileSync(join(cwd, "f1.txt"), "aaa\n");
	writeFileSync(join(cwd, "f2.txt"), "bbb\n");
	const patch =
		`[f1.txt#${tagOf(join(cwd, "f1.txt"))}]\nreplace 1..1:\n+AAA\n` +
		`[f2.txt#${tagOf(join(cwd, "f2.txt"))}]\nreplace 5..9:\n+BBB\n`; // f2 has 1 line
	await assert.rejects(() => callTool(fp, "edit", { input: patch }, cwd));
	assert.equal(readFileSync(join(cwd, "f1.txt"), "utf8"), "aaa\n", "earlier file untouched on a later apply error");
});
