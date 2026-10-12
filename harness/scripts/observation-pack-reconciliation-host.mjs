#!/usr/bin/env node
// Zero-inference Pi SDK validation of the actual Munchkin + SoL-Pi package load.
// It uses Pi's resource loader/ExtensionRunner, SessionManager, and tree navigator;
// no context-handler order is imposed by this test.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repo = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const agentPackage = process.env.PI_PACKAGE_ROOT ?? "/Users/Albert.Wessels/.pi/agent/node_modules/@earendil-works/pi-coding-agent/package.json";
const sdkPath = join(dirname(agentPackage), "dist/index.js");
const sdk = await import(pathToFileURL(sdkPath).href);
const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } = sdk;
const solPi = resolve(process.env.SOL_PI_REPO ?? "/Users/Albert.Wessels/LLM/local-packages/sol-pi-observationpack");
const munchkin = resolve(process.env.MUNCHKIN_PACKAGE ?? "/Users/Albert.Wessels/.pi/agent/extensions/pi-munchkin");
const work = await mkdtemp(join(tmpdir(), "obspack-reconcile-sdk-"));
const agentDir = join(work, "agent");
const projectDir = join(work, "project");
const sessionsDir = join(work, "sessions");
await Promise.all([mkdir(agentDir), mkdir(projectDir), mkdir(sessionsDir)]);
await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [
	{ source: munchkin, extensions: ["extensions/context-dedup.ts", "extensions/hashline.ts", "extensions/tool-activation.ts"] },
	solPi,
] }, null, 2) + "\n");
await writeFile(join(agentDir, "sol-pi.json"), JSON.stringify({
	version: 1, actionFusion: false, observationPack: true,
	evidencePreservingReducer: false, onlineContextCompact: false,
	cacheWriteReadRatio: 12.5,
}, null, 2) + "\n");

function readResult(text, toolName = "fixture", toolCallId = "fixture-call") {
	return { role: "toolResult", toolName, toolCallId, isError: false, timestamp: Date.now(), content: [{ type: "text", text }] };
}
function createSessionManager() { return SessionManager.create(projectDir, sessionsDir); }
async function createSession({ manager, tools } = {}) {
	const settingsManager = SettingsManager.create(projectDir, agentDir);
	const resourceLoader = new DefaultResourceLoader({ cwd: projectDir, agentDir, settingsManager });
	await resourceLoader.reload();
	const result = await createAgentSession({ cwd: projectDir, agentDir, settingsManager, resourceLoader,
		sessionManager: manager ?? createSessionManager(), ...(tools ? { tools } : {}) });
	await result.session.bindExtensions({ mode: "rpc" });
	return result;
}
const bytesOf = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");
const summary = { host: "Pi SDK / ExtensionRunner", piPackage: sdkPath, inference: false, checks: {} };

