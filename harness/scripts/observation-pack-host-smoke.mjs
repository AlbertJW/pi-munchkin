#!/usr/bin/env node
// Actual Pi 0.87.1 RPC host smoke for the installed SoL-Pi ObservationPack.
// Uses only temporary agent/session/project directories and direct extension
// tool invocation from an RPC slash command; it never sends a model request.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const solPi = process.env.SOL_PI_REPO ?? "/Users/Albert.Wessels/.pi/agent/git/github.com/NVlabs/SoL-Pi";
const piBinary = process.env.PI_BINARY ?? execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
const work = await mkdtemp(join(tmpdir(), "observation-pack-host-"));
const agentDir = join(work, "agent");
const projectDir = join(work, "project");
const sessionsDir = join(work, "sessions");
const probePath = join(work, "host-probe.ts");
const selectedRuntimeFiles = [
	"harness/extensions/tool-activation.ts",
];
await Promise.all([mkdir(agentDir), mkdir(projectDir), mkdir(sessionsDir)]);
await writeFile(join(agentDir, "settings.json"), "{}\n");
await writeFile(join(agentDir, "sol-pi.json"), JSON.stringify({
	version: 1,
	actionFusion: false,
	observationPack: true,
	evidencePreservingReducer: false,
	onlineContextCompact: false,
	cacheWriteReadRatio: 12.5,
}, null, 2) + "\n");

