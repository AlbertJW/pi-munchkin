import type { ControlArbiterMode, ControlDecisionV1, ControlProposalEnvelope } from "./control-proposal.ts";

const MAX_PENDING = 128;
const MAX_MESSAGE_CHARS = 4000;

export class ControlArbiterQueue {
	private readonly pending = new Map<number, ControlProposalEnvelope[]>();

	clear(): void {
		this.pending.clear();
	}

	add(envelope: ControlProposalEnvelope): void {
		const boundary = envelope.proposal.boundarySequence;
		const bucket = this.pending.get(boundary) ?? [];
		if (bucket.some(({ proposal }) => proposal.proposalIdHash === envelope.proposal.proposalIdHash)) return;
		bucket.push({
			proposal: envelope.proposal,
			delivery: {
				message: typeof envelope.delivery.message === "string" ? envelope.delivery.message.slice(0, MAX_MESSAGE_CHARS) : undefined,
				abort: typeof envelope.delivery.abort === "function" ? envelope.delivery.abort : undefined,
				shutdown: typeof envelope.delivery.shutdown === "function" ? envelope.delivery.shutdown : undefined,
			},
		});
		this.pending.set(boundary, bucket);
		let total = [...this.pending.values()].reduce((count, entries) => count + entries.length, 0);
		while (total > MAX_PENDING) {
			const oldestBoundary = this.pending.keys().next().value as number | undefined;
			if (oldestBoundary === undefined) break;
			const oldest = this.pending.get(oldestBoundary);
			oldest?.shift();
			if (!oldest || oldest.length === 0) this.pending.delete(oldestBoundary);
			total -= 1;
		}
	}

	decide(boundarySequence: number, mode: ControlArbiterMode): {
		decision: ControlDecisionV1;
		delivery: ControlProposalEnvelope["delivery"] | null;
		lensMerged: boolean;
		verificationMerged: boolean;
	} {
		const proposals = this.pending.get(boundarySequence) ?? [];
		this.pending.delete(boundarySequence);
		const terminalRank = ({ proposal }: ControlProposalEnvelope): number =>
			proposal.effect === "abort" || proposal.effect === "shutdown" ? 1 : 0;
		const ranked = proposals.map((entry, index) => ({ entry, index })).sort((a, b) =>
			terminalRank(b.entry) - terminalRank(a.entry) ||
			b.entry.proposal.priority - a.entry.proposal.priority || a.index - b.index);
		const winner = ranked[0]?.entry ?? null;
		const verification = mode === "enforce" && winner?.proposal.kind === "failure_recovery" &&
			winner.proposal.effect === "message"
			? proposals.find(({ proposal, delivery }) =>
				proposal.kind === "verification_required" && proposal.source === "verify-gate" &&
				proposal.reason === "exact_gate_missing" && proposal.messageFactory === "verify-wrap" &&
				proposal.effect === "message" &&
				typeof delivery.message === "string" && delivery.message.length > 0)
			: undefined;
		const lens = mode === "enforce" && winner?.proposal.effect === "message" && winner.proposal.reason !== "state_lens"
			? proposals.find(({ proposal, delivery }) =>
				proposal.reason === "state_lens" && proposal.source === "session-blackboard" &&
				proposal.effect === "message" && typeof delivery.message === "string" && delivery.message.length > 0)
			: undefined;
		let delivery = winner?.delivery ?? null;
		let verificationMerged = false;
		if (delivery && verification && typeof delivery.message === "string") {
			const requirement = verification.delivery.message!;
			const separator = "\n\n";
			const available = MAX_MESSAGE_CHARS - requirement.length - separator.length;
			if (available > 0) {
				delivery = { ...delivery, message: `${delivery.message.slice(0, available)}${separator}${requirement}` };
				verificationMerged = true;
			}
		}
		let lensMerged = false;
		if (delivery && lens && typeof delivery.message === "string") {
			const correction = delivery.message;
			const separator = "\n\n";
			const available = MAX_MESSAGE_CHARS - correction.length - separator.length;
			if (available > 0) {
				delivery = { ...delivery, message: `${lens.delivery.message!.slice(0, available)}${separator}${correction}` };
				lensMerged = true;
			}
		}
		// The honest delivered set: the winner plus whichever losers were merged into
		// its text. Empty outside enforce, because outside enforce the arbiter sends
		// nothing — the producers self-deliver and know it from `legacyActed`.
		const delivered = mode === "enforce" && winner
			? [
				winner.proposal.proposalIdHash,
				...(verificationMerged && verification ? [verification.proposal.proposalIdHash] : []),
				...(lensMerged && lens ? [lens.proposal.proposalIdHash] : []),
			]
			: [];
		return {
			decision: {
				v: 1,
				boundarySequence,
				mode,
				proposalCount: proposals.length,
				collisionCount: Math.max(0, proposals.length - 1),
				legacyActionCount: proposals.filter(({ proposal }) => proposal.legacyActed).length,
				winner: winner?.proposal ?? null,
				delivered,
			},
			delivery,
			lensMerged,
			verificationMerged,
		};
	}
}