try {
	const { session, extensionsResult } = await createSession();
	try {
		const runner = session.extensionRunner;
		const paths = runner.getExtensionPaths();
		const dedupPath = paths.findIndex((p) => p.endsWith("/extensions/context-dedup.ts"));
		const packPath = paths.findIndex((p) => p.endsWith("/src/sol-pi/index.ts"));
		const hashlinePath = paths.findIndex((p) => p.endsWith("/extensions/hashline.ts"));
		const activationPath = paths.findIndex((p) => p.endsWith("/extensions/tool-activation.ts"));
		assert.ok(dedupPath >= 0 && packPath >= 0 && dedupPath < packPath, `actual loader order must place Munchkin dedup before SoL-Pi: ${paths.join(",")}`);
		assert.ok(hashlinePath >= 0 && activationPath > hashlinePath, "actual loader must include Hashline before tool activation");
		await new Promise((resolve) => setTimeout(resolve, 10));
		const allTools = runner.getAllRegisteredTools();
		const obsTool = runner.getToolDefinition("obs_recall");
		const readTool = runner.getToolDefinition("read");
		const editTool = runner.getToolDefinition("edit");
		assert.ok(obsTool, `ObservationPack recall tool is registered; paths=${paths.join(",")}; errors=${JSON.stringify(extensionsResult.errors)}; tools=${allTools.map((tool) => tool.definition.name).join(",")}`);
		assert.ok(runner.getActiveTools().includes("obs_recall"), "default core surface activates recall");
		assert.ok(readTool?.description.includes("#TAG") && /stale tags always fail/iu.test(editTool?.description ?? ""), "installed Hashline read/edit contract is preserved");
		assert.equal(extensionsResult.errors.length, 0, "Pi loader reports no extension errors");
		summary.checks.actualPackageLoadOrder = { pass: true, extensionPaths: paths, dedupIndex: dedupPath, observationPackIndex: packPath };
		summary.checks.defaultActivationAndSchema = { pass: true, recallSchema: obsTool.parameters, active: runner.getActiveTools().includes("obs_recall"), errors: extensionsResult.errors.length };
		summary.checks.hashlinePreserved = { pass: true, readDescriptionHasDigestTag: readTool.description.includes("#TAG"), editDescriptionHasStaleRejection: /stale tags always fail/iu.test(editTool.description), hashlineExtensionPath: paths[hashlinePath] };

		// Drive the actual runner's context transformations in their registered order.
		const body = Array.from({ length: 1650 }, (_, i) => `fixture-${String(i).padStart(4, "0")} Ω café 漢字`).join("\n") + "\n";
		const source = readResult(body);
		await runner.emitContext([source]);
		await runner.emitContext([source]);
		const packed = await runner.emitContext([source]);
		const placeholder = packed[0].content[0]?.text ?? "";
		const id = placeholder.match(/id: (obs_[a-f0-9]{24})/u)?.[1];
		assert.ok(id, "third actual context projection should produce an ObservationPack placeholder");
		assert.ok(placeholder.includes("retrieve: call obs_recall"));
		summary.checks.contextPipelineAndRecallAvailability = { pass: true, loaderOrderUsed: true, sourceBytes: Buffer.byteLength(body), placeholderBytes: Buffer.byteLength(placeholder), transformedBytes: bytesOf(packed) };

		let offset = 0, reconstructed = "", pages = 0;
		while (true) {
			const result = await obsTool.execute("obs-reconcile", { id, offset }, undefined, undefined, runner.createContext());
			const page = result.content.find((block) => block.type === "text")?.text ?? "";
			reconstructed += page.split("\n").slice(2).join("\n");
			pages++;
			assert.ok(result.details.nextOffset > offset || result.details.eof, "recall paging advances or reaches EOF");
			offset = result.details.nextOffset;
			if (result.details.eof) break;
		}
		assert.equal(reconstructed, body, "real registered tool handler reconstructs exact UTF-8 fixture");
		summary.checks.exactRecallAndUtf8Paging = { pass: true, pages };

		const storageRoot = join(runner.createContext().sessionManager.getSessionDir(), "sol-pi", runner.createContext().sessionManager.getSessionId(), "observation-pack", "objects");
		const objectPath = join(storageRoot, `${id}.txt`);
		const original = await readFile(objectPath);
		await writeFile(objectPath, Buffer.concat([original.subarray(0, 12), Buffer.from("CORRUPTED"), original.subarray(21)]));
		let corruptionRejected = false;
		try { await obsTool.execute("obs-reconcile", { id }, undefined, undefined, runner.createContext()); }
		catch (error) { corruptionRejected = /hash mismatch/u.test(String(error?.message ?? error)); }
		await writeFile(objectPath, original);
		assert.ok(corruptionRejected, "corrupt archive is rejected by real registered tool handler");
		summary.checks.corruptionRejection = { pass: true };
	} finally { session.dispose(); }

	// Explicit exclusion is enforced by Pi's AgentSession API, not a hand-built tool list.
	const excludedResult = await createSession({ tools: ["read", "bash"] });
	try {
		const { session: excluded, extensionsResult } = excludedResult;
		const runner = excluded.extensionRunner;
		assert.equal(runner.getActiveTools().includes("obs_recall"), false);
		const original = "excluded-source-".repeat(1200);
		const projected = await runner.emitContext([readResult(original)]);
		assert.equal(projected[0].content[0].text, original);
		assert.equal(projected[0].content[0].text.includes("obs_"), false);
		assert.equal(extensionsResult.errors.length, 0);
		summary.checks.explicitToolExclusion = { pass: true, noInaccessiblePlaceholder: true, sourceBytes: Buffer.byteLength(original) };
	} finally { excludedResult.session.dispose(); }

	// Persist a branched transcript with Pi's APIs, navigate through AgentSession,
	// append to persist the selected leaf, then open it in a fresh SDK session.
	const manager = createSessionManager();
	const rootId = manager.appendMessage({ role: "user", content: [{ type: "text", text: "resume fixture root" }], timestamp: Date.now() });
	const assistantId = manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "resume fixture answer" }], api: "openai-completions", provider: "fixture", model: "no-inference", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }, stopReason: "stop", timestamp: Date.now() });
	manager.appendMessage({ role: "user", content: [{ type: "text", text: "abandoned branch fixture" }], timestamp: Date.now() });
	const lifecycle = await createSession({ manager });
	const lifecycleSession = lifecycle.session;
	const lifecycleRunner = lifecycleSession.extensionRunner;
	const lifecycleSource = readResult("branch-reset-fixture-".repeat(1200));
	await lifecycleRunner.emitContext([lifecycleSource]);
	await lifecycleRunner.emitContext([lifecycleSource]);
	const beforeNavigation = await lifecycleRunner.emitContext([lifecycleSource]);
	assert.match(beforeNavigation[0].content[0].text, /id: obs_/u);
	const nav = await lifecycleSession.navigateTree(assistantId, { summarize: false });
	assert.equal(nav.cancelled, false);
	manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "persisted selected branch" }], api: "openai-completions", provider: "fixture", model: "no-inference", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }, stopReason: "stop", timestamp: Date.now() });
	const afterNavigation = await lifecycleRunner.emitContext([lifecycleSource]);
	assert.equal(afterNavigation[0].content[0].text, lifecycleSource.content[0].text, "real tree navigation resets the ObservationPack send counter");
	const sessionFile = manager.getSessionFile();
	const sessionId = manager.getSessionId();
	lifecycleSession.dispose();
	const reopenedManager = SessionManager.open(sessionFile, sessionsDir, projectDir);
	const resumed = await createSession({ manager: reopenedManager });
	try {
		const branch = reopenedManager.getBranch().map((entry) => JSON.stringify(entry.message?.content ?? entry.content ?? ""));
		const transcript = branch.join(" ");
		assert.ok(transcript.includes("resume fixture root") && transcript.includes("persisted selected branch"));
		assert.equal(transcript.includes("abandoned branch fixture"), false, "resumed branch excludes abandoned transcript");
		assert.equal(reopenedManager.getSessionId(), sessionId);
		const resumedProjection = await resumed.session.extensionRunner.emitContext([lifecycleSource]);
		assert.equal(resumedProjection[0].content[0].text, lifecycleSource.content[0].text, "new process/session projection starts with full source");
		const { createHash } = await import("node:crypto");
		const sessionFileSha256 = createHash("sha256").update(await readFile(sessionFile)).digest("hex");
		summary.checks.realTreeNavigationAndTranscriptResume = { pass: true, sessionId, persistedBranchEntries: reopenedManager.getBranch().length, abandonedBranchExcluded: true, sessionFileSha256 };
	} finally { resumed.session.dispose(); }

	const receipt = JSON.stringify(summary, null, 2) + "\n";
	if (process.env.OBSPACK_RECEIPT_PATH) await writeFile(process.env.OBSPACK_RECEIPT_PATH, receipt);
	console.log(receipt);
} finally {
	if (process.env.KEEP_OBSPACK_RECONCILE_TMP !== "1") await rm(work, { recursive: true, force: true });
}
