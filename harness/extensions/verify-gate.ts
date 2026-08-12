import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readdir } from "node:fs/promises";
import { classifyBashCommand, isSourceMutation, looksFailingOutput, normalizeVerificationCommand, verificationEvidence } from "../lib/command-policy.ts";
import { clearPlanGateReceipt, consumePlanGateReceipt } from "../lib/plan-gate-receipt.ts";
import { clearDetectedProjectGate, detectProjectGate, publishDetectedProjectGate } from "../lib/project-gate.ts";
import { boundedReceiptText } from "../lib/run-kernel-receipts.ts";
import { steerText } from "../lib/steer-texts.ts";
import { record } from "../lib/telemetry.ts";
import { VerificationOrderClock, type OrderedCallKind } from "../lib/verification-order.ts";
import { buildControlProposal, controlEnforces, emitControlProposal } from "../lib/control-proposal.ts";

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
// VERIFY_GATE_CMD. Disable
// with VERIFY_GATE=off. State is in-memory, reset on session_start. Complements
// the loop-breaker (caps n); this regenerates p at the boundary.

const ENABLED = process.env.VERIFY_GATE !== "off";
const EXECUTION_ORDER = process.env.VERIFY_EXECUTION_ORDER !== "legacy";
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

const GATE_DISPLAY_MAX_BYTES = 240;

function truncateUtf8(value: string, maxBytes: number): string {
	const bytes = Buffer.from(value, "utf8");
	if (bytes.length <= maxBytes) return value;
	let end = maxBytes;
	while (end > 0 && (bytes[end] & 0b1100_0000) === 0b1000_0000) end -= 1;
	return bytes.subarray(0, end).toString("utf8");
}

/**
 * Render a configured gate as bounded data, never as an unbounded prompt suffix.
 * The exact, unmodified command remains the classifier/execution identity.
 */
export function gateDisplayCommand(command: string | null): string | null {
	if (!command) return null;
	const safe = normalizeVerificationCommand(command)
		.replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/gu, "")
		.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, " ")
		.replace(/`/gu, "'")
		.replace(/\b(?:sk|rk|pk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{6,}\b/giu, "[redacted]")
		.replace(/\b(api[_-]?key|token|password|secret|authorization)\s*[:=]\s*\S+/giu, "$1=[redacted]")
		.replace(/https?:\/\/\S+/giu, "[url omitted]")
		.replace(/\/(?:Users|home|private|var|tmp)\/\S+/gu, "[path omitted]")
		.replace(/\s+/gu, " ")
		.trim();
	return safe ? truncateUtf8(safe, GATE_DISPLAY_MAX_BYTES) : null;
}

function steer(verifyFailed: boolean): string {
	const displayCommand = gateDisplayCommand(gateCmd);
	const g = displayCommand ? `\`${displayCommand}\`` : "your verify (tests/typecheck)";
	// Containerized projects: tests usually need the stack, so run the gate inside
	// the service container; if the stack is down, bring it up or skip rather than
	// forcing a broken host run.
	const ctn = composeProject
		? ` Tests look containerized — run the configured gate inside the stack (for example, \`docker compose exec <service> <configured-gate>\`); if the stack is down, skip rather than run it on the host.`
		: "";
	// Steer texts route through lib/steer-texts.ts (PI_MSG_* override; defaults
	// byte-identical to the historical literals — asserted in tests).
	if (verifyFailed) {
		return steerText(
			"VG_STEER_FAILED",
			"[verify-gate] The exact gate {gate} is red after the latest mutation. Resolve that evidence before handoff.{ctn}",
			{ gate: g, ctn },
		);
	}
	return steerText(
		"VG_STEER",
		"[verify-gate] The exact gate {gate} has not passed after the latest mutation. Run it before handoff.{ctn}",
		{ gate: g, ctn },
	);
}

