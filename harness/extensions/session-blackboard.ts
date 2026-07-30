import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	boardState, noteTool, noteTelemetry, syncBus, renderLens, renderCockpitHtml,
	resetBoard, restore, snapshot,
} from "../lib/blackboard.ts";
import { record } from "../lib/telemetry.ts";
import type { TelemetryTap } from "../lib/telemetry.ts";

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
	const raw = process.env.STATE_LENS;
	return raw === "view" || raw === "steer" || raw === "both" ? raw : "off";
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

	function renderCockpit(force = false): void {
		if (IN_GATE) return;
		const now = Date.now();
		if (!force && now - lastRenderAt < RENDER_MIN_MS) return;
		lastRenderAt = now;
		const state = boardState();
		syncBus(state);
		try {
			const path = join(cwd, "artifacts", "session-cockpit.html");
			mkdirSync(dirname(path), { recursive: true });
			const html = renderCockpitHtml(state, { cwd, renderedAt: new Date().toISOString() });
			writeFileSync(path, html);
			record("blackboard", "rendered", { chars: html.length, attempts: Object.keys(state.attempts).length });
		} catch { /* cockpit must never break a session */ }
	}

	// turnIndex restarts at 0 on every AGENT RUN, not only per session
	// (agent-session.js:428-429 + agent-loop.js:49/67 — retries and continuations
	// each emit agent_start). Without this, `state.turn - lastLensSteerTurn` goes
	// negative after a mid-session restart and stays below STEER_MIN_TURN_GAP
	// forever, silently latching the lens steer off for the rest of the session.
	pi.on("agent_start", async () => { lastLensSteerTurn = -Infinity; });

	pi.on("session_start", async (event, ctx) => {
		cwd = ctx.cwd ?? process.cwd();
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
		syncBus(state);
		renderCockpit();
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

	pi.on("agent_end", async () => {
		renderCockpit(true);
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
			// regenerated fresh each call (no accumulation, no staleness), and tail
			// position leaves the KV prefix intact.
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
			renderCockpit(true);
			const lens = renderLens(state, LENS_MAX_CHARS) || "(empty — no failures, mutations, or plan yet)";
			const where = IN_GATE ? "(cockpit suppressed in gate)" : join(cwd, "artifacts", "session-cockpit.html");
			if (ctx.hasUI) ctx.ui.notify(`${lens}\n→ ${where}`, "info");
		},
	});
}
