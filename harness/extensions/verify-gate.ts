import { subscribeOnce } from "../lib/extension-lifecycle.ts";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { classifyBashCommand, isSourceMutation, looksFailingOutput, normalizeVerificationCommand, verificationEvidence } from "../lib/command-policy.ts";
import { runReadonlyGate, type GateResult } from "../lib/gate-runtime.ts";
import { renderSafeGateFailure, safeGateDiagnostic } from "../lib/plan-gate-diagnostic.ts";
import { clearDetectedProjectGate, detectProjectGate, publishDetectedProjectGate } from "../lib/project-gate.ts";
import { boundedReceiptTailText, boundedReceiptText } from "../lib/run-kernel-receipts.ts";
import { steerText } from "../lib/steer-texts.ts";
import { record } from "../lib/telemetry.ts";
import { VerificationOrderClock, type OrderedCallKind } from "../lib/verification-order.ts";
import { VerificationFrontierTracker, type VerificationFrontierSnapshotV1 } from "../lib/verification-frontier.ts";
import { VerificationPlateauTracker, type VerificationPlateauMode } from "../lib/verification-plateau.ts";
import { buildControlProposal, controlArbiterMode, controlEnforces, emitControlProposal } from "../lib/control-proposal.ts";
import { planItemHash, sha256 } from "../lib/failure-episodes.ts";
import { emitHarnessSignal, onHarnessSignal } from "../lib/harness-signals.ts";

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
// ADOPTED 2026-08-24 (Albert-approved judgment adoption, tool-call-rescue
// precedent): unset now means ENFORCE. This is AVO's supervisor pillar -- redirect
// on "no forward progress" (3 successful-mutation epochs with no frontier advance),
// not repeat-count -- and it was dark in shadow while the exact failure it exists
// for happened live (a 3-day session plateaued at streak 3 and stalled overnight).
// The steer is bounded: one winner per boundary via the control arbiter,
// cooldown-keyed, delivery telemetry-honest since 2026-08-21. Benefit is NOT
// established by a powered trial. Rollbacks: VERIFICATION_PLATEAU=shadow (observe
// only) or =off.
const PLATEAU_MODE: VerificationPlateauMode = process.env.VERIFICATION_PLATEAU === "off" ? "off" :
	process.env.VERIFICATION_PLATEAU === "shadow" ? "shadow" : "enforce";
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
type State = { mutated: boolean; verifiedOk: boolean; fires: number; sessionFires: number; nagAwaitingEvidence: boolean };
function fresh(): State {
	return { mutated: false, verifiedOk: false, fires: 0, sessionFires: 0, nagAwaitingEvidence: false };
}
let st = fresh();
let gateCmd: string | null = process.env.VERIFY_GATE_CMD || null;
let composeProject = false;
// The session cwd, captured at session_start. A file mutation whose path lands
// OUTSIDE this directory is not a handoff risk for THIS project's gate — the
// dogfood case was a report written to ~/Desktop while cwd was a code project,
// which armed the gate and drove 8 unsatisfiable steers.
let sessionCwd = process.cwd();
let canonicalSessionCwd = resolve(sessionCwd);

// True only when `p` resolves to a path OUTSIDE the canonical session cwd.
// Resolve the nearest existing ancestor so a not-yet-created file below a
// symlink cannot bypass the boundary. Missing or unresolvable paths return
// false, so the mutation stays armed (fail-closed).
// Only edit/write/multiedit paths are scoped this way; bash-mediated mutations
// (sed -i, redirects) remain path-unscoped by design — a known, documented limit.
async function canonicalProspectivePath(path: string): Promise<string> {
	let cursor = resolve(path);
	const suffix: string[] = [];
	for (;;) {
		try {
			return resolve(await realpath(cursor), ...suffix);
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
			const parent = dirname(cursor);
			if (parent === cursor) throw error;
			suffix.unshift(basename(cursor));
			cursor = parent;
		}
	}
}

