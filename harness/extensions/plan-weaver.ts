// plan-weaver (plan-runner v4, shipped DARK alongside v3) — verification-aware plan
// compiler + ENGINE-OWNED subagent dispatch.
//
// v3 (plan-runner) is a model-owned TODO list whose "orchestration" is injected prose.
// v4 inverts ownership: the model authors a typed plan ONCE (plan_compile), then the
// EXTENSION walks the DAG — explore/execute/verify items run in FRESH child pi
// processes (the vendored subagent spawn pattern) briefed with ONLY their item's
// inputs/deliverable/gate; the engine runs every gate itself and never trusts a
// child's "done". Failure ladder per item: gate fail 1 -> c18b locality retry in the
// SAME child; fail 2 -> FRESH child (dumb-zone escape); fail 3 -> blocked. Inline
// items are handed back to the main loop in ONE final brief (plan-once economics:
// the parent window never sees execution noise).
//
// Why engine-owned is safe now when v2's wasn't: v2 re-injected prompts into the SAME
// context (fighting the model); v4 dispatches to fresh processes and the main context
// only receives one distilled line per item.
//
// Coexistence: /weave & /weave-go & weave_compile are all NEW names — zero collision
// with plan-runner. Shares the flag bus: sets __pi_plan_phase_active while compiling
// (mutation block is plan-runner's; we only signal), __pi_gate_green on green gates.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Type } from "typebox";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { assertVerifyGateAllowed } from "../lib/command-policy.ts";
import { gateEnvironment, runReadonlyGate } from "../lib/gate-runtime.ts";
import {
	compilePlan, localityBrief, nextReady, normalizeInput, parseChildResult, stalled,
	type WeaveItem, type WeavePlan,
} from "../lib/plan-contract.ts";
import { steerText } from "../lib/steer-texts.ts";
import { record } from "../lib/telemetry.ts";

// PLAN_MODE=v4: gate mode — auto-engage at agent start, auto-dispatch on compile
// (headless sessions have no slash commands). Dark unless a config sets it.
const GATE_MODE = process.env.PLAN_MODE === "v4";
const GATE_TIMEOUT_MS = Number.parseInt(process.env.WEAVE_GATE_TIMEOUT_MS || "60000", 10);
const CHILD_TIMEOUT_S = Number.parseInt(process.env.WEAVE_CHILD_TIMEOUT_S || "600", 10);
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");

// role -> agent definition + tool palette (mirrors agents/*.md frontmatter)
const ROLES: Record<string, { file: string; tools: string }> = {
	explore: { file: "explorer.md", tools: "read,grep,find,ls" },
	execute: { file: "executor.md", tools: "read,edit,write,bash" },
	verify: { file: "verifier.md", tools: "read,grep,find,ls,bash" },
};

let plan: WeavePlan | null = null;
let compiling = false;

const statePath = (cwd: string) => join(cwd, ".pi", "weave-state.json");

async function save(cwd: string): Promise<void> {
	if (!plan) return;
	plan.updated_at = new Date().toISOString();
	await mkdir(join(cwd, ".pi"), { recursive: true });
	await writeFile(statePath(cwd), JSON.stringify(plan, null, 2));
}

async function loadExisting(cwd: string): Promise<WeavePlan | null> {
	try { return JSON.parse(await readFile(statePath(cwd), "utf8")) as WeavePlan; } catch { return null; }
}

function agentPromptPath(role: string): string | null {
	const p = join(AGENT_DIR, "agents", ROLES[role].file);
	return existsSync(p) ? p : null;
}

/** Brief a child with ONLY its item's scope. Stateful retries append via `extra`. */
function childBrief(cwd: string, it: WeaveItem, extra?: string): string {
	const inputs = it.inputs.map((p) => normalizeInput(cwd, p));
	return [
		`Task: ${it.title}`,
		it.deliverable ? `Deliverable: ${it.deliverable}` : "",
		inputs.length ? `Relevant files (relative to cwd): ${inputs.join(", ")}` : "",
		it.gate ? `Acceptance check (run it yourself before reporting): ${it.gate}` : "",
		"Work only in the current directory.",
		extra ?? "",
	].filter(Boolean).join("\n");
}

type Exec = ExtensionAPI["exec"];

