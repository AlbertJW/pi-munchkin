import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { classifyBashCommand, isSourceMutation, looksFailingOutput } from "../lib/command-policy.ts";

// Boundary verify gate ("the handoff is sacred").
//
// Repeaters beat voltage: a session that MUTATES files but never runs a passing
// verify is about to ship unregenerated output across the commit/handoff
// boundary. Watch the session; when the model wraps up (a text-only turn) with
// mutations but no passing verify, inject ONE steer to verify first. If verify
// ran and FAILED, re-fire (reject/retry) up to MAX_FIRES.
//
// Project-agnostic: the gate command is AUTO-DETECTED per cwd at session start
// (justfile / npm / make / pytest / cargo / go / tsc). Force it with
// VERIFY_GATE_CMD; override the match regex with VERIFY_GATE_PATTERN. Disable
// with VERIFY_GATE=off. State is in-memory, reset on session_start. Complements
// the loop-breaker (caps n); this regenerates p at the boundary.

const ENABLED = process.env.VERIFY_GATE !== "off";
const MAX_FIRES = (() => {
	const n = Number.parseInt(process.env.VERIFY_GATE_MAX_FIRES || "3", 10);
	return Number.isFinite(n) && n > 0 ? n : 3;
})();

// Real file mutations only. NOT plan_write — that writes the internal TODO, not
// project files, so it must not arm the gate.
const MUTATION_TOOLS = new Set(["edit", "write", "multiedit"]);

// Planning is not a handoff: while /plan is in flight (flag shared by plan-runner
// via globalThis), the model legitimately wraps up after plan_write without
// executing or verifying anything. Don't nag it to verify during planning.
function planPhaseActive(): boolean {
	return (globalThis as Record<string, unknown>).__pi_plan_phase_active === true;
}

// Generic "ran a verify" regex. The detected/forced gate command is appended at
// session start so the exact project command also counts as verifying.
const VERIFY_BASE =
	"just (?:verify|check|test)|\\btests?\\b|pytest|npm (?:test|run )|yarn test|\\btsc\\b|bash -n|go test|cargo test|make (?:test|check|verify)|ruff|eslint";

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasRecipe(text: string, name: string): boolean {
	return new RegExp(`^${name}:`, "m").test(text);
}

// A docker-compose project usually runs its tests inside a service container, so
// the gate can't be run bare on the host (it needs the stack / env). Detect this
// so the steer nudges the in-container path instead of a host command.
async function hasComposeFile(cwd: string): Promise<boolean> {
	try {
		const files = new Set(await readdir(cwd));
		return ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"].some((f) => files.has(f));
	} catch {
		return false;
	}
}

// Best-effort: detect this project's gate command from cwd. Never throws.
async function detectGate(cwd: string): Promise<string | null> {
	try {
		const files = new Set(await readdir(cwd));
		for (const jf of ["justfile", "Justfile", ".justfile"]) {
			if (files.has(jf)) {
				const t = await readFile(join(cwd, jf), "utf8");
				for (const r of ["verify", "check", "test"]) if (hasRecipe(t, r)) return `just ${r}`;
			}
		}
		if (files.has("package.json")) {
			try {
				const p = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
				if (p?.scripts?.test) return "npm test";
				if (p?.scripts?.check) return "npm run check";
			} catch {}
		}
		for (const mk of ["Makefile", "makefile"]) {
			if (files.has(mk)) {
				const t = await readFile(join(cwd, mk), "utf8");
				for (const r of ["verify", "check", "test"]) if (hasRecipe(t, r)) return `make ${r}`;
			}
		}
		if (files.has("pyproject.toml") || files.has("pytest.ini") || files.has("tox.ini")) return "pytest";
		if (files.has("Cargo.toml")) return "cargo test";
		if (files.has("go.mod")) return "go test ./...";
		if (files.has("tsconfig.json")) return "tsc --noEmit";
	} catch {}
	return null;
}

