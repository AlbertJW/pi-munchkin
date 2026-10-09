import { interventionReceipt } from "../lib/intervention-receipts.ts";
import { continuationDraft, dispatchIdleContinuation, onActionableSettlement, type ContinuationBoundaryResult } from "../lib/pi-compatibility.ts";
import { subscribeOnce } from "../lib/extension-lifecycle.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ControlArbiterQueue } from "../lib/control-arbiter.ts";
import {
	controlArbiterMode, emitControlDecision, onControlProposal, setControlArbiterActive,
} from "../lib/control-proposal.ts";
import {
	continuationBudget, continuationOwnerKey, continuationReceipts, deliveredOwnerGenerations, hashContinuationIdentity,
	replaceContinuationAuthority, setContinuationDispatcherActive, type ContinuationEnvelope,
} from "../lib/continuation-authority.ts";
import { record } from "../lib/telemetry.ts";
import { currentCompactionOwner } from "../lib/compaction-coordinator.ts";

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
	let actionableBoundary: ContinuationBoundaryResult | null = null;
	// One delivery per owner revision (goal id + goal revision, plan run, commit...),
	// whichever producer offered it first: compaction resume and goal continuation
	// for the same goal revision coalesce instead of costing two provider turns.
	let deliveredOwners = new Set<string>();
	// Per user-initiated turn: how many provider turns the harness itself started.
	const budget = continuationBudget();
	let turnContinuations = 0;
	let turnStartedAt = Date.now();
	let harnessStartedRun = false;
	let budgetNoticeSent = false;
	// An aborted run stays stopped until the user sends something new.
	let stoppedByAbort = false;
	let notify: ((message: string) => void) | null = null;
	let compactionAbort = false;
	// ctx.compact() aborts the active run before compacting; that abort belongs to
	// the harness, and its compaction resume is legitimate. Pi native compaction
	// reports through session_before_compact as well.
	const userAbort = (aborted: boolean): boolean => aborted && !compactionAbort && currentCompactionOwner() === null;

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
			if (pending.length > 0 && stoppedByAbort) {
				record("control-arbiter", "continuation", { reason: pending[0].request.reason, outcome: "rejected_after_abort", contenders: pending.length });
				return;
			}
			if (pending.length > 0 && (turnContinuations >= budget.max || Date.now() - turnStartedAt > budget.windowMs)) {
				record("control-arbiter", "continuation", { reason: pending[0].request.reason, outcome: "budget_exhausted", contenders: pending.length });
				if (!budgetNoticeSent) {
					budgetNoticeSent = true;
					try { notify?.(`pi-munchkin: stopped automatic continuation after ${turnContinuations} harness-started turn(s) for this request. Send a message to continue.`); } catch { /* stale ui */ }
				}
				return;
			}
			const candidates = pending
				.filter(({ request }) => request.session_id_hash === sessionIdHash && request.expires_at_ms >= Date.now() &&
					!deliveredContinuations.has(request.idempotency_key) && !deliveredOwners.has(continuationOwnerKey(request)))
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
				if (!authorized || !continuationLive || agentActive || candidate.request.session_id_hash !== sessionIdHash || candidate.request.expires_at_ms < Date.now()) {
					record("control-arbiter", "continuation", {
						reason: candidate.request.reason, outcome: "rejected", contenders: candidates.length,
					});
					if (!continuationLive) return;
					continue;
				}
				deliveredContinuations.add(candidate.request.idempotency_key);
				deliveredOwners.add(continuationOwnerKey(candidate.request));
				turnContinuations += 1;
				pi.appendEntry("pi-munchkin:continuation-receipt/v1", {
					v: 1,
					idempotency_key: candidate.request.idempotency_key,
					session_id_hash: sessionIdHash,
					delivered_at_ms: Date.now(),
					owner_id_hash: candidate.request.owner_id_hash,
					generation: candidate.request.generation,
				});
				record("control-arbiter", "continuation", {
					reason: candidate.request.reason, outcome: "delivered", contenders: candidates.length,
				});
				// Inside agent_before_settle the continuation is one more request in the
				// same run. A late offer (after agent_settled, e.g. a delegated result)
				// starts a new run, which before_agent_start must not count as a user turn.
				dispatched = true;
				if (actionableBoundary) { actionableBoundary.entries.push(continuationDraft(candidate.request.message)); actionableBoundary.continue = true; }
				else { harnessStartedRun = true; dispatchIdleContinuation(pi, candidate.request.message); }
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

	subscribeOnce(pi.events, "control-arbiter:control-proposal", () => onControlProposal(pi.events, (event) => { queue.add(event); pi.appendEntry("pi-munchkin:intervention/v1", interventionReceipt(pi.events, event.proposal, "proposed", null)); }));
	// Continuation ownership is per Pi event bus. Unlike reloads, isolated
	// AgentSessions legitimately have distinct buses in one process, so do not
	// share this subscription through the reload-only subscription registry.
	const continuationHandler = (envelope: ContinuationEnvelope): void => {
		if (!continuationLive || !sessionIdHash) return;
		// Keep mismatched envelopes until the bounded flush, where the session
		// identity filter rejects them. This avoids depending on load-order timing
		// while still making a foreign/stale session incapable of dispatch.
		pendingContinuations.push(envelope);
		scheduleContinuationFlush();
	};
	let disposeContinuation = replaceContinuationAuthority(pi.events, continuationHandler);
	pi.on("session_start", async (_event, ctx) => {
		continuationLifecycleGeneration += 1;
		continuationFlushScheduled = false;
		continuationFlushInFlight = false;
		queue.clear();
		continuationLive = true;
		sessionIdHash = hashContinuationIdentity(ctx.sessionManager?.getSessionId?.() ?? `compat:${ctx.cwd}`);
		deliveredContinuations = continuationReceipts(ctx.sessionManager?.getEntries?.() ?? [], sessionIdHash);
		deliveredOwners = deliveredOwnerGenerations(ctx.sessionManager?.getEntries?.() ?? [], sessionIdHash);
		notify = (message) => ctx.ui.notify(message, "warning");
		turnContinuations = 0; turnStartedAt = Date.now(); harnessStartedRun = false; budgetNoticeSent = false; stoppedByAbort = false; compactionAbort = false;
		pendingContinuations = [];
		// Pi may reuse this extension instance for /new, /fork, or a same-cwd
		// resume after session_shutdown. Rebind both shared authorities instead of
		// leaving producers on the legacy direct-send path for the new session.
		disposeContinuation();
		disposeContinuation = replaceContinuationAuthority(pi.events, continuationHandler);
		setControlArbiterActive(pi.events, mode === "enforce");
		setContinuationDispatcherActive(pi.events, true);
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
	pi.on("session_before_compact", async () => { compactionAbort = true; stoppedByAbort = false; });
	pi.on("session_compact", async () => { compactionAbort = false; stoppedByAbort = false; });
	pi.on("before_agent_start", async () => {
		// A run the harness started is part of the current user turn; anything else is new user input.
		if (harnessStartedRun) { harnessStartedRun = false; return; }
		turnContinuations = 0; turnStartedAt = Date.now(); budgetNoticeSent = false; stoppedByAbort = false; compactionAbort = false;
	});
	pi.on("agent_start", async () => {
		agentActive = true;
		queue.clear();
	});
	onActionableSettlement(pi, async event => {
		agentActive = false;
		if (event.outcome !== "completed") { stoppedByAbort = userAbort(event.outcome === "aborted"); pendingContinuations = []; return undefined; }
		const boundary: ContinuationBoundaryResult = { entries: [], continue: false };
		actionableBoundary = boundary;
		try { await flushContinuations(); } finally { actionableBoundary = null; }
		return boundary.continue ? boundary : undefined;
	});
	// Final, notification-only boundary: handles late idle offers (delegated
	// results, drift review). Pi 1.1+ reports aborts here too.
	pi.on("agent_settled", async (event) => {
		agentActive = false;
		if (userAbort((event as { aborted?: unknown }).aborted === true)) stoppedByAbort = true;
		if (stoppedByAbort) { pendingContinuations = []; return; }
		if (pendingContinuations.length > 0) scheduleContinuationFlush();
	});
	pi.on("turn_end", async (event) => {
		const { decision, delivery, lensMerged, verificationMerged } = queue.decide(event.turnIndex, mode);
		if (decision.proposalCount === 0) return;
		const winner = decision.winner;
		if (winner) pi.appendEntry("pi-munchkin:intervention/v1", interventionReceipt(pi.events, winner, "selected", null));
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
			try {
				await pi.sendUserMessage(delivery.message.slice(0, 4000), { deliverAs: "steer" });
				pi.appendEntry("pi-munchkin:intervention/v1", interventionReceipt(pi.events, winner, "dispatch-accepted", null));
			} catch (error) {
				pi.appendEntry("pi-munchkin:intervention/v1", interventionReceipt(pi.events, winner, "dispatch-rejected", null));
				throw error;
			}
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
