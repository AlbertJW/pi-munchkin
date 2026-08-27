import { subscribeOnce } from "../lib/extension-lifecycle.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { agentDir } from "../lib/agent-dir.ts";
import { isEffectiveResume } from "../lib/session-resume.ts";
import {
	CapsuleCheckpointQueue, latestRunStateEntry, makeRunStateEntry, newCapsuleId,
	readLatestRunCapsule, RUN_STATE_ENTRY_TYPE, runCapsuleMode, writeRunCapsule,
} from "../lib/run-capsule-store.ts";
import { renderRunCapsule, renderRunStatus } from "../lib/run-capsule-renderer.ts";
import { renderRecoveryBrief } from "../lib/recovery-brief.ts";
import { onRunStateSnapshot } from "../lib/run-kernel-snapshot.ts";
import { emitHarnessSignal, onHarnessSignal } from "../lib/harness-signals.ts";
import type { RunStateV1 } from "../lib/run-kernel-types.ts";
import { record } from "../lib/telemetry.ts";
import { goalsEnabled, readGoal, renderGoalRecoveryBrief } from "../lib/goal-state.ts";

export default function (pi: ExtensionAPI): void {
	const mode = runCapsuleMode();
	if (mode === "off") return;
	let cwd = process.cwd();
	let capsuleId = newCapsuleId();
	let currentRunIdHash: string | null = null;
	let currentGeneration = -1;
	let latestState: RunStateV1 | null = null;
	let queue: CapsuleCheckpointQueue | null = null;
	let sessionReady = false;
	let phaseDirty = false;
	let lastEntryKey: string | null = null;
	let pendingCompactionGeneration: number | null = null;
	let pendingProviderRecovery = false;

	function publishIdentity(): void {
		(globalThis as Record<string, unknown>).__pi_run_capsule_identity = { cwd, capsuleId, runIdHash: currentRunIdHash };
	}

	function createQueue(): CapsuleCheckpointQueue {
		const boundCwd = cwd;
		const boundCapsuleId = capsuleId;
		return new CapsuleCheckpointQueue(async (state) => {
			const result = await writeRunCapsule({
				agentDirectory: agentDir(),
				cwd: boundCwd,
				capsuleId: boundCapsuleId,
				state,
				markdown: renderRunCapsule(state),
			});
			record("run-capsule", "checkpoint", {
				ok: result.ok,
				state_bytes: result.stateBytes,
				markdown_bytes: result.markdownBytes,
				failure_class: result.failureClass,
			});
			return result;
		});
	}

	function request(state: RunStateV1, phase: boolean): void {
		const snapshot = structuredClone(state);
		latestState = snapshot;
		if (snapshot.identity.generation !== currentGeneration && snapshot.lifecycle.state === "starting") {
			currentGeneration = snapshot.identity.generation;
			sessionReady = false;
			return;
		}
		if (!sessionReady) return;
		if (currentRunIdHash !== snapshot.identity.runIdHash) {
			currentRunIdHash = snapshot.identity.runIdHash;
			capsuleId = newCapsuleId();
			queue = createQueue();
			publishIdentity();
			emitHarnessSignal(pi.events, { v: 1, type: "capsule/identity" });
		}
		phaseDirty ||= phase;
		(queue ??= createQueue()).request(snapshot);
	}

	subscribeOnce("run-capsule:run-state-snapshot", () => onRunStateSnapshot(pi.events, (event) => request(event.state, event.reason === "phase")));

	pi.on("session_start", async (event, ctx) => {
		cwd = ctx.cwd ?? process.cwd();
		let restored = null;
		if (isEffectiveResume(event, ctx)) {
			try { restored = latestRunStateEntry(ctx.sessionManager.getBranch()); } catch { /* private fallback */ }
			if (!restored) restored = await readLatestRunCapsule(agentDir(), cwd);
		}
		if (restored && latestState && restored.state.identity.runIdHash === latestState.identity.runIdHash) {
			capsuleId = restored.capsuleId;
		} else capsuleId = newCapsuleId();
		currentRunIdHash = latestState?.identity.runIdHash ?? null;
		queue = createQueue();
		publishIdentity();
		// plan-runner's session_start ran BEFORE this handler (extension order), so
		// its adaptive-mode disk rebind could not see the identity above. Announce
		// it so private plan state gets one deterministic re-read.
		emitHarnessSignal(pi.events, { v: 1, type: "capsule/identity" });
		sessionReady = true;
		phaseDirty = false;
		lastEntryKey = null;
		pendingCompactionGeneration = null;
		pendingProviderRecovery = false;
		if (latestState) queue.request(latestState);
	});

	async function flushPhase(): Promise<void> {
		if (!phaseDirty) return;
		phaseDirty = false;
		await queue?.flush();
	}

	// These handlers are registered after Run Kernel. A phase transition caused
	// by the same event is therefore checkpointed before that Pi boundary returns.
	pi.on("tool_execution_start", flushPhase);
	pi.on("tool_execution_end", flushPhase);
	pi.on("turn_end", flushPhase);
	// THE COMPACTION -> RESUME CONTRACT (AVO's "resume from the current state
	// rather than reconstruct the search", adopted-as-docs 2026-08-24): every
	// compaction marks the pending generation here, and under recovery mode the
	// NEXT context assembly injects one bounded recovery brief rendered from the
	// private capsule (reason "compaction"; provider retries use the same channel
	// with reason "provider_retry"). Shadow mode keeps the checkpoint and skips
	// the injection -- persistence is never lost, only the resume hint.
	pi.on("session_compact", async () => {
		await flushPhase();
		if (mode === "recovery" && latestState) pendingCompactionGeneration = latestState.context.compactionGeneration;
	});

	pi.on("agent_end", async () => {
		if (mode !== "recovery" || !latestState) return;
		pendingProviderRecovery = latestState.lifecycle.state === "settling" && latestState.failures.lastClass === "provider";
	});

	pi.on("agent_settled", async () => {
		pendingProviderRecovery = false;
		pendingCompactionGeneration = null;
	});

	if (mode === "recovery") {
		pi.on("context", async (event, ctx) => {
			if (!latestState) return;
			const reason = pendingCompactionGeneration !== null ? "compaction" : pendingProviderRecovery ? "provider_retry" : null;
			if (!reason) return;
			pendingCompactionGeneration = null;
			pendingProviderRecovery = false;
			const goalBrief = goalsEnabled() ? renderGoalRecoveryBrief(await readGoal(ctx.cwd)) : "";
			const brief = `${renderRecoveryBrief(latestState, { reason })}${goalBrief ? `\n${goalBrief}` : ""}`;
			record("run-capsule", "recovery-brief", { reason, brief_bytes: Buffer.byteLength(brief, "utf8"), generation: latestState.context.compactionGeneration });
			return {
				messages: [...event.messages, {
					role: "custom" as const,
					customType: "pi-munchkin:recovery-brief",
					content: brief,
					display: false,
					details: { reason },
					timestamp: Date.now(),
				}] as typeof event.messages,
			};
		});
	}

	subscribeOnce("run-capsule:domain-signal", () => onHarnessSignal(pi.events, (signal) => {
		if (mode !== "recovery" || signal.type !== "recovery/resumed" || !latestState) return;
		const brief = renderRecoveryBrief(latestState, { reason: "manual_resume" });
		try {
			pi.sendMessage({
				customType: "pi-munchkin:recovery-brief",
				content: brief,
				display: true,
				details: { origin: signal.origin, cleared: signal.cleared, blocked: signal.blocked },
			}, { triggerTurn: false, deliverAs: "nextTurn" });
			record("run-capsule", "recovery-brief", { reason: "manual_resume", brief_bytes: Buffer.byteLength(brief, "utf8"), generation: latestState.context.compactionGeneration });
		} catch {
			record("run-capsule", "recovery-brief", { reason: "manual_resume", brief_bytes: 0, generation: latestState.context.compactionGeneration });
		}
	}));

	pi.on("agent_settled", async () => {
		await queue?.flush();
		if (!latestState) return;
		const entryKey = [
			latestState.identity.generation,
			latestState.identity.cycleIdHash ?? "none",
			latestState.lifecycle.lastTransitionSequence,
			latestState.outcome.status,
		].join(":");
		if (lastEntryKey === entryKey) return;
		const entry = makeRunStateEntry(capsuleId, latestState);
		if (!entry) {
			record("run-capsule", "entry", { ok: false, failure_class: "unknown", state_bytes: 0 });
			return;
		}
		try {
			pi.appendEntry(RUN_STATE_ENTRY_TYPE, entry);
			lastEntryKey = entryKey;
			record("run-capsule", "entry", {
				ok: true,
				failure_class: null,
				state_bytes: Buffer.byteLength(JSON.stringify(entry.state), "utf8"),
			});
		} catch {
			record("run-capsule", "entry", {
				ok: false,
				failure_class: "unknown",
				state_bytes: Buffer.byteLength(JSON.stringify(entry.state), "utf8"),
			});
		}
	});

	pi.on("session_shutdown", async () => {
		await queue?.flush();
		sessionReady = false;
	});

	pi.registerCommand("run-status", {
		description: "Show a bounded read-only summary of the authoritative Run Kernel state.",
		handler: async (_args, ctx) => {
			const text = latestState ? renderRunStatus(latestState) : "Run state unavailable (Run Kernel is off or has not started).";
			if (ctx.hasUI) ctx.ui.notify(text, "info");
		},
	});

	if (mode === "recovery") {
		pi.registerCommand("run-resume", {
			description: "Clear recovery walls and append one deterministic private recovery brief without starting a model turn.",
			handler: async () => {
				emitHarnessSignal(pi.events, { v: 1, type: "recovery/resume-requested", origin: "run-command" });
			},
		});
	}
}