async function pathOutsideCwd(p: unknown): Promise<boolean> {
	if (typeof p !== "string" || !p.trim()) return false;
	const abs = isAbsolute(p) ? p : resolve(sessionCwd, p);
	try {
		const canonical = await canonicalProspectivePath(abs);
		const rel = relative(canonicalSessionCwd, canonical);
		return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
	} catch {
		return false; // unresolved means the mutation remains armed (fail closed)
	}
}

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
	// No project gate was detected (no justfile/package.json/Makefile/… in cwd).
	// Don't claim "the exact gate" — there is none — and don't drive the retry loop;
	// ask once for an honest account of how the change was checked. This is the
	// unsatisfiable-loop fix: file-existence checks (`test -f`) can never satisfy a
	// verify gate, so repeating the nag was the observed 8-steer rabbit hole.
	if (gateCmd === null) {
		return steerText(
			"VG_STEER_NO_GATE",
			"[verify-gate] No project gate was detected in this directory, and the files changed this turn have no recorded verification. Say how you verified the change, or that there is no gate to run here.",
			{},
		);
	}
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
			"[verify-gate] The exact gate {gate} is red after the latest mutation. Fix the evidence, then call verify_project before handoff.{ctn}",
			{ gate: g, ctn },
		);
	}
	return steerText(
		"VG_STEER",
		"[verify-gate] The exact gate {gate} has not passed after the latest mutation. Call verify_project before handoff.{ctn}",
		{ gate: g, ctn },
	);
}

