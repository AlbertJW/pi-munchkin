import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { classifyBashCommand, isSourceMutation, looksFailingOutput } from "../lib/command-policy.ts";
import { steerText } from "../lib/steer-texts.ts";
import { record } from "../lib/telemetry.ts";

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

// Generic "ran a verify" regex. Tokens must appear at COMMAND POSITION (start of
// command or after ; & | ( sudo …) — `cat tests/foo.py`, `npm run dev`, or
// `echo pytest passed` must NOT count as a verify (that silently disarms the
// gate). The detected/forced gate command is appended at session start so the
// exact project command also counts.
const CMD_POS = "(?:^|[;&|(]\\s*|\\b(?:sudo|xargs|env)\\s+)";
const VERIFY_BASE =
	CMD_POS +
	"(?:just (?:verify|check|test)|pytest\\b|python3? -m pytest\\b|npm test\\b|npm run (?:test|check|lint|typecheck|verify)\\b|" +
	"yarn test\\b|tsc\\b|bash -n |go test\\b|cargo test\\b|make (?:test|check|verify)\\b|ruff\\b|eslint\\b|node --test\\b|" +
	"(?:\\./|bash |sh )\\S*test\\S*)";

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

// fires counts per EDIT EPISODE (reset when a new source mutation re-arms the
// gate) — a session-cumulative count kills the gate for the rest of a long
// session after 3 fires even when each steer was complied with. sessionFires
// (3× cap) stays as the runaway backstop.
type State = { mutated: boolean; verifiedOk: boolean; fires: number; sessionFires: number };
function fresh(): State {
	return { mutated: false, verifiedOk: false, fires: 0, sessionFires: 0 };
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
	// Steer texts route through lib/steer-texts.ts (PI_MSG_* override; defaults
	// byte-identical to the historical literals — asserted in tests).
	if (verifyFailed) {
		return steerText(
			"VG_STEER_FAILED",
			"[verify-gate] Gate FAILED and you're wrapping up. Don't finish on a red gate — fix it, re-run {gate} till green. Unverified output must not cross the boundary.{ctn}",
			{ gate: g, ctn },
		);
	}
	return steerText(
		"VG_STEER",
		"[verify-gate] You changed files, ran no passing gate. Before finishing: run {gate}, report result, fix + re-run if red. Unverified output must not cross the boundary.{ctn}",
		{ gate: g, ctn },
	);
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

		// A green plan-runner gate this turn IS a passing verify (one-shot flag,
		// set by plan-runner when an item's gate exits 0) — consume it so the
		// wrap-up isn't double-nagged after a gate already ran green.
		const g = globalThis as Record<string, unknown>;
		if (g.__pi_gate_green === true) {
			g.__pi_gate_green = undefined;
			st.verifiedOk = true;
			record("verify-gate", "gate-green-consumed", {});
		}

		// Track SOURCE mutations only. A new source edit invalidates any prior pass
		// (re-arms the gate) — checked AFTER the gate-green consume above so an edit
		// in the SAME turn as an (unrelated) passing gate always re-arms; consuming
		// gate-green first and mutation-checking after would let that edit slip
		// through marked "verified" by a gate that never covered it. Ops/infra churn
		// (installs, docker up/down, git, venv) must NOT re-arm — otherwise bringing
		// up a stack or tearing it down keeps re-nagging "verify" after a genuine
		// pass (esp. for containerized projects).
		if (
			toolCalls.some((c) => MUTATION_TOOLS.has(c.name)) ||
			toolCalls.some((c) => c.name === "bash" && isSourceMutation(String(c.args.command ?? "")))
		) {
			st.mutated = true;
			st.verifiedOk = false;
			st.fires = 0; // new edit episode: the gate may steer again
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
		// Defer to the loop-breaker's outcome detector: if it recently said "same
		// failing result — STOP, change approach", nagging "re-run till green" here
		// is contradictory double-steering. One voice at a time.
		const outcomeAt = typeof g.__pi_lb_outcome_at === "number" ? (g.__pi_lb_outcome_at as number) : 0;
		const outcomeActive = outcomeAt > 0 && Date.now() - outcomeAt < 120_000;

		const wrappingUp = toolCalls.length === 0;
		if (wrappingUp && st.mutated && !st.verifiedOk && st.fires < MAX_FIRES && st.sessionFires < MAX_FIRES * 3 && !planPhaseActive() && !outcomeActive) {
			st.fires += 1;
			st.sessionFires += 1;
			const msg = steer(verifyFailedThisTurn);
			record("verify-gate", "steer", { failed: verifyFailedThisTurn, fires: st.fires, sessionFires: st.sessionFires, injected_chars: msg.length, turnIndex: event.turnIndex });
			pi.sendUserMessage(msg, { deliverAs: "steer" });
		}
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (st.mutated && !st.verifiedOk) {
			record("verify-gate", "unverified-end", { fires: st.fires, sessionFires: st.sessionFires });
			ctx.ui.notify("verify-gate: files changed, no passing gate", "warning");
		}
	});
}
