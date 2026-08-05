import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	boardState, noteTool, noteTelemetry, syncBus, renderLens, renderCockpitHtml,
	resetBoard, restore, snapshot,
} from "../lib/blackboard.ts";
import { record } from "../lib/telemetry.ts";
import type { TelemetryTap } from "../lib/telemetry.ts";
import { agentDir } from "../lib/agent-dir.ts";

// Session blackboard: ground-truth working memory (see lib/blackboard.ts).
// Three faces, strictly separated:
//   cockpit  — human-only HTML artifact + TUI widget; NEVER model-visible.
//   lens     — model-visible ONLY under the dark flag STATE_LENS (c48):
//              view  = one non-accumulating tail block per LLM call (context
//                      view hook — transcript untouched, KV prefix stable)
//              steer = bounded supplement when loop-breaker fires
//   /blackboard — human command to inspect the current lens + artifact path.
// BLACKBOARD=off kills everything. Cockpit files are suppressed in gate runs
// (TELEMETRY_SOURCE=gate) so fixture workdirs stay pristine — a cockpit file in
// cwd would be indirectly model-visible to an `ls`.

const ENABLED = process.env.BLACKBOARD !== "off";
const IN_GATE = process.env.TELEMETRY_SOURCE === "gate";
const LENS_MODE = ((): "off" | "view" | "steer" | "both" => {
	// ADOPTED 2026-08-04 (explicit human gate): default is now event-driven
	// "steer", avoiding per-call context mutation. STATE_LENS=view|both restores
	// the experimental per-call lens; STATE_LENS=off remains the kill switch.
	// Grounds in DARK_CANDIDATE_VERDICTS_2026-08-03.md. Default-on, reversible,
	// mechanism-observed; benefit was not established by a powered trial.
	// The opt-in per-call tail breaks the serving KV prefix (see the honest-cost
	// comment at the append site).
	const raw = process.env.STATE_LENS;
	if (raw === "off") return "off";
	return raw === "view" || raw === "steer" || raw === "both" ? raw : "steer";
})();
const LENS_MAX_CHARS = (() => {
	const raw = process.env.STATE_LENS_MAX_CHARS ?? "";
	const n = /^\d+$/.test(raw) ? Number(raw) : 1200;
	return Math.min(4000, Math.max(200, n));
})();
const RENDER_MIN_MS = 5000;
const STEER_MIN_TURN_GAP = 8;
const ENTRY_TYPE = "blackboard.state";

