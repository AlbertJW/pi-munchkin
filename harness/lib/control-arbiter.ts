import type { ControlArbiterMode, ControlDecisionV1, ControlProposalEnvelope } from "./control-proposal.ts";

const MAX_PENDING = 128;

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
				message: typeof envelope.delivery.message === "string" ? envelope.delivery.message.slice(0, 4000) : undefined,
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
	} {
		const proposals = this.pending.get(boundarySequence) ?? [];
		this.pending.delete(boundarySequence);
		const ranked = proposals.map((entry, index) => ({ entry, index })).sort((a, b) =>
			b.entry.proposal.priority - a.entry.proposal.priority || a.index - b.index);
		const winner = ranked[0]?.entry ?? null;
		return {
			decision: {
				v: 1,
				boundarySequence,
				mode,
				proposalCount: proposals.length,
				collisionCount: Math.max(0, proposals.length - 1),
				legacyActionCount: proposals.filter(({ proposal }) => proposal.legacyActed).length,
				winner: winner?.proposal ?? null,
			},
			delivery: winner?.delivery ?? null,
		};
	}
}