const probeSource = `
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import dedupExtension from ${JSON.stringify(join(repo, "harness/extensions/context-dedup.ts"))};
import solPiExtension from ${JSON.stringify(join(solPi, "src/sol-pi/index.ts"))};
const reportPath = process.env.OBS_HOST_REPORT;
export default function(pi) {
  const tools = new Map();
  const handlers = new Map();
  const registrations = [];
  const registerTool = pi.registerTool.bind(pi);
  pi.registerTool = (tool) => { tools.set(tool.name, tool); return registerTool(tool); };
  const on = pi.on.bind(pi);
  pi.on = (event, handler) => {
    registrations.push(event);
    if (!handlers.has(event)) handlers.set(event, []);
    handlers.get(event).push(handler);
    return on(event, handler);
  };
  on("session_start", () => { globalThis.__obsPackWasAbsentBeforeItsRegistration = !pi.getAllTools().some((item) => item.name === "obs_recall"); });
  dedupExtension(pi);
  solPiExtension(pi);
  const active = () => pi.getActiveTools();
  const ctxEvents = () => handlers.get("context") ?? [];
  const runContext = async (messages, ctx) => {
    let current = messages;
    for (const handler of ctxEvents()) {
      const result = await handler({ type: "context", messages: current }, ctx);
      if (result?.messages) current = result.messages;
    }
    return current;
  };
  const readResult = (text, toolName = "fixture", toolCallId = "call-1") => ({
    role: "toolResult", toolName, toolCallId, isError: false, timestamp: Date.now(),
    content: [{ type: "text", text }],
  });
  const executeRecall = async (ctx, id, offset = 0) => {
    const tool = tools.get("obs_recall");
    if (!tool) throw new Error("obs_recall definition was not captured from the installed extension");
    return await tool.execute("host-smoke", { id, offset }, undefined, undefined, ctx);
  };
  const recallText = (result) => result.content.find((block) => block.type === "text")?.text ?? "";
  const pageBody = (result) => recallText(result).split("\\n").slice(2).join("\\n");
  pi.registerCommand("observation-host-check", {
    description: "zero-inference installed ObservationPack host check",
    handler: async (args, ctx) => {
      const [mode, priorId] = args.trim().split(/\\s+/u);
      const registered = pi.getAllTools().find((tool) => tool.name === "obs_recall");
      const tool = tools.get("obs_recall");
      const report = {
        host: "Pi RPC 0.87.1", mode, registered: Boolean(registered), active: active().includes("obs_recall"),
        absentBeforePackageSessionStartRegistration: globalThis.__obsPackWasAbsentBeforeItsRegistration === true,
        schema: registered?.parameters, description: registered?.description,
        capturedExecute: typeof tool?.execute === "function", contextHandlerCount: ctxEvents().length,
        contextHandlerRegistrationOrder: registrations.filter((event) => event === "context"),
        sessionId: ctx.sessionManager.getSessionId(), sessionFile: ctx.sessionManager.getSessionFile(),
        contextUsageBeforeProvider: ctx.getContextUsage?.() ?? null,
      };

      if (mode === "excluded") {
        assert.equal(report.active, false);
        const source = readResult("x".repeat(12_000));
        const projected = await runContext([source], ctx);
        assert.equal(projected[0].content[0].text, source.content[0].text, "excluded recall must leave full source accessible");
        assert.equal(projected[0].content[0].text.includes("obs_"), false, "no inaccessible placeholder");
        report.fullResultPreserved = true;
        report.noPlaceholder = true;
      } else if (mode === "resume") {
        assert.equal(report.registered, true);
        const result = await executeRecall(ctx, priorId);
        report.recalledAfterResume = true;
        report.recallHeader = recallText(result).split("\\n").slice(0, 2);
      } else if (mode === "isolation") {
        let message = "";
        try { await executeRecall(ctx, priorId); } catch (error) { message = String(error?.message ?? error); }
        assert.match(message, /Unknown observation id/u);
        report.otherSessionRejectedId = true;
        report.error = message;
      } else if (mode === "default") {
        assert.equal(report.registered, true);
        assert.equal(report.active, true, "late-registered obs_recall should be activated on the default surface");
        assert.equal(report.absentBeforePackageSessionStartRegistration, true, "test must exercise registration after harness startup snapshot");
        assert.equal(report.capturedExecute, true);
        assert.equal(ctxEvents().length, 2, "dedup and installed pack handlers must both be present");
        assert.deepEqual(registered.parameters, {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", description: "Observation id from a placeholder" },
            offset: { type: "integer", minimum: 0, description: "Byte offset, default 0" },
          },
        });
        report.schemaMatchesExpected = true;

        const text = Array.from({ length: 1_650 }, (_, index) => "row-" + index.toString().padStart(4, "0") + " Ω café 漢字").join("\\n") + "\\n";
        const source = readResult(text);
        await runContext([source], ctx);
        await runContext([source], ctx);
        const packed = await runContext([source], ctx);
        const placeholder = packed[0].content[0].text;
        assert.match(placeholder, /id: (obs_[a-f0-9]{24})/u);
        const id = placeholder.match(/id: (obs_[a-f0-9]{24})/u)[1];
        assert.match(placeholder, /retrieve: call obs_recall/u);
        report.id = id;
        report.placeholderBytes = Buffer.byteLength(placeholder, "utf8");
        report.originalBytes = Buffer.byteLength(text, "utf8");
        report.packedAfterTwoFullSends = true;

        let offset = 0;
        let reconstructed = "";
        let pageCount = 0;
        while (true) {
          const page = await executeRecall(ctx, id, offset);
          const body = pageBody(page);
          reconstructed += body;
          pageCount += 1;
          const details = page.details;
          assert.ok(details.nextOffset > offset || details.eof, "paging must advance or reach EOF");
          offset = details.nextOffset;
          if (details.eof) break;
        }
        assert.equal(reconstructed, text, "all UTF-8 recall pages must reconstruct exact original text");
        report.exactRecall = true;
        report.utf8Paging = true;
        report.pageCount = pageCount;

        const first = await executeRecall(ctx, id);
        const firstOffset = first.details.nextOffset;
        assert.ok(firstOffset > 0 && firstOffset < Buffer.byteLength(text));
        let boundaryRejected = false;
        for (let delta = 1; delta < 5 && !boundaryRejected; delta += 1) {
          try { await executeRecall(ctx, id, firstOffset - delta); } catch (error) {
            boundaryRejected = /inside a UTF-8 character/u.test(String(error?.message ?? error));
          }
        }
        report.utf8InteriorOffsetRejected = boundaryRejected;

        const disabled = active().filter((name) => name !== "obs_recall");
        pi.setActiveTools(disabled);
        const whileDisabled = await runContext([source], ctx);
        assert.equal(whileDisabled[0].content[0].text, text, "manual deactivation must disable packing before placeholders are emitted");
        report.manualDeactivationPreservesSource = true;
        pi.setActiveTools([...disabled, "obs_recall"]);

        const beforeTree = handlers.get("session_before_tree") ?? [];
        assert.equal(beforeTree.length, 1);
        for (const handler of beforeTree) await handler({ type: "session_before_tree" }, ctx);
        const rewound = await runContext([source], ctx);
        assert.equal(rewound[0].content[0].text, text, "rewind must reset the in-memory send counter");
        report.branchRewindReset = true;

        const readText = "read bytes Ω\\n".repeat(1_200);
        const repeatedReads = [
          { role: "assistant", content: [{ type: "toolCall", id: "read-a", name: "read", arguments: { path: "/fixture" } }] },
          readResult(readText, "read", "read-a"),
          { role: "assistant", content: [{ type: "toolCall", id: "read-b", name: "read", arguments: { path: "/fixture" } }] },
          readResult(readText, "read", "read-b"),
        ];
        await runContext(repeatedReads, ctx);
        const dedupPacked = await runContext(repeatedReads, ctx);
        assert.match(dedupPacked[1].content[0].text, /large tool result replaced/u);
		assert.match(dedupPacked[3].content[0].text, /identical to the result/u);
        assert.match(dedupPacked[3].content[0].text, /message #1/u);
        report.dedupPrecedesPacking = true;
        report.dedupReferenceStillTargetsPackedOriginal = true;
        report.dedupPackedBytes = dedupPacked.reduce((n, m) => n + Buffer.byteLength(JSON.stringify(m)), 0);

        const root = join(ctx.sessionManager.getSessionDir(), "sol-pi", ctx.sessionManager.getSessionId(), "observation-pack", "objects");
        const objectPath = join(root, id + ".txt");
        const saved = await readFile(objectPath);
        await writeFile(objectPath, Buffer.concat([saved.subarray(0, 12), Buffer.from("CORRUPTED"), saved.subarray(21)]));
        let corruptionRejected = false;
        try { await executeRecall(ctx, id); } catch (error) { corruptionRejected = /hash mismatch/u.test(String(error?.message ?? error)); }
        assert.equal(corruptionRejected, true);
        report.corruptionRejected = true;
        await writeFile(objectPath, saved);

        report.rawContextBytes = Buffer.byteLength(JSON.stringify([source]));
        report.transformedContextBytes = Buffer.byteLength(JSON.stringify(packed));
        report.finalProviderAccounting = "not invoked: zero-inference constraint; Pi usage before provider request is recorded separately";
      } else {
        throw new Error("unknown host smoke mode " + mode);
      }
      if (mode === "default") pi.appendEntry("obs-host-smoke", { id: report.id });
      await import("node:fs/promises").then((fs) => fs.writeFile(reportPath, JSON.stringify(report, null, 2)));
    },
  });
}
`;
await writeFile(probePath, probeSource);

