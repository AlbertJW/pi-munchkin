import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { currentSessionId, record } from "../lib/telemetry.ts";
import { fire, makeFakePi } from "./integration-harness.ts";

test("session-bootstrap is the first declared manifest extension", () => {
	const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
	assert.equal(manifest.pi.extensions[0], "harness/extensions/session-bootstrap.ts");
});

function fixture(): { agentDir: string; cwd: string; extension: string } {
	const root = mkdtempSync(join(tmpdir(), "session-bootstrap-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	mkdirSync(join(agentDir, "extensions"), { recursive: true });
	mkdirSync(cwd, { recursive: true });
	const extension = join(agentDir, "extensions", "noop.ts");
	writeFileSync(extension, "export default function () {}\n");
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [] }));
	return { agentDir, cwd, extension };
}

function envScope(agentDir: string, file: string, source = "test") {
	const names = ["PI_CODING_AGENT_DIR", "TELEMETRY", "TELEMETRY_FILE", "TELEMETRY_SOURCE", "HARNESS_SURFACE_SHA256"];
	const prior = Object.fromEntries(names.map((name) => [name, process.env[name]]));
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.TELEMETRY_FILE = file;
	process.env.TELEMETRY_SOURCE = source;
	delete process.env.TELEMETRY;
	return () => {
		for (const [name, value] of Object.entries(prior)) {
			if (value === undefined) delete process.env[name]; else process.env[name] = value;
		}
	};
}

test("manifest-first bootstrap gives every session_start row one identity and non-null surface", async () => {
	const fx = fixture();
	const file = join(fx.agentDir, "events.jsonl");
	const restore = envScope(fx.agentDir, file);
	try {
		const fp = makeFakePi();
		const definitions = ["read", "bash", "edit", "write", "subagent", "compact_context"].map((name) => ({ name }));
		(fp.pi as any).getAllTools = () => definitions;
		(fp.pi as any).getActiveTools = () => definitions.map(({ name }) => name);
		const bootstrap = await import(`../extensions/session-bootstrap.ts?ordered=${Date.now()}-${Math.random()}`);
		bootstrap.default(fp.pi as never);
		(fp.pi as any).on("session_start", async () => {
			record("tool-activation", "preserved-explicit", { tool: "subagent", reason: "test" });
		});
		const runtime = await import(`../extensions/runtime-truth.ts?ordered=${Date.now()}-${Math.random()}`);
		runtime.default(fp.pi as never);
		(fp.pi as any).on("session_start", async () => {
			record("tool-activation", "preserved-explicit", { tool: "compact_context", reason: "test" });
		});
		await fire(fp, "session_start", { reason: "new" }, { cwd: fx.cwd });
		const rows = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		assert.equal(rows.length, 2);
		assert.equal(new Set(rows.map((row) => row.si)).size, 1);
		assert.ok(rows.every((row) => /^[a-f0-9]{64}$/.test(row.harness_surface_sha256)));
	} finally {
		restore();
		rmSync(join(fx.agentDir, ".."), { recursive: true, force: true });
	}
});

test("new, resume, fork, and reload rotate once; reload recomputes; shutdown retains identity", async () => {
	const fx = fixture();
	const file = join(fx.agentDir, "events.jsonl");
	const restore = envScope(fx.agentDir, file);
	try {
		const fp = makeFakePi();
		(fp.pi as any).getAllTools = () => [{ name: "read" }];
		(fp.pi as any).getActiveTools = () => ["read"];
		const bootstrap = await import(`../extensions/session-bootstrap.ts?rotate=${Date.now()}-${Math.random()}`);
		bootstrap.default(fp.pi as never);
		const identities: string[] = [];
		const hashes: string[] = [];
		for (const reason of ["new", "resume", "fork"] as const) {
			await fire(fp, "session_start", { reason }, { cwd: fx.cwd });
			identities.push(currentSessionId());
			hashes.push(process.env.HARNESS_SURFACE_SHA256 ?? "");
		}
		writeFileSync(fx.extension, "export default function changed() {}\n");
		await fire(fp, "session_start", { reason: "extension-reload" }, { cwd: fx.cwd });
		identities.push(currentSessionId());
		hashes.push(process.env.HARNESS_SURFACE_SHA256 ?? "");
		assert.equal(new Set(identities).size, 4, "one bootstrap mint per session generation");
		assert.equal(new Set(hashes.slice(0, 3)).size, 1, "unchanged surface stays stable across session types");
		assert.notEqual(hashes[3], hashes[2], "reload sees changed extension bytes");
		const ending = currentSessionId();
		(fp.pi as any).on("session_shutdown", async () => record("tool-activation", "preserved-explicit", { tool: "subagent", reason: "shutdown-test" }));
		await fire(fp, "session_shutdown", {}, { cwd: fx.cwd });
		const last = JSON.parse(readFileSync(file, "utf8").trim().split("\n").at(-1)!);
		assert.equal(last.si, ending, "shutdown emitters retain the ending session identity");
	} finally {
		restore();
		rmSync(join(fx.agentDir, ".."), { recursive: true, force: true });
	}
});

test("gate bootstrap preserves only a valid launcher receipt and failure is fixed/redacted", async () => {
	const fx = fixture();
	const file = join(fx.agentDir, "events.jsonl");
	const restore = envScope(fx.agentDir, file, "gate");
	try {
		const fp = makeFakePi();
		(fp.pi as any).getAllTools = () => [{ name: "read" }];
		(fp.pi as any).getActiveTools = () => ["read"];
		const bootstrap = await import(`../extensions/session-bootstrap.ts?gate=${Date.now()}-${Math.random()}`);
		bootstrap.default(fp.pi as never);
		process.env.HARNESS_SURFACE_SHA256 = "f".repeat(64);
		await fire(fp, "session_start", {}, { cwd: fx.cwd });
		assert.equal(process.env.HARNESS_SURFACE_SHA256, "f".repeat(64));
		process.env.HARNESS_SURFACE_SHA256 = "stale-invalid-value";
		await fire(fp, "session_start", {}, { cwd: fx.cwd });
		assert.equal(process.env.HARNESS_SURFACE_SHA256, undefined);
		const last = JSON.parse(readFileSync(file, "utf8").trim().split("\n").at(-1)!);
		assert.deepEqual({ ext: last.ext, kind: last.kind, reason: last.reason }, {
			ext: "session-bootstrap", kind: "surface-unavailable", reason: "surface_unavailable",
		});
		assert.equal(JSON.stringify(last).includes("stale-invalid-value"), false);
	} finally {
		restore();
		rmSync(join(fx.agentDir, ".."), { recursive: true, force: true });
	}
});