/** One child run (fresh pi process, vendored subagent arg pattern). Returns final text. */
async function runChild(exec: Exec, cwd: string, role: string, brief: string):
	Promise<{ ok: boolean; text: string }> {
	const prompt = agentPromptPath(role);
	// --approve: children run in throwaway/workdir cwds that pi does not trust; without
	// it a headless child hangs on the trust gate until timeout (live smoke, 2026-07-17).
	const args = ["-p", "--approve", "--no-session", "--tools", ROLES[role].tools];
	if (prompt) args.push("--append-system-prompt", prompt);
	args.push(brief);
	// exec </dev/null: pi -p waits forever on an OPEN stdin pipe (measured: open pipe
	// = infinite hang, closed = 25s reply). Whatever stdio the host exec uses, the
	// shell-level redirect guarantees a closed stdin. "$@" passes the brief unquoted.
	// PI_OFFLINE=1 matches the vendored subagent runner.
	try {
		const r = await exec("/usr/bin/env", ["-i", ...gateEnvironment(), "PI_OFFLINE=1", "bash", "--noprofile", "--norc", "-c",
			'exec </dev/null; exec pi "$@"', "bash", ...args], { cwd, timeout: CHILD_TIMEOUT_S * 1000 });
		const text = (r.stdout || "").trim() || (r.stderr || "").trim();
		if (r.code !== 0 || r.killed) {
			return { ok: false, text: text || (r.killed ? `child timed out after ${CHILD_TIMEOUT_S}s` : `child exited ${r.code}`) };
		}
		return { ok: true, text };
	} catch (err) {
		return { ok: false, text: `child execution failed: ${err instanceof Error ? err.message : String(err)}` };
	}
}

/** Engine-side gate run — read-only enforced, never trusts the child. */
async function runGate(exec: Exec, cwd: string, gate: string):
	Promise<{ pass: boolean; output: string }> {
	return runReadonlyGate(exec, cwd, gate, GATE_TIMEOUT_MS);
}

