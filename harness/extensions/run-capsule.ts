import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { agentDir } from "../lib/agent-dir.ts";
import {
	CapsuleCheckpointQueue, latestRunStateEntry, makeRunStateEntry, newCapsuleId,
	readLatestRunCapsule, RUN_STATE_ENTRY_TYPE, runCapsuleMode, writeRunCapsule,
} from "../lib/run-capsule-store.ts";
import { renderRunCapsule, renderRunStatus } from "../lib/run-capsule-renderer.ts";
import { onRunStateSnapshot } from "../lib/run-kernel-snapshot.ts";
import type { RunStateV1 } from "../lib/run-kernel-types.ts";
import { record } from "../lib/telemetry.ts";

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
		}
		phaseDirty ||= phase;
		(queue ??= createQueue()).request(snapshot);
	}

	onRunStateSnapshot(pi.events, (event) => request(event.state, event.reason === "phase"));

	pi.on("session_start", async (event, ctx) => {
		cwd = ctx.cwd ?? process.cwd();
		let restored = null;
		if (event.reason === "resume" || event.reason === "fork") {
			try { restored = latestRunStateEntry(ctx.sessionManager.getBranch()); } catch { /* private fallback */ }
			if (!restored) restored = await readLatestRunCapsule(agentDir(), cwd);
		}
		if (restored && latestState && restored.state.identity.runIdHash === latestState.identity.runIdHash) {
			capsuleId = restored.capsuleId;
		} else capsuleId = newCapsuleId();
		currentRunIdHash = latestState?.identity.runIdHash ?? null;
		queue = createQueue();
		sessionReady = true;
		phaseDirty = false;
		lastEntryKey = null;
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
	pi.on("session_compact", flushPhase);

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
}