export default function (pi: ExtensionAPI): void {
	if (!ENABLED) return;
	const pendingArgs = new Map<string, Record<string, unknown>>();
	let lastRenderAt = 0;
	let lastLensSteerTurn = -Infinity;
	let cwd = process.cwd();
	let artifactPath = cockpitPath(cwd);
	let renderInFlight: Promise<void> | null = null;
	let renderQueued = false;
	let renderTimer: ReturnType<typeof setTimeout> | null = null;

	// Telemetry tap: cross-extension facts (plan gates, context receipts,
	// compactions, loop-breaker firings). Reload-safe: previous instances of this
	// extension are evicted by name before pushing.
	const tap: TelemetryTap & { __blackboard?: true } = (ext, kind, detail) => {
		const state = boardState();
		noteTelemetry(state, ext, kind, detail);
		if ((LENS_MODE === "steer" || LENS_MODE === "both") &&
			ext === "loop-breaker" && (kind === "steer" || kind === "session-repeat") &&
			state.turn - lastLensSteerTurn >= STEER_MIN_TURN_GAP) {
			syncBus(state);
			const lens = renderLens(state, LENS_MAX_CHARS);
			if (lens) {
				lastLensSteerTurn = state.turn;
				record("state-lens", "steer-injected", { chars: lens.length, turnIndex: state.turn });
				try {
					pi.sendUserMessage(lens, { deliverAs: "steer" });
				} catch { /* streaming edge — next signal retries */ }
			}
		}
	};
	tap.__blackboard = true;
	const g = globalThis as Record<string, unknown>;
	const taps = ((g.__pi_telemetry_taps as TelemetryTap[] | undefined) ?? []).filter(
		(t) => !(t as { __blackboard?: true }).__blackboard,
	);
	taps.push(tap);
	g.__pi_telemetry_taps = taps;

	function cockpitPath(workdir: string): string {
		const cwdHash = createHash("sha256").update(workdir).digest("hex");
		return join(agentDir(), "artifacts", "session-cockpits", `${cwdHash}.html`);
	}

	async function writeCockpit(): Promise<void> {
		if (IN_GATE) return;
		const state = boardState();
		syncBus(state);
		const path = artifactPath;
		const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
		try {
			await mkdir(dirname(path), { recursive: true, mode: 0o700 });
			await chmod(dirname(path), 0o700);
			const html = renderCockpitHtml(state, { cwd, renderedAt: new Date().toISOString() });
			await writeFile(tmp, html, { encoding: "utf8", mode: 0o600 });
			await rename(tmp, path);
			await chmod(path, 0o600);
			record("blackboard", "rendered", { chars: html.length, attempts: Object.keys(state.attempts).length });
		} catch { try { await unlink(tmp); } catch { /* absent temp */ } }
	}

	async function renderCockpit(force = false): Promise<void> {
		if (IN_GATE) return;
		if (renderInFlight) {
			renderQueued = true;
			if (force) await renderInFlight;
			else return;
		}
		const remaining = RENDER_MIN_MS - (Date.now() - lastRenderAt);
		if (!force && remaining > 0) {
			renderQueued = true;
			if (!renderTimer) renderTimer = setTimeout(() => {
				renderTimer = null;
				void renderCockpit(true);
			}, remaining);
			return;
		}
		if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
		renderQueued = false;
		lastRenderAt = Date.now();
		renderInFlight = writeCockpit().finally(() => { renderInFlight = null; });
		await renderInFlight;
		if (force && renderQueued) await renderCockpit(true);
	}

	// turnIndex restarts at 0 on every AGENT RUN, not only per session
	// (agent-session.js:428-429 + agent-loop.js:49/67 — retries and continuations
	// each emit agent_start). Without this, `state.turn - lastLensSteerTurn` goes
	// negative after a mid-session restart and stays below STEER_MIN_TURN_GAP
	// forever, silently latching the lens steer off for the rest of the session.
	pi.on("agent_start", async () => { lastLensSteerTurn = -Infinity; });

	pi.on("session_start", async (event, ctx) => {
		cwd = ctx.cwd ?? process.cwd();
		artifactPath = cockpitPath(cwd);
		pendingArgs.clear();
		// ALWAYS reset first. The board lives on globalThis, so a resume/fork whose
		// snapshot is missing or rejected would otherwise inherit the PREVIOUS
		// session's ledger in the same process — and the state lens would then
		// present another session's attempts as this session's ground truth, which
		// is the one failure mode this design exists to rule out.
		resetBoard();
		if (event.reason === "resume" || event.reason === "fork") {
			try {
				const entries = ctx.sessionManager.getBranch();
				for (let i = entries.length - 1; i >= 0; i--) {
					const entry = entries[i] as { type?: string; customType?: string; data?: unknown };
					if (entry.type === "custom" && entry.customType === ENTRY_TYPE) {
						restore(entry.data);
						record("blackboard", "restored", { attempts: Object.keys(boardState().attempts).length });
						break;
					}
				}
			} catch { /* fresh board is a safe fallback */ }
		}
	});

	pi.on("tool_execution_start", async (event) => {
		pendingArgs.set(event.toolCallId, (event.args ?? {}) as Record<string, unknown>);
	});

	pi.on("tool_execution_end", async (event) => {
		const args = pendingArgs.get(event.toolCallId) ?? {};
		pendingArgs.delete(event.toolCallId);
		let errorText: string | null = null;
		if (event.isError) {
			const content = (event.result as { content?: { type: string; text?: string }[] } | undefined)?.content;
			errorText = content?.find((b) => b.type === "text")?.text ?? null;
		}
		noteTool(boardState(), { toolName: event.toolName, args, isError: event.isError === true, errorText });
	});

	pi.on("turn_end", async (event, ctx) => {
		const state = boardState();
		state.turn = event.turnIndex;
		state.context.pct = ctx.getContextUsage()?.percent ?? state.context.pct;
		syncBus(state);
		void renderCockpit();
		if (ctx.hasUI) {
			const v = state.verify;
			ctx.ui.setWidget("blackboard", [
				`bb: ${Object.keys(state.attempts).length} actions · ` +
				`${v ? (v.verifiedOk ? "gate green" : v.mutated ? "UNVERIFIED" : "clean") : "—"} · ` +
				`repeats ${state.loop?.sessionRepeats ?? 0}` +
				(state.context.pct != null ? ` · ctx ${Math.round(state.context.pct)}%` : ""),
			]);
		}
	});

	pi.on("agent_settled", async () => {
		await renderCockpit(true);
		try {
			pi.appendEntry(ENTRY_TYPE, snapshot(boardState()));
		} catch { /* persistence is best-effort */ }
	});

	if (LENS_MODE === "view" || LENS_MODE === "both") {
		pi.on("context", async (event) => {
			const state = boardState();
			syncBus(state);
			const lens = renderLens(state, LENS_MAX_CHARS);
			if (!lens) return undefined;
			// Append to the LAST message's content in the per-call VIEW: never stored,
			// regenerated fresh each call (no accumulation, no staleness).
			// COST, stated honestly (triage #15): this does NOT leave the KV prefix
			// intact, despite what this comment used to claim. On call N+1 the message
			// that was last on call N has LOST its lens tail (the view is per-call),
			// so the serving-side prefix diverges at that position every single call —
			// llama.cpp re-prefills from there each turn. The alternative (persisting
			// the tail) trades that for unbounded stale-lens accumulation in the
			// transcript. Revisit only as a measured candidate revision; for now the
			// re-prefill cost is accepted and must be remembered when reading c48
			// token/latency numbers.
			const messages = event.messages as { content?: unknown }[];
			const last = messages[messages.length - 1];
			if (!last || !Array.isArray(last.content)) return undefined;
			last.content.push({ type: "text", text: `\n\n${lens}` });
			record("state-lens", "view-injected", { chars: lens.length, turnIndex: state.turn });
			return { messages: event.messages };
		});
	}

	pi.registerCommand("blackboard", {
		description: "Show the session blackboard (lens text + cockpit artifact path)",
		handler: async (_args, ctx) => {
			const state = boardState();
			syncBus(state);
			await renderCockpit(true);
			const lens = renderLens(state, LENS_MAX_CHARS) || "(empty — no failures, mutations, or plan yet)";
			const where = IN_GATE ? "(cockpit suppressed in gate)" : artifactPath;
			if (ctx.hasUI) ctx.ui.notify(`${lens}\n→ ${where}`, "info");
		},
	});
}
