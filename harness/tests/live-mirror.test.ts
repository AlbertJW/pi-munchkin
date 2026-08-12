import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { LIVE_PACKAGE_DIR, liveOrderedManifest, buildLiveMirrorManifest, compareLiveMirror } from "../lib/live-mirror.ts";

test("live mirror manifest covers declared first-party surfaces and ignores local-only additions", async () => {
  const root = resolve(import.meta.dirname, "../..");
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const entries = await buildLiveMirrorManifest(root, manifest);
  const destinations = new Set(entries.map(({ destination }) => destination));
  for (const expected of [
    // Extensions, lib and vendor live under ONE ordered package directory (see
    // live-mirror.ts): pi discovers loose extension files by readdir order, so a
    // flat layout would ship the right files in the wrong order.
    `${LIVE_PACKAGE_DIR}/extensions/hashline.ts`, `${LIVE_PACKAGE_DIR}/lib/role-routing.ts`,
    `${LIVE_PACKAGE_DIR}/vendor/pi-subagent/index.ts`,
    // ...while everything pi reads from the agent ROOT stays at the root.
    "agents/executor.md", "APPEND_SYSTEM.md", "examples/run-model.example.sh",
    "skills/deep-research/SKILL.md", "skills/lavish-review/SKILL.md",
  ]) assert(destinations.has(expected), `missing ${expected}`);
  assert(!destinations.has(`${LIVE_PACKAGE_DIR}/extensions/chaos.ts`));

  const agentDir = await mkdtemp(resolve(tmpdir(), "pi-mirror-test-"));
  try {
    for (const entry of entries) {
      const destination = resolve(agentDir, entry.destination);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(resolve(root, entry.source), destination);
    }
    await writeFile(resolve(agentDir, "extensions", "local-only.ts"), "// documented local-only addition\n");
    assert.deepEqual(await compareLiveMirror(root, agentDir, entries), []);
    await writeFile(resolve(agentDir, LIVE_PACKAGE_DIR, "extensions", "hashline.ts"), "// drift\n");
    assert.deepEqual((await compareLiveMirror(root, agentDir, entries)).map(({ destination, reason }) => ({ destination, reason })), [
      { destination: `${LIVE_PACKAGE_DIR}/extensions/hashline.ts`, reason: "content" },
    ]);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("the live layout preserves MANIFEST order — pi discovers loose files by readdir, not by our intent", async () => {
	// The architecture is an ORDER, not a set of files. Pi's loader
	// (dist/core/extensions/loader.js, discoverExtensionsInDir) enumerates
	// `<agentDir>/extensions/*.ts` with readdirSync — alphabetical on this
	// machine — so a FLAT mirror ships the right bytes in the wrong order:
	// control-arbiter would decide before its producers propose, run-capsule
	// would arm before the kernel disarms it, telemetry-flush would not be last.
	// Rule 3 of that same loader is the fix: a subdirectory whose package.json
	// declares `pi.extensions` loads exactly what it declares, in order.
	const { readFileSync } = await import("node:fs");
	const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
	const entries = await buildLiveMirrorManifest(resolve(import.meta.dirname, "../.."), manifest);

	// 1. No first-party extension may land LOOSE at the extensions root, where
	//    rule 1 would discover it and silently reimpose readdir order.
	const loose = entries.filter((entry) => /^extensions\/[^/]+\.ts$/.test(entry.destination));
	assert.deepEqual(loose, [], "these files would be discovered by readdir order, bypassing the manifest");

	// 2. Every declared extension lands inside the ordered package directory.
	for (const extension of manifest.pi.extensions) {
		const destination = entries.find((entry) => entry.source === extension)?.destination;
		assert.ok(destination?.startsWith(`${LIVE_PACKAGE_DIR}/`), `${extension} must live under the ordered package`);
	}

	// 3. The generated entry manifest lists them in MANIFEST order, and each
	//    path resolves the way the loader resolves it (relative to the package dir).
	const ordered = liveOrderedManifest(manifest);
	assert.deepEqual(ordered.extensions, manifest.pi.extensions.map((e: string) => `./${e.slice("harness/".length)}`));
	for (const declared of ordered.extensions) {
		const resolved = `${LIVE_PACKAGE_DIR}/${declared.slice(2)}`;
		assert.ok(entries.some((entry) => entry.destination === resolved), `${declared} must be a file the mirror copies`);
	}

	// 4. Relative imports must still resolve: an extension at
	//    <pkg>/extensions/x.ts importing ../lib/y.ts needs <pkg>/lib/y.ts.
	assert.ok(entries.some((entry) => entry.destination === `${LIVE_PACKAGE_DIR}/lib/telemetry.ts`),
		"lib must move WITH the extensions or every ../lib import breaks");
});

test("PI'S OWN LOADER returns the manifest order for the built live layout", async () => {
	// The test above encodes my reading of the loader's rules; this one asks the
	// loader. That distinction is the lesson of the plan-gate defect: a contract
	// verified against a restatement of the system is not verified.
	const loader = await import("@earendil-works/pi-coding-agent/dist/core/extensions/loader.js" as string)
		.catch(() => null) as { discoverAndLoadExtensions?: Function } | null;
	if (!loader?.discoverAndLoadExtensions) return; // packaged consumers may not expose it
	const root = resolve(import.meta.dirname, "../..");
	const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
	const entries = await buildLiveMirrorManifest(root, manifest);
	const agentDir = await mkdtemp(resolve(tmpdir(), "pi-mirror-order-"));
	const priorTelemetry = process.env.TELEMETRY;
	process.env.TELEMETRY = "off";
	try {
		for (const entry of entries) {
			const destination = resolve(agentDir, entry.destination);
			await mkdir(dirname(destination), { recursive: true });
			await copyFile(resolve(root, entry.source), destination);
		}
		await writeFile(resolve(agentDir, LIVE_PACKAGE_DIR, "package.json"),
			JSON.stringify({ name: "pi-munchkin-live", private: true, pi: liveOrderedManifest(manifest) }, null, 2));
		await writeFile(resolve(agentDir, "settings.json"), "{}");

		const bus = { on: () => () => {}, emit: () => {} };
		const loaded = await loader.discoverAndLoadExtensions([], root, agentDir, bus);
		const order = ((loaded as { extensions?: { path?: string }[] }).extensions ?? [])
			.map((extension) => String(extension.path ?? "").replace(`${agentDir}/${LIVE_PACKAGE_DIR}/`, ""));
		const expected = manifest.pi.extensions.map((e: string) => e.slice("harness/".length));
		assert.deepEqual(order, expected,
			"pi must load first-party extensions in MANIFEST order — this is the architecture, not a preference");
	} finally {
		if (priorTelemetry === undefined) delete process.env.TELEMETRY; else process.env.TELEMETRY = priorTelemetry;
		await rm(agentDir, { recursive: true, force: true });
	}
});
