import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { isSourceMutation, verificationEvidence } from "./command-policy.ts";
import {
	boundedArguments, classifyFailure, isFailureObservation,
	planItemHash, sha256, targetHash, toolFamily,
} from "./failure-episodes.ts";
import type {
	ExecutionReceiptV1, MutationKind, VerificationKind,
} from "./run-kernel-types.ts";

type PendingReceipt = {
	toolCallIdHash: string;
	toolName: string;
	args: Record<string, unknown>;
	toolFamily: string;
	targetHash: string;
	planItemHash: string;
	startedSequence: number;
	startedAtMs: number;
	mutation: MutationKind;
	verification: VerificationKind;
	surfaceHash: string;
	hadStart: boolean;
	hadToolResult: boolean;
};

export type ReceiptStartV1 = Pick<ExecutionReceiptV1,
	"toolCallIdHash" | "toolName" | "toolFamily" | "targetHash" | "planItemHash" |
	"startedSequence" | "startedAtMs" | "mutation" | "verification" | "surfaceHash">;

export type ReceiptNormalizerOptions = {
	surfaceHash: () => string;
	detectedGate: () => string | null;
	planItemId: () => string | null;
	maxPending?: number;
	maxCompleted?: number;
};

/** Structural event shapes shared by Pi 0.80 through 0.83. Pi exposed the
 * runtime events before it exported their named TypeScript declarations. */
export type ToolExecutionStartLike = {
	toolCallId: string;
	toolName: string;
	args: unknown;
};

export type ToolExecutionEndLike = {
	toolCallId: string;
	toolName: string;
	result: unknown;
	isError: boolean;
};

function safeToolName(value: unknown): string {
	const name = String(value ?? "unknown").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 64);
	return name || "unknown";
}

function mutationKind(toolName: string, args: Record<string, unknown>): MutationKind {
	if (["edit", "write", "multiedit"].includes(toolName)) return "source";
	if (toolName === "bash" && isSourceMutation(String(args.command ?? ""))) return "source";
	if (toolName === "plan_write") return "plan";
	if (toolName === "plan_go" || toolName === "compact_context") return "state";
	return "none";
}

function verificationKind(toolName: string, args: Record<string, unknown>, gate: string | null): VerificationKind {
	if (toolName !== "bash") return "none";
	return verificationEvidence(String(args.command ?? ""), gate);
}

/** Count provider-visible result payload bytes without stringifying arbitrary
 * details or allocating a copy of the complete result. */
export function resultPayloadBytes(result: unknown): number {
	const content = (result as { content?: unknown } | null)?.content;
	if (!Array.isArray(content)) return 0;
	let bytes = 0;
	for (let index = 0; index < Math.min(content.length, 512); index += 1) {
		const block = content[index];
		if (!block || typeof block !== "object") continue;
		const item = block as Record<string, unknown>;
		for (const key of ["text", "data"] as const) {
			if (typeof item[key] === "string") bytes += Buffer.byteLength(item[key]);
		}
		if (bytes >= Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
	}
	return bytes;
}

/** Read only the prefix needed by the fixed failure taxonomy. Unlike the
 * historical shared helper, this never joins the complete tool result before
 * truncating it. */
export function boundedReceiptText(result: unknown, maxChars = 2048): string {
	const content = (result as { content?: unknown } | null)?.content;
	if (!Array.isArray(content) || maxChars <= 0) return "";
	let text = "";
	for (let index = 0; index < content.length && text.length < maxChars; index += 1) {
		const block = content[index];
		if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "text") continue;
		const value = (block as { text?: unknown }).text;
		if (typeof value !== "string" || value.length === 0) continue;
		const separator = text.length === 0 ? "" : " ";
		const remaining = maxChars - text.length;
		if (remaining <= separator.length) break;
		text += separator + value.slice(0, remaining - separator.length);
	}
	return text;
}

export class ReceiptNormalizerV1 {
	private readonly pending = new Map<string, PendingReceipt>();
	private readonly completed = new Set<string>();
	private readonly options: ReceiptNormalizerOptions;
	private readonly maxPending: number;
	private readonly maxCompleted: number;

	constructor(options: ReceiptNormalizerOptions) {
		this.options = options;
		this.maxPending = Math.max(8, options.maxPending ?? 512);
		this.maxCompleted = Math.max(32, options.maxCompleted ?? 2048);
	}

	reset(): void {
		this.pending.clear();
		this.completed.clear();
	}

