import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256, type FailureEpisode } from "../lib/failure-episodes.ts";
import {
	loopRecoveryPath, recoveryReceipt, tierForCount, writeLoopRecoveryReceipt,
} from "../lib/loop-recovery.ts";

const episode: FailureEpisode = {
	id: "safe-id", key: sha256("episode-key"), failureClass: "permission",
	toolFamily: "file_mutation", targetHash: sha256("target"), planItemHash: sha256("plan"),
	count: 6, callsAfterSecond: 4, correlatedCallsAfterSecond: 3, strategyHashes: [sha256("strategy")],
	openedAt: "2026-08-05T00:00:00.000Z", updatedAt: "2026-08-05T00:01:00.000Z",
	status: "active", recovery: null,
};

test("semantic and session tier thresholds select only the highest reached tier", () => {
	assert.equal(tierForCount(1, 2, 4, 6), 0);
	assert.equal(tierForCount(2, 2, 4, 6), 1);
	assert.equal(tierForCount(4, 2, 4, 6), 2);
	assert.equal(tierForCount(6, 2, 4, 6), 3);
});

test("private recovery receipt contains only bounded hashes and safe state", async () => {
	const root = await mkdtemp(join(tmpdir(), "loop-receipt-"));
	const cwd = "/private/project/DUMMY_PRIVATE_PATH";
	const dummy = "DUMMY_SECRET_COMMAND_ERROR_ENDPOINT";
	const receipt = recoveryReceipt(episode, { mutated: true, verifiedOk: false }, "a".repeat(64), "2026-08-05T00:02:00.000Z");
	await writeLoopRecoveryReceipt(cwd, receipt, { PI_CODING_AGENT_DIR: root } as NodeJS.ProcessEnv);
	const path = loopRecoveryPath(cwd, { PI_CODING_AGENT_DIR: root } as NodeJS.ProcessEnv);
	const raw = await readFile(path, "utf8");
	const mode = (await stat(path)).mode & 0o777;
	assert.equal(mode, 0o600);
	assert.equal(raw.includes(cwd), false);
	assert.equal(raw.includes(dummy), false);
	assert.equal(raw.includes("command"), false);
	assert.deepEqual(JSON.parse(raw), receipt);
});
