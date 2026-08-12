import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ControlArbiterQueue } from "../lib/control-arbiter.ts";
import {
	controlArbiterMode, emitControlDecision, onControlProposal, setControlArbiterActive,
} from "../lib/control-proposal.ts";
import { record } from "../lib/telemetry.ts";

export default function (pi: ExtensionAPI): void {
	const mode = controlArbiterMode();
	if (mode === "off") {
		setControlArbiterActive(pi.events, false);
		return;
	}
	const queue = new ControlArbiterQueue();
	onControlProposal(pi.events, (event) => queue.add(event));
	pi.on("session_start", async () => queue.clear());
	pi.on("agent_start", async () => queue.clear());
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
}
