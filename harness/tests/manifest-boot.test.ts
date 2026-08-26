// manifest-boot — boot the WHOLE declared extension manifest, in declared order,
// onto one fake pi, and assert the end state.
//
// Why this file exists: every interaction defect this harness has shipped was an
// unverified assumption about a NEIGHBOUR — session_start fires once (it does
// not; /reload re-emits), the live active set is pristine when read (an earlier
// extension already stripped it), closure state survives re-entry (it does not).
// None of them were findable by a suite that loads one extension per FakePi,
// which is what every other test here does. `loadExtensions` has been exported
// from integration-harness.ts for exactly this and had zero callers.
//
// Two boots are modelled, because they are genuinely different:
//   1. cold start   — factories invoked once, pristine active surface.
//   2. /reload      — pi re-invokes every default() factory against a FRESH api
//                     (loader.js:321 caches the FACTORY, :354-356 always calls
//                     createExtension + factory(api)), so closure state is wiped,
//                     while the tool registry is rebuilt from the ALREADY-NARROWED
//                     live set (agent-session.js:2030-2032).
// A boot helper that reused one FakePi would model neither.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureInitialToolSurface } from "../lib/session-bootstrap.ts";
import { callTool, fire, loadExtensions, makeCtx, makeFakePi, resetPiGlobals, type FakePi } from "./integration-harness.ts";

const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const MANIFEST: string[] = manifest.pi.extensions;

/** Manifest paths are repo-relative; this file is not. */
const specifiers = () => MANIFEST.map((entry) => entry.replace(/^harness\//, "../"));

// The vendored subagent imports siblings by their `.js` specifier (NodeNext style).
// `npm test` runs plain `node --experimental-strip-types`, which does not map those
// back to `.ts` — so booting the real manifest needs the resolver this repo already
// ships for exactly that, the same way subagent-hardening.test.ts registers it.
// Without it manifest entry 18 is the only one that cannot load, and the whole boot
// dies on it under the runner while passing under tsx.
const { register } = await import("node:module");
register(new URL("./ts-js-resolver.mjs", import.meta.url), import.meta.url);

// Pi's own builtin roster (verified against the installed package: bash, edit,
// find, grep, ls, read, write) plus the externally-provided `recall`, and the
// browser/canvas families a real deployment gets from its MCP servers — live
// telemetry shows 25 browser_* and 11 tldraw_* in the deferred set, so a boot
// test without them cannot exercise the families that actually carry tools.
//
// DEFAULT_INACTIVE is evidence-based, not guessed: grep/find/ls never appear in
// any live `tool-activation/deferred` row, and tool-activation.test.ts's own
// roster excludes them from its initial active set. `powershell` is here for the
// same reason it broke explicit-tool classification live on 2026-08-25 — a boot
// test that only ever sees ACTIVE builtins cannot see that shape at all.
const BUILTINS = [
	"read", "bash", "edit", "write", "grep", "find", "ls", "powershell", "recall",
	"browser_open", "browser_click", "browser_read",
	"tldraw_canvas_open", "tldraw_search",
];
const DEFAULT_INACTIVE = new Set(["powershell", "grep", "find", "ls"]);

/** A cwd Pi can detect a real gate in — otherwise verify-gate legitimately strips
 *  `verify_project` (it would throw "no exact project gate was detected"), and the
 *  boot models a project nobody would run this harness against. */
function projectCwd(): string {
	const cwd = mkdtempSync(join(tmpdir(), "pi-manifest-boot-cwd-"));
	writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "boot-fixture", scripts: { test: "true" } }));
	return cwd;
}

type Boot = { fp: FakePi; cwd: string; registered: string[]; baseline: string[]; active: string[]; deferred: string[] };

function activationState(): { deferred?: string[]; attempted?: string[]; reason?: string } {
	return ((globalThis as Record<string, unknown>).__pi_tool_activation_state ?? {}) as never;
}

/**
 * One boot of the full manifest. `carryActive` models /reload: pi rebuilds the
 * runtime from the surface the previous generation left behind, NOT from a
 * pristine one.
 */
async function boot(options: { cwd?: string; carryActive?: string[]; carryBus?: FakePi["busHandlers"] } = {}): Promise<Boot> {
	const cwd = options.cwd ?? projectCwd();
	const fp = makeFakePi({ busHandlers: options.carryBus });
	for (const name of BUILTINS) fp.pi.registerTool({ name, parameters: { type: "object" } } as never);
	await loadExtensions(fp, specifiers());

	const registered = fp.pi.getAllTools().map((tool) => String(tool.name));
	const baseline = options.carryActive ?? registered.filter((name) => !DEFAULT_INACTIVE.has(name));
	fp.pi.setActiveTools(baseline);
	captureInitialToolSurface(fp.pi as never);

	const { ctx } = makeCtx(cwd);
	await fire(fp, "session_start", { reason: options.carryActive ? "reload" : "new" }, ctx);
	return { fp, cwd, registered, baseline, active: [...fp.pi.getActiveTools()], deferred: activationState().deferred ?? [] };
}

