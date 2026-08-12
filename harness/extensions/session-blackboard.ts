import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	boardState, noteTool, noteHarnessSignal, syncBus, renderLens, renderCockpitHtml,
	resetBoard, restore, snapshot,
} from "../lib/blackboard.ts";
import { record } from "../lib/telemetry.ts";
import { agentDir } from "../lib/agent-dir.ts";
import { onHarnessSignal } from "../lib/harness-signals.ts";
import {
	buildControlProposal, controlEnforces, emitControlProposal, onControlProposal,
} from "../lib/control-proposal.ts";

// Session blackboard: bounded harness-derived working memory (see lib/blackboard.ts).
// Three faces, strictly separated:
//   cockpit  — human-only HTML artifact + TUI widget; NEVER model-visible.
//   lens     — model-visible only as a bounded supplement when loop-breaker fires;
//              STATE_LENS=off is the kill switch.
//   /blackboard — human command to inspect the current lens + artifact path.
// BLACKBOARD=off kills everything. Cockpit files are suppressed in gate runs
// (TELEMETRY_SOURCE=gate) so fixture workdirs stay pristine — a cockpit file in
// cwd would be indirectly model-visible to an `ls`.

const ENABLED = process.env.BLACKBOARD !== "off";
const IN_GATE = process.env.TELEMETRY_SOURCE === "gate";
const LENS_MODE = ((): "off" | "steer" => {
	// ADOPTED 2026-08-04 (explicit human gate): default is now event-driven
	// "steer", avoiding per-call context mutation. STATE_LENS=off remains the
	// kill switch; retired view/both values fall back to steer.
	// Grounds in DARK_CANDIDATE_VERDICTS_2026-08-03.md. Default-on, reversible,
	// mechanism-observed; benefit was not established by a powered trial.
	const raw = process.env.STATE_LENS;
	if (raw === "off") return "off";
	return "steer";
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
	let lastLensProposalBoundary = -Infinity;

	onHarnessSignal(pi.events, (signal) => noteHarnessSignal(boardState(), signal));
	onControlProposal(pi.events, ({ proposal }) => {
		// effect guard: abort/shutdown proposals are hard stops. Loop-breaker
		// deliberately injects NO steer in those modes (a corrective user message
		// fights the abort and can restart the run) — the lens must not reintroduce
		// one through this side channel. Only message-bearing tiers get a lens.
		if (proposal.source !== "loop-breaker" ||
			proposal.kind !== "failure_recovery" ||
			proposal.effect !== "message" ||
			proposal.boundarySequence === lastLensProposalBoundary) return;
		const state = boardState();
		if (LENS_MODE === "steer" &&
			proposal.boundarySequence - lastLensSteerTurn >= STEER_MIN_TURN_GAP) {
			state.turn = proposal.boundarySequence;
			syncBus(state);
			const lens = renderLens(state, LENS_MAX_CHARS);
			if (lens) {
				lastLensProposalBoundary = proposal.boundarySequence;
				lastLensSteerTurn = proposal.boundarySequence;
				const legacyActed = !controlEnforces(pi.events);
				emitControlProposal(pi.events, buildControlProposal({
					boundarySequence: proposal.boundarySequence,
					kind: "context_hint",
					reason: "state_lens",
					source: "session-blackboard",
					cooldownKey: "state-lens",
					messageFactory: "state-lens",
					legacyActed,
				}), { message: lens });
				if (legacyActed) {
					record("state-lens", "steer-injected", { chars: lens.length, turnIndex: proposal.boundarySequence });
					try { pi.sendUserMessage(lens, { deliverAs: "steer" }); } catch { /* stale session */ }
				}
			}
		}
	});

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
	pi.on("agent_start", async () => {
		lastLensSteerTurn = -Infinity;
		lastLensProposalBoundary = -Infinity;
	});

	pi.on("session_start", async (event, ctx) => {
		cwd = ctx.cwd ?? process.cwd();
		artifactPath = cockpitPath(cwd);
		pendingArgs.clear();
		// ALWAYS reset first. The board lives on globalThis, so a resume/fork whose
		// snapshot is missing or rejected would otherwise inherit the PREVIOUS
		// session's ledger in the same process — and the state lens would then
		// present another session's attempts as this session's state, which
		// is the one failure mode this design exists to rule out.
		resetBoard();
		if (event.reason === "resume" || event.reason === "fork") {
			try {
				const entries = ctx.sessionManager.getBranch();
				for (let i = entries.length - 1; i >= 0; i--) {
					const entry = entries[i] as { type?: string; customType?: string; data?: unknown };
					if (entry.type === "custom" && entry.customType === ENTRY_TYPE) {
						// A REJECTED restore must be visible: the previous version swallowed
						// the resulting throw here, leaving a corrupt board installed and the
						// lens silently dead for the whole session with no row written — an
						// arm scored "lens on" could have run with the lens doing nothing.
						if (restore(entry.data)) {
							record("blackboard", "restored", { attempts: Object.keys(boardState().attempts).length });
						} else {
							resetBoard();
							record("blackboard", "restore-rejected", { attempts: 0 });
						}
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
