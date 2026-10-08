import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRuntimeReceipt } from "../lib/runtime-receipt.ts";
import { piCompatibility } from "../lib/pi-compatibility.ts";
test("actual source changes invalidate receipts; undeclared credentials and invalid flags are excluded", async () => {
 const dir = await mkdtemp(join(tmpdir(), "runtime-receipt-"));
 try {
  const entry = join(dir, "index.ts"); await writeFile(entry, "export default 1;");
  const input = { piVersion: "1.0.4", baseDir: dir, entryPoints: [entry], evidence: "loaded" as const, registeredTools: ["read"], activeTools: [], generation: 1, sessionId: "private-session", env: { API_KEY: "sensitive", GOALS: "sensitive" } };
  const first = await buildRuntimeReceipt(input); await writeFile(entry, "export default 2;");
  assert.notEqual((await buildRuntimeReceipt(input)).sourceHash, first.sourceHash);
  assert.equal(JSON.stringify(first).includes("sensitive"), false); assert.equal(JSON.stringify(first).includes("private-session"), false);
  assert.equal(first.flags.RUN_CAPSULE.effective, "recovery");
  assert.equal(first.flags.CONTROL_ARBITER.effective, "enforce");
  assert.equal(first.evidence, "loaded"); assert.equal(first.effectiveProvider, null);
 } finally { await rm(dir, { recursive: true }); }
});
test("compatibility keeps the pinned contract and selects Pi 1.x actionable settlement", () => {
 assert.equal(piCompatibility("0.80.6").actionableSettlement, false);
 assert.equal(piCompatibility("1.0.4").actionableSettlement, true);
 assert.throws(() => piCompatibility("2.0.0")); assert.throws(() => piCompatibility("unknown"));
});
