import { subscribeOnce } from "../lib/extension-lifecycle.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ControlArbiterQueue } from "../lib/control-arbiter.ts";
import {
	controlArbiterMode, emitControlDecision, onControlProposal, setControlArbiterActive,
} from "../lib/control-proposal.ts";
import {
	continuationReceipts, hashContinuationIdentity, replaceContinuationAuthority,
	setContinuationDispatcherActive, type ContinuationEnvelope,
} from "../lib/continuation-authority.ts";
import { record } from "../lib/telemetry.ts";

export default function (pi: ExtensionAPI): void {
	const mode = controlArbiterMode();
	if (mode === "off") {
		setControlArbiterActive(pi.events, false);
		setContinuationDispatcherActive(pi.events, false);
		return;
	}
	const queue = new ControlArbiterQueue();
	let sessionIdHash: string | null = null;
	let deliveredContinuations = new Set<string>();
	let pendingContinuations: ContinuationEnvelope[] = [];
	let continuationFlushScheduled = false;
	let continuationFlushInFlight = false;
	let continuationLifecycleGeneration = 0;
	let continuationLive = true;
	let agentActive = false;

	const flushContinuations = async (): Promise<void> => {
		continuationFlushScheduled = false;
		if (continuationFlushInFlight) return;
		continuationFlushInFlight = true;
		const lifecycleGeneration = continuationLifecycleGeneration;
		let dispatched = false;
		try {
			if (!continuationLive || !sessionIdHash || agentActive) return;
			const pending = pendingContinuations;
			pendingContinuations = [];
			const candidates = pending
				.filter(({ request }) => request.session_id_hash === sessionIdHash && request.expires_at_ms >= Date.now() && !deliveredContinuations.has(request.idempotency_key))
				.map((envelope, index) => ({ envelope, index }))
				.sort((left, right) => right.envelope.request.priority - left.envelope.request.priority || left.index - right.index);
			for (const { envelope: candidate } of candidates) {
				let authorized = false;
				try { authorized = await candidate.authorize(); } catch { authorized = false; }
				if (lifecycleGeneration !== continuationLifecycleGeneration) return;
				// The first read may yield to a user command or a durable child-result
				// commit. Re-read immediately before dispatch so a transition that lands
				// during authorization cannot slip through the cancellation boundary.
				if (authorized) {
					try { authorized = await candidate.authorize(); } catch { authorized = false; }
				}
				if (lifecycleGeneration !== continuationLifecycleGeneration) return;
				if (!authorized || !continuationLive || candidate.request.session_id_hash !== sessionIdHash || candidate.request.expires_at_ms < Date.now()) {
					record("control-arbiter", "continuation", {
						reason: candidate.request.reason, outcome: "rejected", contenders: candidates.length,
					});
					if (!continuationLive) return;
					continue;
				}
				deliveredContinuations.add(candidate.request.idempotency_key);
				pi.appendEntry("pi-munchkin:continuation-receipt/v1", {
					v: 1,
					idempotency_key: candidate.request.idempotency_key,
					session_id_hash: sessionIdHash,
					delivered_at_ms: Date.now(),
				});
				record("control-arbiter", "continuation", {
					reason: candidate.request.reason, outcome: "delivered", contenders: candidates.length,
				});
				// `agent_settled` has made Pi idle before this flush. Starting the next
				// turn here avoids placing an irrevocable message in Pi's private queue;
				// the lifecycle authority has therefore checked the durable state at the
				// exact dispatch boundary.
				// Pi 0.80.6 can report `agent_settled` one event before its
				// sendUserMessage guard observes idle. `followUp` is safe in both
				// states: it queues while still processing and starts immediately
				// once idle, so the receipt cannot be recorded for a lost message.
				dispatched = true;
				void pi.sendUserMessage(candidate.request.message, { deliverAs: "followUp" });
				return;
			}
		} finally {
			// A session reload/shutdown cancels the old generation. Its promise may
			// still settle later, but it must not clear the new generation's lock or
			// reschedule stale offers.
			if (lifecycleGeneration !== continuationLifecycleGeneration) return;
			continuationFlushInFlight = false;
			// Offers arriving while authorization was in flight belong to the same
			// settled boundary. Once one continuation was dispatched they must be
			// discarded, not replayed as a second provider turn. If no candidate was
			// dispatched, retain them for another bounded authorization pass.
			if (dispatched) pendingContinuations = [];
			else if (continuationLive && !agentActive && pendingContinuations.length > 0) scheduleContinuationFlush();
		}
	};

	const scheduleContinuationFlush = (): void => {
		if (continuationFlushScheduled) return;
		continuationFlushScheduled = true;
		queueMicrotask(() => { void flushContinuations(); });
	};

	subscribeOnce("control-arbiter:control-proposal", () => onControlProposal(pi.events, (event) => queue.add(event)));
	// Continuation ownership is per Pi event bus. Unlike reloads, isolated
	// AgentSessions legitimately have distinct buses in one process, so do not
	// share this subscription through the reload-only subscription registry.
	const disposeContinuation = replaceContinuationAuthority(pi.events, (envelope) => {
		if (!continuationLive || !sessionIdHash) return;
		// Keep mismatched envelopes until the bounded flush, where the session
		// identity filter rejects them. This avoids depending on load-order timing
		// while still making a foreign/stale session incapable of dispatch.
		pendingContinuations.push(envelope);
		scheduleContinuationFlush();
	});
	pi.on("session_start", async (_event, ctx) => {
		continuationLifecycleGeneration += 1;
		continuationFlushScheduled = false;
		continuationFlushInFlight = false;
		queue.clear();
		continuationLive = true;
		sessionIdHash = hashContinuationIdentity(ctx.sessionManager?.getSessionId?.() ?? `compat:${ctx.cwd}`);
		deliveredContinuations = continuationReceipts(ctx.sessionManager?.getEntries?.() ?? [], sessionIdHash);
		pendingContinuations = [];
	});
	pi.on("session_shutdown", async () => {
		continuationLifecycleGeneration += 1;
		continuationFlushScheduled = false;
		continuationFlushInFlight = false;
		continuationLive = false;
		pendingContinuations = [];
		disposeContinuation();
		setControlArbiterActive(pi.events, false);
		setContinuationDispatcherActive(pi.events, false);
	});
	pi.on("agent_start", async () => {
		agentActive = true;
		queue.clear();
	});
	// Pi emits this only after every ordered agent_end handler has completed and
	// after marking the run idle. It is the sole automatic-continuation boundary.
	pi.on("agent_settled", async () => {
		agentActive = false;
		if (pendingContinuations.length > 0) scheduleContinuationFlush();
	});
	pi.on("turn_end", async (event) => {
		const { decision, delivery, lensMerged, verificationMerged } = queue.decide(event.turnIndex, mode);
		if (decision.proposalCount === 0) return;
		const winner = decision.winner;
		record("control-arbiter", "decision", {
			mode,
			proposals: decision.proposalCount,
			collisions: decision.collisionCount,
			legacy_actions: decision.legacyActionCount,
			winner_kind: winner?.kind ?? "none",
			winner_source: winner?.source ?? "none",
			winner_reason: winner?.reason ?? "none",
			boundary_sequence: decision.boundarySequence,
			lens_merged: lensMerged,
			verification_merged: verificationMerged,
		});
		emitControlDecision(pi.events, decision);
		if (mode !== "enforce" || !winner || !delivery) return;
		if (winner.effect === "abort") {
			delivery.abort?.();
			return;
		}
		if (winner.effect === "shutdown") {
			delivery.shutdown?.();
			return;
		}
		if (typeof delivery.message === "string" && delivery.message.length > 0) {
			pi.sendUserMessage(delivery.message.slice(0, 4000), { deliverAs: "steer" });
		}
	});
	// Mark enforcement only after the complete subscriber/handler set exists;
	// producers otherwise retain their legacy actions and cannot fail silent.
	setControlArbiterActive(pi.events, mode === "enforce");
	// Continuation ownership is active even when ordinary control proposals are
	// shadowed/off. Its job is not to steer content; it prevents an obsolete
	// queued turn from bypassing the lifecycle authority.
	setContinuationDispatcherActive(pi.events, true);
}