/** Dispatch ONE item through the failure ladder. Mutates item status/rung. */
async function dispatchItem(exec: Exec, cwd: string, it: WeaveItem): Promise<string> {
	it.status = "running";
	record("plan-weaver", "dispatch", { id: it.id, mode: it.mode, rung: it.ladder_rung });

	let child = await runChild(exec, cwd, it.mode, childBrief(cwd, it));
	let parsed = parseChildResult(child.text);

	// explore/verify have no gate: the parsed contract IS the outcome.
	if (!it.gate) {
		it.status = child.ok && parsed.result === "done" ? "done" : "blocked";
		it.note = child.ok ? parsed.line : `child failed: ${child.text.slice(-300)}`;
		record("plan-weaver", "gate", { id: it.id, pass: it.status === "done", gated: false });
		return `${it.id} ${it.status}: ${parsed.line}`;
	}

	// execute: the child result and engine gate are BOTH required. A timeout,
	// signal, non-zero exit, or RESULT: blocked consumes a ladder attempt and can
	// never be laundered into success by stale workspace state.
	for (;;) {
		const childSucceeded = child.ok && parsed.result === "done";
		const gate = childSucceeded
			? await runGate(exec, cwd, it.gate)
			: { pass: false, output: child.ok ? parsed.line : `child failed: ${child.text}` };
		record("plan-weaver", "gate", { id: it.id, pass: gate.pass, fails: it.gate_fails, gated: true });
		if (gate.pass) {
			it.status = "done";
			it.gate_fails = 0;
			(globalThis as Record<string, unknown>).__pi_gate_green = true; // verify-gate handshake
			return `${it.id} done (gate green): ${parsed.line}`;
		}
		it.gate_fails += 1;
		record("plan-weaver", "ladder", { id: it.id, rung: it.ladder_rung + 1, fails: it.gate_fails });
		if (it.ladder_rung === 0) {
			// rung 1 — c18b locality retry: same role, brief embeds the failing output.
			it.ladder_rung = 1;
			child = await runChild(exec, cwd, it.mode, childBrief(cwd, it, localityBrief(it.gate, gate.output)));
			parsed = parseChildResult(child.text);
		} else if (it.ladder_rung === 1) {
			// rung 2 — fresh child, fresh framing (c18: a poisoned context can't rescue itself).
			it.ladder_rung = 2;
			child = await runChild(exec, cwd, it.mode, childBrief(cwd, it,
				"A previous attempt left partial work in this directory. Inspect the current state first, then take a DIFFERENT approach to whatever kept failing."));
			parsed = parseChildResult(child.text);
		} else {
			// rung 3 — blocked; the main model gets a bounded replan request in the handoff.
			it.ladder_rung = 3;
			it.status = "blocked";
			it.note = `attempt failed x${it.gate_fails}; last child: ${child.ok ? parsed.line : child.text.slice(-200)}; check tail: ${gate.output.slice(-300)}`;
			return `${it.id} BLOCKED after ladder: ${it.note.slice(0, 160)}`;
		}
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerTool(
		defineTool({
			name: "weave_compile",
			label: "Weave compile",
			description:
				"Compile the FULL plan for the current /weave request in ONE call. Items: " +
				"{id?, title, mode(inline|explore|execute|verify), inputs[](files needed), " +
				"deliverable(one line, required unless inline), gate(read-only check command, " +
				"REQUIRED for execute), depends_on[]}. execute = isolated scoped edit; " +
				"explore = read-only lookup; verify = adversarial check; inline = needs main-context judgment.",
			parameters: Type.Object({
				items: Type.Array(Type.Object({
					id: Type.Optional(Type.String()),
					title: Type.String(),
					mode: Type.Optional(Type.String()),
					inputs: Type.Optional(Type.Array(Type.String())),
					deliverable: Type.Optional(Type.String()),
					gate: Type.Optional(Type.String()),
					depends_on: Type.Optional(Type.Array(Type.String())),
				})),
			}),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				if (!compiling || !plan) {
					return { content: [{ type: "text" as const, text: "No /weave in progress — run /weave <request> first." }], details: {}, isError: true };
				}
				// gates must be read-only BEFORE compile accepts them
				for (const it of params.items ?? []) {
					if (it.gate) {
						const allowed = assertVerifyGateAllowed(it.gate);
						if (!allowed.ok) return { content: [{ type: "text" as const, text: `item ${it.id ?? it.title}: gate rejected (${allowed.reason}) — gates must be read-only checks.` }], details: {}, isError: true };
					}
				}
				const out = compilePlan(params, plan.request, new Date().toISOString());
				if (!out.ok) {
					record("plan-weaver", "compile-rejected", { errors: out.errors.length });
					return {
						content: [{ type: "text" as const, text:
							"Plan rejected:\n- " + out.errors.join("\n- ") +
							'\n\nWorked example item: {"id":"s1","title":"add toCSV quoting","mode":"execute","inputs":["src/index.js"],"deliverable":"toCSV quotes fields containing commas","gate":"node --test","depends_on":[]}' }],
						details: {},
						isError: true,
					};
				}
				plan = out.plan;
				compiling = false;
				(globalThis as Record<string, unknown>).__pi_plan_phase_active = false;
				await save(ctx.cwd);
				record("plan-weaver", "plan-compiled", { items: plan.items.length,
					dispatched: plan.items.filter((i) => i.mode !== "inline").length });
				const lines = plan.items.map((i) => `  ${i.id} [${i.mode}] ${i.title}${i.gate ? ` (gate: ${i.gate})` : ""}`);
				if (GATE_MODE) {
					// headless: no /weave-go exists — dispatch NOW, hand back in the tool result
					const handoff = await dispatchAll({ cwd: ctx.cwd });
					return { content: [{ type: "text" as const, text: `Plan compiled (${plan.items.length} items):\n${lines.join("\n")}\n\n${handoff}` }], details: {} };
				}
				return { content: [{ type: "text" as const, text: `Plan compiled (${plan.items.length} items):\n${lines.join("\n")}\nSTOP — wait for /weave-go.` }], details: {} };
			},
		}),
	);

	pi.registerCommand("weave", {
		description: "plan-weaver v4: author a verification-aware plan (then /weave-go)",
		handler: async (args, ctx) => {
			const request = String(args ?? "").trim();
			if (!request) { ctx.ui.notify("/weave <request>", "warning"); return; }
			plan = { schema_version: 1, request, created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(), phase: "compiled", items: [] };
			compiling = true;
			(globalThis as Record<string, unknown>).__pi_plan_phase_active = true;
			await save(ctx.cwd);
			pi.sendUserMessage(steerText("WEAVE_PLAN_MSG",
				"MODE: PLAN. Design the full plan for the request below and submit it in ONE weave_compile call. " +
				"Decompose into 2-8 items; every edit is an `execute` item with a read-only gate; lookups are `explore`; " +
				"final acceptance is a `verify` item; use `inline` ONLY where main-context judgment is unavoidable. " +
				"Do not edit anything now. If anything essential is ambiguous, ASK the user in plain text and wait — " +
				"never park a question inside a plan item; the user does not read plan state.\n\nRequest: {request}", { request }));
		},
	});

	// Engine-owned dispatch, shared by /weave-go (interactive) and gate mode
	// (PLAN_MODE=v4 auto-dispatch). Returns the handoff text.
	async function dispatchAll(ctx: { cwd: string; ui?: { notify(m: string, l?: string): void } }): Promise<string> {
		if (!plan) throw new Error("no plan");
		plan.phase = "dispatching";
		const log: string[] = [];
		for (;;) {
			const it = nextReady(plan);
			if (!it) break;
			if (it.mode === "inline") { it.status = "blocked"; it.note = "inline — handed to main loop"; continue; }
			const line = await dispatchItem(pi.exec.bind(pi), ctx.cwd, it);
			log.push(line);
			await save(ctx.cwd);
			ctx.ui?.notify(`weave: ${line.slice(0, 100)}`, it.status === "done" ? "info" : "warning");
		}
		// hand back: one distilled message — results, blocked items needing a bounded
		// replan, and any inline items for main-context judgment.
		const inline = plan.items.filter((i) => i.note === "inline — handed to main loop");
		for (const i of inline) { i.status = "pending"; i.note = undefined; } // they're the model's now
		const blocked = plan.items.filter((i) => i.status === "blocked");
		plan.phase = stalled(plan) || blocked.length || inline.length ? "handed_off" : "done";
		await save(ctx.cwd);
		record("plan-weaver", "done", { done: plan.items.filter((i) => i.status === "done").length,
			blocked: blocked.length, inline: inline.length });
		const logText = log.length ? "Dispatched items:\n" + log.map((l) => "- " + l).join("\n") : "(no dispatched items)";
		const msg = plan.phase === "done"
			// everything done: demand ONE self-contained final report — findings live
			// scattered in child results the user never sees.
			? steerText("WEAVE_HANDOFF_DONE_MSG",
				"MODE: RUN. All plan items are done.\n{log}\nIn your reply NOW, restate the complete results — every finding, analysis, and deliverable in full, as one self-contained report. The user does not read plan state or earlier tool output; anything not in this reply is lost.",
				{ log: logText })
			: steerText("WEAVE_HANDOFF_MSG",
				"MODE: RUN. Dispatch finished.\n{log}\n{blocked}{inline}Finish the remaining work; for a BLOCKED item propose ONE bounded fix for that item only (do not rewrite the plan). When everything is done, end with one self-contained report of all findings and deliverables.",
				{
					log: logText,
					blocked: blocked.length ? "BLOCKED:\n" + blocked.map((b) => `- ${b.id}: ${b.note}`).join("\n") + "\n" : "",
					inline: inline.length ? "Inline items for you:\n" + inline.map((i) => `- ${i.id}: ${i.title}${i.gate ? ` (gate: ${i.gate})` : ""}`).join("\n") + "\n" : "",
				});
		record("plan-weaver", "handoff", { injected_chars: msg.length });
		return msg;
	}

	pi.registerCommand("weave-go", {
		description: "dispatch the compiled weave plan (engine-owned)",
		handler: async (_args, ctx) => {
			if (!plan || plan.items.length === 0) plan = await loadExisting(ctx.cwd);
			if (!plan || plan.items.length === 0) { ctx.ui.notify("no compiled weave plan", "warning"); return; }
			pi.sendUserMessage(await dispatchAll(ctx));
		},
	});

	// GATE MODE (PLAN_MODE=v4, dark otherwise): headless sessions have no slash
	// commands, so v4 auto-engages — the planning prompt is injected at agent
	// start (referencing the task ABOVE it), and a successful weave_compile
	// dispatches immediately instead of waiting for /weave-go. This is what
	// makes the weaver A/B-able in the gate (c22): PLAN_MODE flows in as a
	// config threshold like every other candidate dimension.
	if (GATE_MODE) {
		let engaged = false;
		pi.on("agent_start", async (_event, ctx) => {
			if (engaged) return;
			engaged = true;
			plan = { schema_version: 1, request: "(gate task — see the task message above)",
				created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
				phase: "compiled", items: [] };
			compiling = true;
			// arm the shared plan-phase flag (as /weave does): plan-runner's mutation
			// block + the loop-breaker/verify-gate planning suppressions all read it —
			// without this a gate-mode model can edit BEFORE compiling, unblocked.
			(globalThis as Record<string, unknown>).__pi_plan_phase_active = true;
			await save(ctx.cwd);
			pi.sendUserMessage(steerText("WEAVE_GATE_PLAN_MSG",
				"MODE: PLAN. Design the full plan for the TASK ABOVE and submit it in ONE weave_compile call. " +
				"Decompose into 2-6 items; every edit is an `execute` item with a read-only gate (e.g. `node --test`); " +
				"lookups are `explore`; use `inline` ONLY where main-context judgment is unavoidable. " +
				"Do not edit anything before compiling.", {}));
		});
	}
}