type State = { mutated: boolean; verifiedOk: boolean; fires: number };
function fresh(): State {
	return { mutated: false, verifiedOk: false, fires: 0 };
}
let st = fresh();
let gateCmd: string | null = process.env.VERIFY_GATE_CMD || null;
let composeProject = false;

function buildRe(): RegExp {
	return new RegExp(process.env.VERIFY_GATE_PATTERN || VERIFY_BASE + (gateCmd ? `|${escapeRegex(gateCmd)}` : ""), "i");
}
let verifyRe = buildRe();

function steer(verifyFailed: boolean): string {
	const g = gateCmd ? `\`${gateCmd}\`` : "your verify (tests/typecheck)";
	// Containerized projects: tests usually need the stack, so run the gate inside
	// the service container; if the stack is down, bring it up or skip rather than
	// forcing a broken host run.
	const ctn = composeProject
		? ` Tests look containerized — run the gate inside the stack (e.g. \`docker compose exec <service> ${gateCmd ?? "pytest"}\`); if the stack is down, skip rather than run it on the host.`
		: "";
	if (verifyFailed) {
		return `[verify-gate] Gate FAILED and you're wrapping up. Don't finish on a red gate — fix it, re-run ${g} till green. Unverified output must not cross the boundary.${ctn}`;
	}
	return `[verify-gate] You changed files, ran no passing gate. Before finishing: run ${g}, report result, fix + re-run if red. Unverified output must not cross the boundary.${ctn}`;
}

export default function (pi: ExtensionAPI) {
	if (!ENABLED) return;

	pi.on("session_start", async (_event, ctx) => {
		st = fresh();
		const cwd = ctx?.cwd || process.cwd();
		composeProject = await hasComposeFile(cwd);
		if (!process.env.VERIFY_GATE_CMD) {
			gateCmd = await detectGate(cwd);
			verifyRe = buildRe();
		}
	});

	pi.on("turn_end", async (event) => {
		const msg = event.message;
		if (msg.role !== "assistant") return;

		const toolCalls: { id: string; name: string; args: Record<string, unknown> }[] = [];
		for (const block of msg.content) {
			if (block.type === "toolCall") {
				toolCalls.push({ id: block.id, name: block.name, args: (block.arguments ?? {}) as Record<string, unknown> });
			}
		}

		// Track SOURCE mutations only. A new source edit invalidates any prior pass
		// (re-arms the gate). Ops/infra churn (installs, docker up/down, git, venv)
		// must NOT re-arm — otherwise bringing up a stack or tearing it down keeps
		// re-nagging "verify" after a genuine pass (esp. for containerized projects).
		if (
			toolCalls.some((c) => MUTATION_TOOLS.has(c.name)) ||
			toolCalls.some((c) => c.name === "bash" && isSourceMutation(String(c.args.command ?? "")))
		) {
			st.mutated = true;
			st.verifiedOk = false;
		}

		// Track verify: a verify-pattern bash command whose own result looks green.
		let verifyFailedThisTurn = false;
		for (const c of toolCalls) {
			if (c.name !== "bash") continue;
			const command = String(c.args.command ?? "");
			const policy = classifyBashCommand(command, gateCmd ? [gateCmd] : []);
			if (!policy.verifyLike && !verifyRe.test(command)) continue;
			const result = event.toolResults.find((r) => r.toolCallId === c.id);
			const output = result?.content.map((part) => ("text" in part ? part.text : "")).join(" ") ?? "";
			if (result && !looksFailingOutput(output, result.isError)) st.verifiedOk = true;
			else verifyFailedThisTurn = true;
		}

		// Fire on a wrap-up (text-only) turn when files changed but no passing verify.
		const wrappingUp = toolCalls.length === 0;
		if (wrappingUp && st.mutated && !st.verifiedOk && st.fires < MAX_FIRES && !planPhaseActive()) {
			st.fires += 1;
			pi.sendUserMessage(steer(verifyFailedThisTurn), { deliverAs: "followUp" });
		}
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (st.mutated && !st.verifiedOk) {
			ctx.ui.notify("verify-gate: files changed, no passing gate", "warning");
		}
	});
}