export default function (pi: ExtensionAPI) {
	if (!ENABLED) return;
	const order = new VerificationOrderClock();
	const frontier = new VerificationFrontierTracker();
	const plateau = new VerificationPlateauTracker();
	const pendingExactGates = new Set<string>();
	let failedSinceTurnEnd = false;
	let frontierSettled = false;
	let currentTurn = 0;
	let plateauCorrections = 0;
	let plateauActivationRequests = 0;
	let mutationGeneration = 0;
	// Reload-surviving, and it has to be. This records "*I* hid verify_project", which
	// is the permission to put it back — the flag exists so the harness never
	// re-activates a tool the USER disabled. Held in the closure it was false again
	// after every /reload, so the `else if` below could not fire: a session that
	// started without a gate, then gained one (a justfile added, then /reload), kept
	// verify_project hidden for the rest of the process while verify-gate's own steer
	// went on demanding the model call it. Same class as audit A1, same remedy.
	const hiddenFlag = () => {
		const shared = globalThis as Record<string, unknown>;
		return {
			get: () => shared.__pi_vg_managed_hidden_v1 === true,
			set: (value: boolean) => { shared.__pi_vg_managed_hidden_v1 = value; },
		};
	};
	const mutationStartState = new Map<string, { generation: number; mutated: boolean; verifiedOk: boolean; fires: number }>();
	const preventedBeforeStart = new Set<string>();
	const verifyProjectResults = new Map<string, GateResult>();
	const trimOldest = (collection: Map<string, unknown> | Set<string>, maximum: number): void => {
		while (collection.size > maximum) {
			const oldest = collection.keys().next().value as string | undefined;
			if (oldest === undefined) break;
			collection.delete(oldest);
		}
	};

	pi.registerTool(defineTool({
		name: "verify_project",
		label: "Verify Project",
		description: "Run the exact detected project verification gate after the latest source mutation.",
		promptSnippet: "verify_project(): run the exact project gate without shell wrapping",
		promptGuidelines: [
			"Use verify_project after the latest source mutation; do not wrap the project gate in Bash syntax.",
		],
		parameters: Type.Object({}),
		async execute(toolCallId, _params, signal, _onUpdate, ctx) {
			if (!gateCmd) throw new Error("verify_project unavailable: no exact project gate was detected");
			const result = await runReadonlyGate(pi.exec.bind(pi), ctx.cwd, gateCmd, 600_000, signal);
			verifyProjectResults.set(toolCallId, result);
			trimOldest(verifyProjectResults as Map<string, unknown>, 128);
			if (!result.pass) {
				const diagnostic = safeGateDiagnostic(gateCmd, result);
				throw new Error(renderSafeGateFailure({
					diagnostic,
					requiredNextAction: "fix the implementation using this bounded evidence, then call verify_project again",
				}));
			}
			return { content: [{ type: "text" as const, text: "Exact project gate passed after the latest mutation." }], details: { tool_name: "verify_project", success: true } };
		},
	}));

	subscribeOnce("verify-gate:domain-signal", () => onHarnessSignal(pi.events, (signal) => {
		if (signal.type !== "tool/prevented") return;
		const start = mutationStartState.get(signal.toolCallId);
		const kind = order.prevent(signal.toolCallId);
		if (!kind) {
			preventedBeforeStart.add(signal.toolCallId);
			trimOldest(preventedBeforeStart, 128);
			return;
		}
		pendingExactGates.delete(signal.toolCallId);
		mutationStartState.delete(signal.toolCallId);
		if (kind === "source_mutation" && start && start.generation === mutationGeneration && !order.hasPendingMutations()) {
			st.verifiedOk = start.verifiedOk;
			st.mutated = start.mutated;
			st.fires = start.fires;
		}
	}));

	const currentPlanItemHash = (): string | null => {
		const value = (globalThis as Record<string, unknown>).__pi_active_plan_context as { item_id?: unknown } | undefined;
		return typeof value?.item_id === "string" && value.item_id ? planItemHash(value.item_id) : null;
	};
	const exactGateHash = (): string | null => gateCmd
		? sha256(`gate:${normalizeVerificationCommand(gateCmd)}`) : null;
	const plateauMessage = (streak: number): string =>
		`[verification-plateau] Observed: the exact gate's TAP frontier did not advance after ${streak} successful mutation-and-gate epochs for this plan item. Next: obtain one discriminating fact that separates another local patch from a subsystem-level correction.`;

	const publishFrontier = (snapshot: VerificationFrontierSnapshotV1 = frontier.snapshot()): void => {
		(globalThis as Record<string, unknown>).__pi_verification_frontier_state = snapshot;
	};

	const classifyStart = async (toolName: string, args: Record<string, unknown>): Promise<OrderedCallKind> => {
		const isToolMutation = MUTATION_TOOLS.has(toolName);
		const sourceMutation = isToolMutation ||
			(toolName === "bash" && isSourceMutation(String(args.command ?? "")));
		if (sourceMutation) {
			// An edit/write/multiedit provably outside the session cwd does not arm the
			// gate (see pathOutsideCwd). Missing/unresolvable paths stay armed.
			if (isToolMutation && await pathOutsideCwd(args.path)) return "other";
			return "source_mutation";
		}
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
		frontier.reset();
		plateau.reset();
		pendingExactGates.clear();
		frontierSettled = false;
		failedSinceTurnEnd = false;
		currentTurn = 0;
		plateauCorrections = 0;
		plateauActivationRequests = 0;
		clearDetectedProjectGate();
		mutationGeneration = 0;
		mutationStartState.clear();
		preventedBeforeStart.clear();
		verifyProjectResults.clear();
		// The published globalThis snapshot must die with the session, not just the
		// module state: pi's loader returns the CACHED factory across session
		// replacement, so without this a /new, /fork or same-cwd /resume leaked the
		// PREVIOUS session's verify verdict into the c48 lens. Same fix as
		// loop-breaker's __pi_lb_state and plan-runner's __pi_active_plan_context.
		delete (globalThis as Record<string, unknown>).__pi_vg_state;
		delete (globalThis as Record<string, unknown>).__pi_verification_frontier_state;
		const cwd = ctx?.cwd || process.cwd();
		sessionCwd = cwd;
		try { canonicalSessionCwd = await realpath(cwd); }
		catch { canonicalSessionCwd = resolve(cwd); }
		composeProject = await hasComposeFile(cwd);
		if (!process.env.VERIFY_GATE_CMD) {
			gateCmd = await detectProjectGate(cwd);
		}
		publishDetectedProjectGate(cwd, gateCmd);
		const active = pi.getActiveTools();
		if (!gateCmd && active.includes("verify_project")) {
			pi.setActiveTools(active.filter((name) => name !== "verify_project"));
			hiddenFlag().set(true);
		} else if (gateCmd && hiddenFlag().get() && !active.includes("verify_project") &&
			pi.getAllTools().some((tool) => tool.name === "verify_project")) {
			pi.setActiveTools([...active, "verify_project"]);
			hiddenFlag().set(false);
		}
		publishFrontier();
	});

	pi.on("turn_start", async (event) => {
		currentTurn = event.turnIndex;
		if (PLATEAU_MODE !== "off") plateau.notePlanItem(currentPlanItemHash());
	});

	pi.on("tool_execution_start", async (event) => {
		if (!EXECUTION_ORDER) return;
		if (PLATEAU_MODE !== "off") plateau.notePlanItem(currentPlanItemHash());
		frontier.noteToolCall();
		publishFrontier();
		const args = event.args && typeof event.args === "object"
			? event.args as Record<string, unknown> : {};
		if (event.toolName === "verify_project" || (event.toolName === "bash" && verificationEvidence(String(args.command ?? ""), gateCmd) === "project_gate")) {
			pendingExactGates.add(event.toolCallId);
			trimOldest(pendingExactGates, 128);
		}
		const kind = event.toolName === "verify_project" ? "verification" : await classifyStart(event.toolName, args);
		order.start({ callId: event.toolCallId, kind });
		if (kind === "source_mutation") {
			mutationStartState.set(event.toolCallId, { generation: mutationGeneration, mutated: st.mutated, verifiedOk: st.verifiedOk, fires: st.fires });
			trimOldest(mutationStartState as Map<string, unknown>, 512);
			st.mutated = true;
			st.verifiedOk = false;
			st.fires = 0;
		}
		if (preventedBeforeStart.delete(event.toolCallId)) {
			const start = mutationStartState.get(event.toolCallId);
			const preventedKind = order.prevent(event.toolCallId);
			mutationStartState.delete(event.toolCallId);
			pendingExactGates.delete(event.toolCallId);
			if (preventedKind === "source_mutation" && start && start.generation === mutationGeneration && !order.hasPendingMutations()) {
				st.verifiedOk = start.verifiedOk;
				st.mutated = start.mutated;
				st.fires = start.fires;
			}
		}
	});

	pi.on("tool_execution_end", async (event) => {
		if (!EXECUTION_ORDER) return;
		const kind = order.kindFor(event.toolCallId);
		if (!kind) {
			pendingExactGates.delete(event.toolCallId);
			return; // A missing start can never manufacture verification or frontier progress.
		}

		const verifyProjectResult = verifyProjectResults.get(event.toolCallId);
		verifyProjectResults.delete(event.toolCallId);
		const resultText = verifyProjectResult?.output ?? boundedReceiptText(event.result);
		let succeeded = verifyProjectResult ? verifyProjectResult.pass : !event.isError;
		if (kind === "verification") {
			succeeded = succeeded && !looksFailingOutput(resultText, false);
		}

		const outcome = order.finish({
			callId: event.toolCallId,
			succeeded,
		});
		applyOrderedOutcome(outcome);
		if (outcome?.mutationSettled) {
			mutationGeneration += 1;
			mutationStartState.delete(event.toolCallId);
			frontier.noteMutationSettled(!event.isError);
			if (PLATEAU_MODE !== "off" && !event.isError) {
				const gateHash = exactGateHash();
				const itemHash = currentPlanItemHash();
				plateau.noteSuccessfulMutation(gateHash && itemHash ? { gateHash, planItemHash: itemHash } : null);
			}
		}
		if (outcome && pendingExactGates.has(event.toolCallId)) {
			const observation = frontier.observeExactGateDetailed({
				text: verifyProjectResult?.output ?? boundedReceiptTailText(event.result),
				passed: outcome.verificationPassed,
				ordered: outcome.verificationOrdered,
			});
			if (PLATEAU_MODE !== "off") {
				const gateHash = exactGateHash();
				if (gateHash) {
					const itemHash = currentPlanItemHash();
					const plateauObservation = plateau.observeExactGate({
						gateHash, planItemHash: itemHash, recognized: observation.recognized,
						passed: outcome.verificationPassed, ordered: outcome.verificationOrdered,
						advanced: observation.advanced,
					});
					if (plateauObservation.reached !== null && itemHash) {
						record("verification-plateau", "observed", {
							mode: PLATEAU_MODE, streak: plateauObservation.streak,
							gate_hash: gateHash, plan_item_hash: itemHash,
						});
					}
					if (PLATEAU_MODE === "enforce" && plateauObservation.reached === 3) {
						const message = plateauMessage(plateauObservation.streak);
						// The tier-1 correction reaches the model ONLY through the control
						// arbiter (legacyActed: false below -- unlike loop-breaker, there is
						// no self-delivery fallback). Under CONTROL_ARBITER=shadow|off the
						// proposal is recorded and dropped, so counting the message length
						// as injected_chars reported an intervention that never happened
						// (2026-08-21). Report what was delivered, not what was composed.
						const delivered = controlEnforces(pi.events);
						plateauCorrections += delivered ? 1 : 0;
						record("verification-plateau", "intervention", {
							tier: 1, streak: plateauObservation.streak,
							injected_chars: delivered ? message.length : 0,
							activation_requested: false,
							delivered, arbiter: controlArbiterMode(),
						});
						emitControlProposal(pi.events, buildControlProposal({
							boundarySequence: currentTurn, kind: "failure_recovery",
							reason: "verification_plateau", source: "verify-gate",
							cooldownKey: `verification-plateau:${gateHash}:${itemHash}`,
							messageFactory: "verification-plateau", legacyActed: false,
						}), { message });
					}
					if (PLATEAU_MODE === "enforce" && plateauObservation.reached === 5) {
						// Tier 2 emits a capability signal, not a message, so it is
						// delivered independently of the arbiter.
						let available = false;
						try { available = pi.getAllTools().some((tool) => tool.name === "subagent"); }
						catch { available = false; }
						if (available) {
							plateauActivationRequests += 1;
							emitHarnessSignal(pi.events, { v: 1, type: "capability/need", capability: "subagent", reason: "recovery" });
						}
						record("verification-plateau", "intervention", {
							tier: 2, streak: plateauObservation.streak, injected_chars: 0,
							activation_requested: available,
							delivered: available, arbiter: controlArbiterMode(),
						});
					}
				}
			}
		}
		pendingExactGates.delete(event.toolCallId);
		publishFrontier();
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
				const kind = await classifyStart(c.name, c.args);
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
			}
		} else {
			for (const c of toolCalls) {
				const sourceMutation = (MUTATION_TOOLS.has(c.name) && !await pathOutsideCwd(c.args.path)) ||
					(c.name === "bash" && isSourceMutation(String(c.args.command ?? "")));
				if (sourceMutation) {
					st.mutated = true;
					st.verifiedOk = false;
					st.fires = 0;
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
		// A delivered steer ALWAYS triggers a fresh model turn (pi's sendUserMessage
		// contract), so a wrap-up nag whose reply is another text-only turn re-fires
		// this same condition: nag → prose reply → nag, appended AFTER the user's real
		// final answer until the caps ran out (observed live 2026-08-25 — the answer
		// had to be found by scrolling past the tail). The harness's own doctrine
		// applies to itself: a repeated steer with no new evidence between firings is
		// a spiral. A second nag therefore requires at least one tool call (a mutation
		// or a gate attempt) since the last one; a prose-only reply ends the nagging,
		// and the non-turn-triggering agent_end warning stays the honest terminal state.
		if (!wrappingUp) st.nagAwaitingEvidence = false;
		// With no detectable project gate there is nothing to retry against, so a single
		// honest nudge is right — repeating it was the unsatisfiable 8-steer loop. A
		// detected gate keeps the full MAX_FIRES × 3 session backstop.
		const sessionCap = gateCmd === null ? 1 : MAX_FIRES * 3;
		if (wrappingUp && !st.nagAwaitingEvidence && st.mutated && !st.verifiedOk && st.fires < MAX_FIRES && st.sessionFires < sessionCap && !planPhaseActive()) {
			st.fires += 1;
			st.sessionFires += 1;
			st.nagAwaitingEvidence = true;
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

	pi.on("agent_start", async () => { frontierSettled = false; });

	// Re-armed per AGENT RUN, not per session. `agent_settled` fires once per run, so
	// a latch reset only at session_start let exactly the FIRST run of a session emit
	// its settled row and silently dropped every run after it — a longitudinal
	// undercount equal to the number of turns in a session. run-kernel.ts:381-383 is
	// the correct in-repo shape (it keys the latch on the current cycle identity and
	// re-mints that at agent_start); this is the same idea with the simpler key.
	pi.on("agent_settled", async () => {
		if (frontierSettled) return;
		frontierSettled = true;
		const snapshot = frontier.snapshot();
		record("verification-frontier", "settled", {
			protocol: snapshot.protocol,
			recognized_gates: snapshot.recognizedGates,
			current_passed: snapshot.current?.passed ?? null,
			current_failed: snapshot.current?.failed ?? null,
			current_skipped: snapshot.current?.skipped ?? null,
			current_total: snapshot.current?.total ?? null,
			best_passed: snapshot.best?.passed ?? null,
			best_failed: snapshot.best?.failed ?? null,
			best_skipped: snapshot.best?.skipped ?? null,
			best_total: snapshot.best?.total ?? null,
			last_advanced: snapshot.lastAdvanced,
			plateau_streak: snapshot.plateauStreak,
			successful_mutation_epochs_since_advance: snapshot.successfulMutationEpochsSinceAdvance,
			verification_plateau_overrun: snapshot.verificationPlateauOverrun,
		});
		if (PLATEAU_MODE !== "off") {
			const plateauSnapshot = plateau.snapshot();
			record("verification-plateau", "settled", {
				mode: PLATEAU_MODE,
				eligible_epochs: plateauSnapshot.eligibleEpochs,
				plateau_events: plateauSnapshot.plateauEvents,
				max_streak: plateauSnapshot.maxStreak,
				frontier_advances: plateauSnapshot.frontierAdvances,
				current_streak: plateauSnapshot.currentStreak,
				pending_successful_mutation: plateauSnapshot.pendingSuccessfulMutation,
				corrections: plateauCorrections,
				activation_requests: plateauActivationRequests,
			});
		}
	});
}
