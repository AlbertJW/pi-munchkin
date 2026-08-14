import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { LIVE_PACKAGE_DIR, liveOrderedManifest, buildLiveMirrorPlan, compareLiveMirror, findLiveMirrorOrphans } from "../lib/live-mirror.ts";
import { discoverEntryPoints } from "../lib/surface-walk.ts";

async function materialize(root: string, agentDir: string, entries: Awaited<ReturnType<typeof buildLiveMirrorPlan>>): Promise<void> {
	for (const entry of entries) {
		const destination = resolve(agentDir, entry.destination);
		await mkdir(dirname(destination), { recursive: true });
		if (entry.kind === "copy") await copyFile(resolve(root, entry.source), destination);
		else await writeFile(destination, entry.content);
	}
}

test("live mirror manifest covers declared first-party surfaces and ignores local-only additions", async () => {
  const root = resolve(import.meta.dirname, "../..");
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const entries = await buildLiveMirrorPlan(root, manifest);
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
    await materialize(root, agentDir, entries);
    await writeFile(resolve(agentDir, "extensions", "local-only.ts"), "// documented local-only addition\n");
    assert.deepEqual(await compareLiveMirror(root, agentDir, entries), []);
	const generated = resolve(agentDir, LIVE_PACKAGE_DIR, "package.json");
	await rm(generated);
	assert.deepEqual((await compareLiveMirror(root, agentDir, entries)).map(({ destination, reason }) => ({ destination, reason })), [
		{ destination: `${LIVE_PACKAGE_DIR}/package.json`, reason: "missing" },
	]);
	await materialize(root, agentDir, entries);
    await writeFile(resolve(agentDir, LIVE_PACKAGE_DIR, "extensions", "hashline.ts"), "// drift\n");
	assert.deepEqual((await compareLiveMirror(root, agentDir, entries)).map(({ destination, reason }) => ({ destination, reason })), [
      { destination: `${LIVE_PACKAGE_DIR}/extensions/hashline.ts`, reason: "content" },
    ]);
	await materialize(root, agentDir, entries);
	const parsed = JSON.parse(await readFile(generated, "utf8"));
	parsed.pi.extensions.reverse();
	await writeFile(generated, `${JSON.stringify(parsed, null, 2)}\n`);
	assert.deepEqual((await compareLiveMirror(root, agentDir, entries)).map(({ destination, reason }) => ({ destination, reason })), [
		{ destination: `${LIVE_PACKAGE_DIR}/package.json`, reason: "content" },
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
	const entries = await buildLiveMirrorPlan(resolve(import.meta.dirname, "../.."), manifest);

	// 1. No first-party extension may land LOOSE at the extensions root, where
	//    rule 1 would discover it and silently reimpose readdir order.
	const loose = entries.filter((entry) => /^extensions\/[^/]+\.ts$/.test(entry.destination));
	assert.deepEqual(loose, [], "these files would be discovered by readdir order, bypassing the manifest");

	// 2. Every declared extension lands inside the ordered package directory.
	for (const extension of manifest.pi.extensions) {
		const destination = entries.find((entry) => entry.kind === "copy" && entry.source === extension)?.destination;
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
	const entries = await buildLiveMirrorPlan(root, manifest);
	const agentDir = await mkdtemp(resolve(tmpdir(), "pi-mirror-order-"));
	const priorTelemetry = process.env.TELEMETRY;
	process.env.TELEMETRY = "off";
	try {
		await materialize(root, agentDir, entries);
		await writeFile(resolve(agentDir, "settings.json"), "{}");

		const bus = { on: () => () => {}, emit: () => {} };
		const loaded = await loader.discoverAndLoadExtensions([], root, agentDir, bus);
		const order = ((loaded as { extensions?: { path?: string }[] }).extensions ?? [])
			.map((extension) => String(extension.path ?? "").replace(`${agentDir}/${LIVE_PACKAGE_DIR}/`, ""));
		const expected = manifest.pi.extensions.map((e: string) => e.slice("harness/".length));
		assert.deepEqual(order, expected,
			"pi must load first-party extensions in MANIFEST order — this is the architecture, not a preference");
		const discovered = await discoverEntryPoints(agentDir, root);
		const ours = discovered.orderedEntryPoints
			.filter((entry) => entry.startsWith(resolve(agentDir, LIVE_PACKAGE_DIR)))
			.map((entry) => entry.replace(`${agentDir}/${LIVE_PACKAGE_DIR}/`, ""));
		assert.deepEqual(ours, order, "surface discovery and Pi must agree on package-directory topology");
	} finally {
		if (priorTelemetry === undefined) delete process.env.TELEMETRY; else process.env.TELEMETRY = priorTelemetry;
		await rm(agentDir, { recursive: true, force: true });
	}
});

test("mirror check allows documented chaos.ts but rejects an unmanaged loadable package directory", async () => {
	const root = resolve(import.meta.dirname, "../..");
	const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
	const entries = await buildLiveMirrorPlan(root, manifest);
	const agentDir = await mkdtemp(resolve(tmpdir(), "pi-mirror-unmanaged-"));
	try {
		await materialize(root, agentDir, entries);
		await writeFile(resolve(agentDir, "extensions", "chaos.ts"), "export default function () {}\n");
		const check = () => spawnSync(process.execPath, [resolve(root, "harness/scripts/live-mirror-check.mjs"), agentDir], {
			cwd: root, encoding: "utf8",
		});
		assert.equal(check().status, 0, "documented local-only chaos.ts remains allowed");
		await mkdir(resolve(agentDir, "extensions", "rogue"), { recursive: true });
		await writeFile(resolve(agentDir, "extensions", "rogue", "index.ts"), "export default function () {}\n");
		const rejected = check();
		assert.notEqual(rejected.status, 0);
		assert.match(rejected.stderr, /extensions\/rogue: loaded live but not in the package manifest/);
	} finally {
		await rm(agentDir, { recursive: true, force: true });
	}
});

test("findLiveMirrorOrphans flags in-package orphans and staging, never managed or out-of-reach files", async () => {
	const root = resolve(import.meta.dirname, "../..");
	const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
	const entries = await buildLiveMirrorPlan(root, manifest);
	const agentDir = await mkdtemp(resolve(tmpdir(), "pi-mirror-orphan-"));
	try {
		await materialize(root, agentDir, entries);
		assert.deepEqual(await findLiveMirrorOrphans(agentDir, entries), { orphans: [], staging: [] },
			"a clean mirror has no orphans");

		// a retired extension + its lib helper left inside the package dir, plus crash debris
		await writeFile(resolve(agentDir, LIVE_PACKAGE_DIR, "extensions", "retired.ts"), "// orphan\n");
		await writeFile(resolve(agentDir, LIVE_PACKAGE_DIR, "lib", "retired-policy.ts"), "// orphan\n");
		await writeFile(resolve(agentDir, LIVE_PACKAGE_DIR, "extensions", "hashline.ts.staging-9999"), "// debris\n");
		// out-of-reach: a flat extension and a diverged root-lib file must NOT be flagged
		await writeFile(resolve(agentDir, "extensions", "chaos.ts"), "// flat local-only\n");
		await mkdir(resolve(agentDir, "lib"), { recursive: true });
		await writeFile(resolve(agentDir, "lib", "root-only.ts"), "// diverged root tree\n");

		const { orphans, staging } = await findLiveMirrorOrphans(agentDir, entries);
		assert.deepEqual(orphans, [
			`${LIVE_PACKAGE_DIR}/extensions/retired.ts`,
			`${LIVE_PACKAGE_DIR}/lib/retired-policy.ts`,
		]);
		assert.deepEqual(staging, [`${LIVE_PACKAGE_DIR}/extensions/hashline.ts.staging-9999`]);
		assert.ok(!orphans.includes(`${LIVE_PACKAGE_DIR}/package.json`), "the generated manifest is managed, not an orphan");
		assert.ok(!orphans.some((o) => o.endsWith("/hashline.ts")), "managed extensions are not orphans");
	} finally {
		await rm(agentDir, { recursive: true, force: true });
	}
});

test("mirror check fails on an in-package orphan the owner-granularity check misses", async () => {
	const root = resolve(import.meta.dirname, "../..");
	const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
	const entries = await buildLiveMirrorPlan(root, manifest);
	const agentDir = await mkdtemp(resolve(tmpdir(), "pi-mirror-orphan-check-"));
	try {
		await materialize(root, agentDir, entries);
		const check = () => spawnSync(process.execPath, [resolve(root, "harness/scripts/live-mirror-check.mjs"), agentDir], {
			cwd: root, encoding: "utf8",
		});
		assert.equal(check().status, 0, "a clean mirror passes");
		await writeFile(resolve(agentDir, LIVE_PACKAGE_DIR, "extensions", "retired.ts"), "// orphan a prior mirror left behind\n");
		const rejected = check();
		assert.notEqual(rejected.status, 0, "an in-package orphan must fail the check");
		assert.match(rejected.stderr, /extensions\/pi-munchkin\/extensions\/retired\.ts: in the live package dir but not declared/);
	} finally {
		await rm(agentDir, { recursive: true, force: true });
	}
});

test("apply reports orphans by default, prunes only under --prune, never out-of-reach files", async () => {
	const root = resolve(import.meta.dirname, "../..");
	const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
	const entries = await buildLiveMirrorPlan(root, manifest);
	const agentDir = await mkdtemp(resolve(tmpdir(), "pi-mirror-prune-"));
	const apply = (extra: string[]) => spawnSync(process.execPath,
		[resolve(root, "harness/scripts/live-mirror-apply.mjs"), agentDir, "--force", ...extra], { cwd: root, encoding: "utf8" });
	try {
		await materialize(root, agentDir, entries);
		const orphan = resolve(agentDir, LIVE_PACKAGE_DIR, "extensions", "retired.ts");
		const staging = resolve(agentDir, LIVE_PACKAGE_DIR, "extensions", "hashline.ts.staging-9999");
		const flat = resolve(agentDir, "extensions", "chaos.ts");
		await mkdir(resolve(agentDir, "lib"), { recursive: true });
		const rootLib = resolve(agentDir, "lib", "root-only.ts");
		for (const p of [orphan, staging, flat, rootLib]) await writeFile(p, "// present\n");

		const report = apply([]);
		assert.equal(report.status, 0, "apply without --prune still succeeds");
		assert.match(report.stderr, /orphan \(not in manifest\): extensions\/pi-munchkin\/extensions\/retired\.ts/);
		assert.ok(existsSync(orphan), "no --prune: the orphan is reported, not deleted");

		const pruned = apply(["--prune"]);
		assert.equal(pruned.status, 0);
		assert.ok(!existsSync(orphan), "--prune deletes the in-package orphan");
		assert.ok(!existsSync(staging), "--prune clears staging debris");
		assert.ok(existsSync(flat), "the flat extensions root is out of reach");
		assert.ok(existsSync(rootLib), "the root lib tree is out of reach");
		assert.ok(existsSync(resolve(agentDir, LIVE_PACKAGE_DIR, "extensions", "hashline.ts")), "managed files survive prune");
	} finally {
		await rm(agentDir, { recursive: true, force: true });
	}
});