async function runHost(mode, { excluded = false, sessionId, id } = {}) {
	const reportPath = join(work, `report-${mode}-${Date.now()}.json`);
	const args = ["--mode", "rpc", "--offline", "--no-context-files", "--no-skills", "--no-themes", "--no-prompt-templates", "--session-dir", sessionsDir];
	if (sessionId) args.push("--session-id", sessionId);
	if (excluded) args.push("--tools", "read,bash");
	for (const file of selectedRuntimeFiles) args.push("--extension", join(repo, file));
	args.push("--extension", probePath);
	const child = spawn(piBinary, args, {
		cwd: projectDir,
		env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", OBS_HOST_REPORT: reportPath, TELEMETRY: "off" },
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
	child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
	try {
		await new Promise((resolveReady, rejectReady) => {
			const timer = setTimeout(() => rejectReady(new Error(`Pi host did not become ready. stderr=${stderr}`)), 15_000);
			const poll = async () => {
				try {
					if (child.exitCode !== null) throw new Error(`Pi exited early (${child.exitCode}). stderr=${stderr}`);
					child.stdin.write(JSON.stringify({ id: "ready", type: "get_commands" }) + "\n");
					await new Promise((resolve) => setTimeout(resolve, 300));
					if (stdout.includes('"id":"ready"')) { clearTimeout(timer); resolveReady(); return; }
					setTimeout(poll, 100);
				} catch (error) { clearTimeout(timer); rejectReady(error); }
			};
			void poll();
		});
		child.stdin.write(JSON.stringify({ id: "materialize-session", type: "bash", command: "true" }) + "\n");
		const bashDeadline = Date.now() + 10_000;
		while (Date.now() < bashDeadline && !stdout.includes('"id":"materialize-session"')) {
			if (child.exitCode !== null) break;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		if (!stdout.includes('"id":"materialize-session"')) throw new Error(`Pi could not materialize an isolated session with a no-op command. stdout=${stdout}\nstderr=${stderr}`);
		child.stdin.write(JSON.stringify({ id: `run-${mode}`, type: "prompt", message: `/observation-host-check ${mode}${id ? ` ${id}` : ""}` }) + "\n");
		const deadline = Date.now() + 15_000;
		while (Date.now() < deadline) {
			try {
				if (stdout.includes('"type":"extension_error"')) throw new Error(`Pi extension error: ${stdout}`);
				return JSON.parse(await readFile(reportPath, "utf8"));
			} catch (error) { if (error instanceof Error && error.message.startsWith("Pi extension error:")) throw error; }
			if (child.exitCode !== null) break;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		throw new Error(`Pi host command did not produce a report. stdout=${stdout}\nstderr=${stderr}`);
	} finally {
		child.kill("SIGTERM");
		await new Promise((resolve) => {
			const timer = setTimeout(resolve, 1_000);
			child.once("exit", () => { clearTimeout(timer); resolve(); });
		});
	}
}

try {
	const initial = await runHost("default");
	assert.equal(initial.registered, true);
	assert.equal(initial.active, true);
	assert.equal(initial.absentBeforePackageSessionStartRegistration, true);
	assert.equal(initial.schemaMatchesExpected, true);
	assert.equal(initial.packedAfterTwoFullSends, true);
	assert.equal(initial.exactRecall, true);
	assert.equal(initial.corruptionRejected, true);
	assert.equal(initial.branchRewindReset, true);
	assert.equal(initial.manualDeactivationPreservesSource, true);
	assert.equal(initial.dedupPrecedesPacking, true);
	const resumed = await runHost("resume", { sessionId: initial.sessionId, id: initial.id });
	assert.equal(resumed.recalledAfterResume, true);
	assert.equal(resumed.sessionId, initial.sessionId, "fresh Pi process must reopen the same session identity");
	const isolated = await runHost("isolation", { id: initial.id });
	assert.equal(isolated.otherSessionRejectedId, true);
	const excluded = await runHost("excluded", { excluded: true });
	assert.equal(excluded.active, false);
	console.log(JSON.stringify({ work, initial, resumed, isolated, excluded }, null, 2));
} finally {
	if (process.env.KEEP_OBS_HOST_TMP !== "1") await rm(work, { recursive: true, force: true });
}
