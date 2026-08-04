import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { buildLiveMirrorManifest, compareLiveMirror } from "../lib/live-mirror.ts";

test("live mirror manifest covers declared first-party surfaces and ignores local-only additions", async () => {
  const root = resolve(import.meta.dirname, "../..");
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const entries = await buildLiveMirrorManifest(root, manifest);
  const destinations = new Set(entries.map(({ destination }) => destination));
  for (const expected of [
    "extensions/hashline.ts", "lib/role-routing.ts", "vendor/pi-subagent/index.ts",
    "agents/executor.md", "APPEND_SYSTEM.md", "examples/run-model.example.sh",
    "skills/deep-research/SKILL.md", "skills/lavish-review/SKILL.md",
  ]) assert(destinations.has(expected), `missing ${expected}`);
  assert(!destinations.has("extensions/chaos.ts"));

  const agentDir = await mkdtemp(resolve(tmpdir(), "pi-mirror-test-"));
  try {
    for (const entry of entries) {
      const destination = resolve(agentDir, entry.destination);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(resolve(root, entry.source), destination);
    }
    await writeFile(resolve(agentDir, "extensions", "local-only.ts"), "// documented local-only addition\n");
    assert.deepEqual(await compareLiveMirror(root, agentDir, entries), []);
    await writeFile(resolve(agentDir, "extensions", "hashline.ts"), "// drift\n");
    assert.deepEqual((await compareLiveMirror(root, agentDir, entries)).map(({ destination, reason }) => ({ destination, reason })), [
      { destination: "extensions/hashline.ts", reason: "content" },
    ]);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});