function withEnv<T>(vars: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
	const prior = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
	for (const [key, value] of Object.entries(vars)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	const restore = () => {
		for (const [key, value] of Object.entries(prior)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		resetPiGlobals();
	};
	return run().then((value) => { restore(); return value; }, (error) => { restore(); throw error; });
}

const BASE_ENV = () => ({
	TELEMETRY: "off",
	PI_CODING_AGENT_DIR: mkdtempSync(join(tmpdir(), "pi-manifest-boot-agent-")),
	MUNCHKIN_TOOL_PROFILE: undefined as string | undefined,
	MUNCHKIN_TOOL_ACTIVATION: undefined as string | undefined,
});

// --- invariant 1: the manifest boots at all -------------------------------

test("every declared manifest extension loads in order without throwing", async () => {
	await withEnv(BASE_ENV(), async () => {
		const { fp } = await boot();
		assert.deepEqual(fp.swallowedErrors, [], "a session_start handler threw during a clean boot");
	});
});

test("no two extensions register the same tool name", async () => {
	await withEnv(BASE_ENV(), async () => {
		const fp = makeFakePi();
		const seen: string[] = [];
		const realRegister = fp.pi.registerTool;
		(fp.pi as { registerTool: (tool: { name: string }) => void }).registerTool = (tool) => {
			seen.push(String(tool.name));
			realRegister(tool as never);
		};
		await loadExtensions(fp, specifiers());
		// hashline deliberately SHADOWS pi's builtin read/edit (documented at
		// hashline.ts:130,205), so those two names are the sanctioned exception.
		const shadowed = new Set(["read", "edit"]);
		const duplicates = seen.filter((name, index) => seen.indexOf(name) !== index && !shadowed.has(name));
		assert.deepEqual(duplicates, [], "duplicate tool registration across the manifest");
	});
});

// --- invariant 2: nothing falls off the surface ---------------------------

test("cold boot: every tool the harness strips is recorded as deferred", async () => {
	await withEnv(BASE_ENV(), async () => {
		const { baseline, active, deferred } = await boot();
		// The baseline, not the registry: a tool Pi itself ships default-inactive was
		// never the harness's to strip, and `deferred` is specifically the record of
		// "absent because WE did it". Comparing against the registry would blame the
		// harness for Pi's own defaults.
		const accounted = new Set([...active, ...deferred]);
		const orphaned = baseline.filter((name) => !accounted.has(name));
		assert.deepEqual(
			orphaned, [],
			`stripped from the active surface but never recorded as deferred, so no capability call can reach them: ${orphaned.join(", ")}`,
		);
	});
});

// --- invariant 3: reload keeps the capability families alive --------------

test("/reload: a capability family still activates after the factories are re-invoked", async () => {
	await withEnv(BASE_ENV(), async () => {
		const cold = await boot();
		assert.ok(cold.deferred.includes("browser_open"), "precondition: browser tools deferred on a cold boot");

		// pi re-invokes every factory against a fresh api, rebuilding the runtime
		// from the narrowed surface the first generation left behind.
		const warm = await boot({ cwd: cold.cwd, carryActive: cold.active });
		const result = await callTool(warm.fp, "capability", { action: "enable", family: "browser" }, warm.cwd);
		const payload = JSON.parse(String(result.content[0]?.text ?? "{}"));
		assert.equal(
			payload.result?.status, "activated",
			"after /reload the deferred pool was lost, so every capability family is permanently dead",
		);
		assert.ok(warm.fp.pi.getActiveTools().includes("browser_open"), "browser tools did not reach the active surface");
	});
});

// --- invariant 4: every deferred tool has a route back --------------------

// The dark flags register FIVE more tools (plan_go, plan_expand, plan_settle,
// research_plan_start, branch_plan). Running the invariants only at defaults means
// a tool that exists solely behind a flag is never checked for a route back — which
// is precisely how `plan_go` came to be registered, stripped, and uncallable.
test("dark-flag boot: nothing a flag registers is stripped without a route", async () => {
	await withEnv({ ...BASE_ENV(), PLAN_TOOL_GO: "on", PLAN_GRAPH: "on" }, async () => {
		const { baseline, active, deferred } = await boot();
		const accounted = new Set([...active, ...deferred]);
		const orphaned = baseline.filter((name) => !accounted.has(name));
		assert.deepEqual(
			orphaned, [],
			`registered behind a flag, stripped at startup, and in no deferred pool — permanently uncallable: ${orphaned.join(", ")}`,
		);
	});
});

test("cold boot: every deferred tool is reachable through some capability family", async () => {
	await withEnv({ ...BASE_ENV(), PLAN_TOOL_GO: "on" }, async () => {
		const { fp, cwd, deferred } = await boot();
		const families = ["research", "delegation", "browser", "canvas", "context", "planning"] as const;
		const reachable = new Set<string>();
		for (const family of families) {
			await callTool(fp, "capability", { action: "enable", family }, cwd);
			for (const name of fp.pi.getActiveTools()) reachable.add(name);
		}
		const stranded = deferred.filter((name) => !reachable.has(name));
		assert.deepEqual(
			stranded, [],
			`deferred with no family route — registered, invisible, and permanently uncallable: ${stranded.join(", ")}`,
		);
	});
});

test("/reload: bus subscriptions do not accumulate across generations", async () => {
	await withEnv(BASE_ENV(), async () => {
		const cold = await boot();
		const channels = [...cold.fp.busHandlers.keys()];
		assert.ok(channels.length > 0, "precondition: the manifest subscribes to at least one channel");
		const before = new Map(channels.map((channel) => [channel, cold.fp.busHandlers.get(channel)!.size]));

		// Pi keeps ONE event bus for the process (resource-loader.js:120; `clear()` has
		// no callers) while re-invoking every factory, and all twelve subscribe sites
		// discard the unsubscribe the bus hands back. So each reload leaves the previous
		// generation's handlers attached — to a runtime that agent-session.js:551 has
		// invalidated, so every `pi.*` call they make now throws and event-bus.js
		// swallows it to console.error. Node's default maxListeners is 10 and nothing
		// raises it, so the FIRST reload already trips MaxListenersExceededWarning on
		// the domain-signal channel.
		const warm = await boot({ cwd: cold.cwd, carryActive: cold.active, carryBus: cold.fp.busHandlers });

		const grown = [...before].filter(([channel, count]) => (warm.fp.busHandlers.get(channel)?.size ?? 0) > count)
			.map(([channel, count]) => `${channel}: ${count} -> ${warm.fp.busHandlers.get(channel)?.size}`);
		assert.deepEqual(grown, [], `stale subscriptions survived the reload:\n${grown.join("\n")}`);
	});
});

test("a bound that lives in lib/plan-limits.ts is never re-typed as a literal", () => {
	// NOT a comparison of the schema against the constant — both now come from the same
	// import, so that version was circular and passed happily with the constant changed
	// to 901. The real failure mode is someone typing an OWNED number into a schema
	// instead of importing it, which is how nine copies of `900` accumulated across four
	// files and made the 2026-08-25 raise a nine-site manual edit.
	//
	// Only owned values are policed. `minItems: 1`, the 96-byte item id and the 200-byte
	// defer value/risk are bounds with no shared home, and inventing constants for them
	// would be worse than the literal. The VALUES are pinned behaviourally elsewhere
	// ("note bytes: 900 accepted, 901 rejected" in plan-runner.integration.test.ts);
	// this pins the SHAPE.
	const owned = new Map<number, string>([
		[900, "PLAN_NOTE_MAX_BYTES"], [120, "PLAN_TITLE_MAX_BYTES"],
		[24, "PLAN_MAX_ITEMS / PLAN_MAX_DELTAS"], [32768, "PLAN_STATE_MAX_BYTES"],
	]);
	const sources = ["../extensions/plan-runner.ts", "../lib/plan-delta.ts", "../lib/plan-graph.ts", "../lib/branch-report.ts"];
	const offenders: string[] = [];
	for (const relative of sources) {
		const source = readFileSync(new URL(relative, import.meta.url), "utf8")
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/^\s*\/\/.*$/gm, "");
		for (const match of source.matchAll(/\b(?:maxLength|maxItems)\s*:\s*(\d+)|boundedText\([^,]+,\s*(\d+)\)/g)) {
			const found = Number(match[1] ?? match[2]);
			const constant = owned.get(found);
			if (constant) offenders.push(`${relative}: ${match[0].trim()} — import ${constant}`);
		}
	}
	assert.deepEqual(offenders, [],
		`a bound with a home in lib/plan-limits.ts was re-typed as a literal:\n${offenders.join("\n")}`);
});