export default function (pi: ExtensionAPI) {
	if (!ENABLED) return;
	const order = new VerificationOrderClock();
	let failedSinceTurnEnd = false;

	const classifyStart = (toolName: string, args: Record<string, unknown>): OrderedCallKind => {
		const sourceMutation = MUTATION_TOOLS.has(toolName) ||
			(toolName === "bash" && isSourceMutation(String(args.command ?? "")));
		if (sourceMutation) return "source_mutation";
		if (toolName !== "bash") return "other";
		const command = String(args.command ?? "");
		const policy = classifyBashCommand(command, gateCmd ? [gateCmd] : []);
		return !policy.mutates && verificationEvidence(command, gateCmd) !== "none"
			? "verification" : "other";
	};

	const applyOrderedOutcome = (outcome: ReturnType<VerificationOrderClock["finish"]>): void => {
		if (!outcome) return;
		if (outcome.mutationAttempted) {
			st.mutated = true;
			st.verifiedOk = false;
		}
		if (!outcome.verificationAttempted) return;
		st.verifiedOk = outcome.verificationValid;
		if (outcome.verificationValid) {
			record("verify-gate", "gate-green-execution-ordered", {
				started_sequence: outcome.startedSequence,
				ended_sequence: outcome.endedSequence,
			});
		} else {
			failedSinceTurnEnd = true;
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		st = fresh();
		order.reset();
		failedSinceTurnEnd = false;
		clearPlanGateReceipt();
		clearDetectedProjectGate();
		// The published globalThis snapshot must die with the session, not just the
		// module state: pi's loader returns the CACHED factory across session
		// replacement, so without this a /new, /fork or same-cwd /resume leaked the
		// PREVIOUS session's verify verdict into the c48 lens. Same fix as
		// loop-breaker's __pi_lb_state and plan-runner's __pi_active_plan_context.
		delete (globalThis as Record<string, unknown>).__pi_vg_state;
		const cwd = ctx?.cwd || process.cwd();
		composeProject = await hasComposeFile(cwd);
		if (!process.env.VERIFY_GATE_CMD) {
			gateCmd = await detectProjectGate(cwd);
		}
		publishDetectedProjectGate(cwd, gateCmd);
	});

	pi.on("tool_execution_start", async (event) => {
		if (!EXECUTION_ORDER) return;
		const args = event.args && typeof event.args === "object"
			? event.args as Record<string, unknown> : {};
		const kind = classifyStart(event.toolName, args);
		order.start({ callId: event.toolCallId, kind });
		if (kind === "source_mutation") {
			st.mutated = true;
			st.verifiedOk = false;
			st.fires = 0;
		}
	});

	pi.on("tool_execution_end", async (event) => {
		if (!EXECUTION_ORDER) return;
		const kind = order.kindFor(event.toolCallId);
		if (!kind) return; // A missing start can never manufacture verification.

		let succeeded = !event.isError;
		if (kind === "verification") {
			succeeded = succeeded && !looksFailingOutput(boundedReceiptText(event.result), false);
		}

		let verificationOverride: "passed" | "failed" | "none" = "none";
		if (event.toolName === "plan_write" || event.toolName === "plan_update") {
			const receipt = consumePlanGateReceipt(event.toolCallId);
			if (receipt) {
				const relevant = receipt.outcomes.some((outcome) =>
					verificationEvidence(outcome.command, gateCmd) !== "none");
				const accepted = receipt.outcomes.some((outcome) =>
					outcome.pass && verificationEvidence(outcome.command, gateCmd) !== "none");
				if (relevant) {
					verificationOverride = succeeded && receipt.allPassed && accepted ? "passed" : "failed";
				}
			}
		}

		applyOrderedOutcome(order.finish({
			callId: event.toolCallId,
			succeeded,
			verificationOverride,
		}));
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

		const g = globalThis as Record<string, unknown>;
		let verifyFailedThisTurn = failedSinceTurnEnd;
		failedSinceTurnEnd = false;
		if (EXECUTION_ORDER) {
			// Execution events are authoritative. Transcript-only calls fail closed:
			// a mutation still arms the boundary, while a verifier with no observed
			// start/end can never provide green evidence.
			for (const c of toolCalls) {
				if (order.hasCompleted(c.id)) continue;
				const kind = classifyStart(c.name, c.args);
				// A transcript call with no complete execution event is not evidence of
				// success. Register a missing mutation as pending so no later verifier
				// can silently green the session after an unobserved partial write.
				order.start({ callId: c.id, kind });
				if (kind === "source_mutation") {
					st.mutated = true;
					st.verifiedOk = false;
					st.fires = 0;
				} else if (kind === "verification") {
					st.verifiedOk = false;
					verifyFailedThisTurn = true;
				}
				if (c.name === "plan_write" || c.name === "plan_update") {
					const staleReceipt = consumePlanGateReceipt(c.id);
					if (staleReceipt?.outcomes.some((outcome) =>
						verificationEvidence(outcome.command, gateCmd) !== "none")) {
						st.verifiedOk = false;
						verifyFailedThisTurn = true;
					}
				}
			}
		} else {
			for (const c of toolCalls) {
				const sourceMutation = MUTATION_TOOLS.has(c.name) ||
					(c.name === "bash" && isSourceMutation(String(c.args.command ?? "")));
				if (sourceMutation) {
					st.mutated = true;
					st.verifiedOk = false;
					st.fires = 0;
				}

				const planReceipt = c.name === "plan_write" || c.name === "plan_update"
					? consumePlanGateReceipt(c.id) : null;
				if (planReceipt) {
					const relevant = planReceipt.outcomes.some((outcome) =>
						verificationEvidence(outcome.command, gateCmd) !== "none");
					const accepted = planReceipt.outcomes.some((outcome) =>
						outcome.pass && verificationEvidence(outcome.command, gateCmd) !== "none");
					if (planReceipt.allPassed && accepted) {
						st.verifiedOk = true;
						record("verify-gate", "gate-green-consumed", {});
					} else if (relevant) {
						st.verifiedOk = false;
						verifyFailedThisTurn = true;
					}
				}

				if (c.name !== "bash") continue;
				const command = String(c.args.command ?? "");
				const policy = classifyBashCommand(command, gateCmd ? [gateCmd] : []);
				if (policy.mutates || verificationEvidence(command, gateCmd) === "none") continue;
				const result = event.toolResults.find((r) => r.toolCallId === c.id);
				const output = result?.content.map((part) => ("text" in part ? part.text : "")).join(" ") ?? "";
				if (result && !looksFailingOutput(output, result.isError)) st.verifiedOk = true;
				else {
					st.verifiedOk = false;
					verifyFailedThisTurn = true;
				}
			}
		}

		// Fire on a wrap-up (text-only) turn when files changed but no passing verify.
		// The typed arbiter owns same-boundary deconfliction with repeated-failure
		// recovery; no wall-clock suppression state crosses extension boundaries.
		const wrappingUp = toolCalls.length === 0;
		if (wrappingUp && st.mutated && !st.verifiedOk && st.fires < MAX_FIRES && st.sessionFires < MAX_FIRES * 3 && !planPhaseActive()) {
			st.fires += 1;
			st.sessionFires += 1;
			const msg = steer(verifyFailedThisTurn);
			record("verify-gate", "steer", { failed: verifyFailedThisTurn, fires: st.fires, sessionFires: st.sessionFires, injected_chars: msg.length, turnIndex: event.turnIndex });
			const legacyActed = !controlEnforces(pi.events);
			emitControlProposal(pi.events, buildControlProposal({
				boundarySequence: event.turnIndex,
				kind: "verification_required",
				reason: "exact_gate_missing",
				source: "verify-gate",
				cooldownKey: "verify-wrap",
				messageFactory: "verify-wrap",
				legacyActed,
			}), { message: msg });
			if (legacyActed) pi.sendUserMessage(msg, { deliverAs: "steer" });
		}

		// Published for the session blackboard (globalThis bus; module state is
		// per-extension under pi's loader). LAST, deliberately: this used to be the
		// first statement of the handler, so the by-value snapshot predated this
		// turn's gate-green consume, mutation arming and verify tracking — and since
		// verify-gate loads before session-blackboard, the c48 lens rendered verify
		// state one full turn stale. Publish after all updates so
		// the lens describes THIS turn.
		g.__pi_vg_state = { gateCmd, mutated: st.mutated, verifiedOk: st.verifiedOk, fires: st.fires, sessionFires: st.sessionFires };
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (st.mutated && !st.verifiedOk) {
			record("verify-gate", "unverified-end", { fires: st.fires, sessionFires: st.sessionFires });
			ctx.ui.notify("verify-gate: files changed, no passing gate", "warning");
		}
	});
}