	start(event: ToolExecutionStartLike, sequence: number, atMs: number): ReceiptStartV1 | null {
		if (this.completed.has(event.toolCallId) || this.pending.has(event.toolCallId)) return null;
		const pending = this.makePending(
			event.toolCallId, event.toolName, event.args, sequence, atMs, true, false,
		);
		this.pending.set(event.toolCallId, pending);
		this.trimPending();
		return this.publicStart(pending);
	}

	noteToolResult(event: ToolResultEvent, sequence: number, atMs: number): void {
		if (this.completed.has(event.toolCallId)) return;
		const existing = this.pending.get(event.toolCallId);
		if (existing) {
			existing.hadToolResult = true;
			return;
		}
		this.pending.set(event.toolCallId, this.makePending(
			event.toolCallId, event.toolName, event.input, sequence, atMs, false, true,
		));
		this.trimPending();
	}

	finish(event: ToolExecutionEndLike, sequence: number, atMs: number): ExecutionReceiptV1 | null {
		if (this.completed.has(event.toolCallId)) return null;
		let pending = this.pending.get(event.toolCallId);
		if (!pending) {
			pending = this.makePending(
				event.toolCallId, event.toolName, {}, sequence, atMs, false, false,
			);
		}
		this.pending.delete(event.toolCallId);
		this.rememberCompleted(event.toolCallId);

		const text = boundedReceiptText(event.result);
		const failureObservation = {
			toolName: pending.toolName,
			args: pending.args,
			text,
			isError: event.isError,
		};
		const failed = isFailureObservation(failureObservation);
		const status = !pending.hadToolResult
			? (event.isError ? "rejected" : "missing_result")
			: (failed ? "failed" : "succeeded");
		return {
			v: 1,
			toolCallIdHash: pending.toolCallIdHash,
			toolName: pending.toolName,
			toolFamily: pending.toolFamily,
			targetHash: pending.targetHash,
			planItemHash: pending.planItemHash,
			startedSequence: pending.startedSequence,
			endedSequence: sequence,
			startedAtMs: pending.startedAtMs,
			endedAtMs: atMs,
			status,
			isError: event.isError,
			mutation: pending.mutation,
			verification: pending.verification,
			failureClass: failed ? classifyFailure(failureObservation) : null,
			resultBytes: resultPayloadBytes(event.result),
			hadStart: pending.hadStart,
			hadToolResult: pending.hadToolResult,
			surfaceHash: pending.surfaceHash,
		};
	}

	private makePending(
		rawCallId: string,
		rawToolName: unknown,
		rawArgs: unknown,
		sequence: number,
		atMs: number,
		hadStart: boolean,
		hadToolResult: boolean,
	): PendingReceipt {
		const toolName = safeToolName(rawToolName);
		const args = boundedArguments(
			rawArgs && typeof rawArgs === "object" ? rawArgs as Record<string, unknown> : {},
		);
		return {
			toolCallIdHash: sha256(`tool-call:${rawCallId}`),
			toolName,
			args,
			toolFamily: toolFamily(toolName, args),
			targetHash: targetHash(toolName, args),
			planItemHash: planItemHash(this.options.planItemId()),
			startedSequence: sequence,
			startedAtMs: atMs,
			mutation: mutationKind(toolName, args),
			verification: verificationKind(toolName, args, this.options.detectedGate()),
			surfaceHash: this.options.surfaceHash(),
			hadStart,
			hadToolResult,
		};
	}

	private publicStart(pending: PendingReceipt): ReceiptStartV1 {
		return {
			toolCallIdHash: pending.toolCallIdHash,
			toolName: pending.toolName,
			toolFamily: pending.toolFamily,
			targetHash: pending.targetHash,
			planItemHash: pending.planItemHash,
			startedSequence: pending.startedSequence,
			startedAtMs: pending.startedAtMs,
			mutation: pending.mutation,
			verification: pending.verification,
			surfaceHash: pending.surfaceHash,
		};
	}

	private trimPending(): void {
		while (this.pending.size > this.maxPending) {
			const oldest = this.pending.keys().next().value as string | undefined;
			if (oldest === undefined) break;
			this.pending.delete(oldest);
		}
	}

	private rememberCompleted(rawCallId: string): void {
		this.completed.add(rawCallId);
		while (this.completed.size > this.maxCompleted) {
			const oldest = this.completed.values().next().value as string | undefined;
			if (oldest === undefined) break;
			this.completed.delete(oldest);
		}
	}
}
