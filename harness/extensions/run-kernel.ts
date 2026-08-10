import { createHash, randomUUID } from "node:crypto";
import { VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { planItemHash, sha256 } from "../lib/failure-episodes.ts";
import { clearDetectedProjectGate, detectProjectGate, readDetectedProjectGate } from "../lib/project-gate.ts";
import { emitRunEvent, onRunEvent } from "../lib/run-kernel-events.ts";
import { ReceiptNormalizerV1 } from "../lib/run-kernel-receipts.ts";
import { RunStateStoreV1, validateRunStateSnapshot } from "../lib/run-kernel-state.ts";
import type {
	ExecutionReceiptV1, LegacyRunSnapshotV1, RunEventV1, RunKernelMode,
	RunStateV1, RunTransitionV1,
} from "../lib/run-kernel-types.ts";
import { record } from "../lib/telemetry.ts";

export type RunKernelInstallOptions = {
	mode?: RunKernelMode;
	now?: () => number;
	idFactory?: () => string;
	detectGate?: (cwd: string) => Promise<string | null>;
	surfaceHash?: () => string;
	piVersion?: string;
};

export type RunKernelController = {
	mode: RunKernelMode;
	getState(): RunStateV1;
};

function resolveMode(value: string | undefined): RunKernelMode {
	return value === "off" ? "off" : "shadow";
}

function hashId(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function objectiveHash(prompt: string): string {
	return sha256(`objective:${prompt.trim().replace(/\s+/g, " ")}`);
}

function safeSurfaceHash(value: string | undefined): string {
	return value && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : sha256("surface:unknown");
}

function safeLabel(value: unknown): string {
	const label = String(value ?? "unknown").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 96);
	return label || "unknown";
}

function currentPlanItemId(): string | null {
	const plan = (globalThis as Record<string, unknown>).__pi_active_plan_context as
		{ item_id?: unknown } | undefined;
	return typeof plan?.item_id === "string" ? plan.item_id : null;
}

function legacySnapshot(): LegacyRunSnapshotV1 {
	const global = globalThis as Record<string, unknown>;
	const plan = global.__pi_active_plan_context as {
		item_id?: unknown; open_items?: unknown; blocked_items?: unknown;
	} | undefined;
	const itemId = typeof plan?.item_id === "string" && plan.item_id.length > 0 ? plan.item_id : null;
	const verify = global.__pi_vg_state as { mutated?: unknown; verifiedOk?: unknown } | undefined;
	return {
		planActive: Boolean(plan),
		planItemActive: itemId !== null,
		planItemHash: itemId === null ? null : planItemHash(itemId),
		planOpenItems: typeof plan?.open_items === "number" && Number.isSafeInteger(plan.open_items) && plan.open_items >= 0
			? plan.open_items : null,
		planBlockedItems: typeof plan?.blocked_items === "number" && Number.isSafeInteger(plan.blocked_items) && plan.blocked_items >= 0
			? plan.blocked_items : null,
		verifyKnown: Boolean(verify),
		verifyMutated: verify?.mutated === true,
		verifyOk: verify?.verifiedOk === true,
	};
}

type AgentMessageLike = { role: string; content?: unknown };

function lastAssistantTextOnly(messages: AgentMessageLike[]): boolean {
	let assistant: AgentMessageLike | undefined;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index]?.role === "assistant") { assistant = messages[index]; break; }
	}
	if (!assistant) return false;
	if (typeof assistant.content === "string") return assistant.content.trim().length > 0;
	if (!Array.isArray(assistant.content)) return false;
	let hasText = false;
	for (const block of assistant.content) {
		if (!block || typeof block !== "object") continue;
		if ((block as { type?: unknown }).type === "toolCall") return false;
		if ((block as { type?: unknown; text?: unknown }).type === "text" &&
			typeof (block as { text?: unknown }).text === "string" &&
			String((block as { text?: unknown }).text).trim().length > 0) hasText = true;
	}
	return hasText;
}

export function installRunKernel(pi: ExtensionAPI, options: RunKernelInstallOptions = {}): RunKernelController {
	const mode = options.mode ?? resolveMode(process.env.RUN_KERNEL);
	const store = new RunStateStoreV1();
	if (mode === "off") return { mode, getState: () => store.snapshot() };

	const now = options.now ?? Date.now;
	const idFactory = options.idFactory ?? randomUUID;
	const detectGate = options.detectGate ?? detectProjectGate;
	const surfaceHash = options.surfaceHash ?? (() => safeSurfaceHash(process.env.HARNESS_SURFACE_SHA256));
	let sequence = 0;
	let generation = 0;
	let detectedGate: string | null = null;
	let runIdHash = hashId(`run:${idFactory()}`);
	let currentCycleIdHash: string | null = null;
	let settledCycleIdHash: string | null = null;
	const disagreementFingerprints = new Set<string>();

	const normalizer = new ReceiptNormalizerV1({
		surfaceHash,
		detectedGate: () => detectedGate,
		planItemId: currentPlanItemId,
	});

	const applied = { transition: null as RunTransitionV1 | null };
	onRunEvent(pi.events, (event) => {
		applied.transition = store.apply(event).transition;
	});
	const readAppliedTransition = (): RunTransitionV1 | null => applied.transition;

	function nextBase(): Pick<RunEventV1, "v" | "sequence" | "atMs"> {
		return { v: 1, sequence: ++sequence, atMs: now() };
	}

	function dispatch(event: RunEventV1): void {
		applied.transition = null;
		emitRunEvent(pi.events, event);
		const transition = readAppliedTransition();
		if (!transition) return;
		record("run-kernel", "transition", {
			from_phase: transition.from,
			to_phase: transition.to,
			reason: transition.reason,
			sequence: transition.sequence,
		});
		emitRunEvent(pi.events, {
			...nextBase(),
			type: "run/phase-changed",
			transition,
		});
	}

	function recordReceipt(receipt: ExecutionReceiptV1): void {
		record("run-kernel", "receipt", {
			tool: receipt.toolName,
			tool_family: receipt.toolFamily,
			status: receipt.status,
			mutation: receipt.mutation,
			verification: receipt.verification,
			failure_class: receipt.failureClass,
			result_bytes: receipt.resultBytes,
			started_sequence: receipt.startedSequence,
			ended_sequence: receipt.endedSequence,
			had_start: receipt.hadStart,
			had_result: receipt.hadToolResult,
		});
	}

	function compareLegacy(legacy: LegacyRunSnapshotV1): void {
		const state = store.snapshot();
		const dimensions: Array<[string, boolean, boolean]> = [
			["plan_active", state.plan.accepted, legacy.planActive],
		];
		if (legacy.verifyKnown) {
			dimensions.push(
				["verify_mutated", state.mutation.count > 0, legacy.verifyMutated],
				["verify_ok", state.verification.validAfterMutation, legacy.verifyOk],
			);
		}
		for (const [dimension, kernelValue, legacyValue] of dimensions) {
			if (kernelValue === legacyValue) continue;
			const fingerprint = `${dimension}:${kernelValue}:${legacyValue}`;
			if (disagreementFingerprints.has(fingerprint)) continue;
			disagreementFingerprints.add(fingerprint);
			record("run-kernel", "legacy-disagreement", {
				dimension,
				kernel_value: kernelValue,
				legacy_value: legacyValue,
			});
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		sequence = 0;
		generation += 1;
		normalizer.reset();
		disagreementFingerprints.clear();
		currentCycleIdHash = null;
		settledCycleIdHash = null;
		runIdHash = hashId(`run:${idFactory()}`);
		const sharedGate = options.detectGate || process.env.VERIFY_GATE === "off"
			? { found: false as const }
			: readDetectedProjectGate(ctx.cwd);
		detectedGate = sharedGate.found ? sharedGate.command : await detectGate(ctx.cwd);
		const allTools = pi.getAllTools();
		const activeTools = pi.getActiveTools();
		const activation = (globalThis as Record<string, unknown>).__pi_tool_activation_state as
			{ preserved_explicit?: unknown } | undefined;
		const legacy = legacySnapshot();
		dispatch({
			...nextBase(),
			type: "run/session-started",
			sessionIdHash: hashId(`session:${idFactory()}`),
			runIdHash,
			generation,
			surfaceHash: surfaceHash(),
			piVersion: options.piVersion ?? VERSION,
			provider: safeLabel(ctx.model?.provider),
			model: safeLabel(ctx.model?.id),
			activeToolCount: activeTools.length,
			allToolCount: allTools.length,
			preservedExplicitTools: activation?.preserved_explicit === true,
			detectedGateHash: detectedGate ? sha256(`gate:${detectedGate}`) : null,
			legacy,
		});
	});

	pi.on("before_agent_start", async (event) => {
		const previous = store.snapshot();
		const newRunIdHash = previous.outcome.status === "complete"
			? hashId(`run:${idFactory()}`)
			: null;
		if (newRunIdHash) runIdHash = newRunIdHash;
		dispatch({
			...nextBase(),
			type: "run/objective-observed",
			objectiveHash: objectiveHash(event.prompt),
			runIdHash: newRunIdHash,
		});
	});

	pi.on("agent_start", async () => {
		// Tool-call IDs are unique within one Pi agent cycle, not an API promise
		// across retries/compactions. Preserve RunState, but reopen receipt identity.
		normalizer.reset();
		const previous = store.snapshot();
		const newRunIdHash = previous.outcome.status === "complete"
			? hashId(`run:${idFactory()}`)
			: null;
		if (newRunIdHash) runIdHash = newRunIdHash;
		currentCycleIdHash = hashId(`cycle:${idFactory()}`);
		settledCycleIdHash = null;
		dispatch({ ...nextBase(), type: "run/cycle-started", cycleIdHash: currentCycleIdHash, runIdHash: newRunIdHash });
	});

	pi.on("tool_execution_start", async (event) => {
		const base = nextBase();
		const receipt = normalizer.start(event, base.sequence, base.atMs);
		if (receipt) dispatch({ ...base, type: "run/tool-started", receipt });
	});

	pi.on("tool_result", async (event) => {
		const base = nextBase();
		normalizer.noteToolResult(event, base.sequence, base.atMs);
	});

	pi.on("tool_execution_end", async (event) => {
		const base = nextBase();
		const receipt = normalizer.finish(event, base.sequence, base.atMs);
		if (!receipt) return;
		dispatch({ ...base, type: "run/tool-finished", receipt });
		recordReceipt(receipt);
	});

	pi.on("turn_end", async () => {
		const legacy = legacySnapshot();
		compareLegacy(legacy);
		dispatch({ ...nextBase(), type: "run/legacy-observed", legacy });
	});

	pi.on("agent_end", async (event) => {
		dispatch({ ...nextBase(), type: "run/cycle-ended", textOnly: lastAssistantTextOnly(event.messages) });
	});

	pi.on("session_compact", async () => {
		dispatch({ ...nextBase(), type: "run/session-compacted" });
	});

	pi.on("agent_settled", async () => {
		if (!currentCycleIdHash || settledCycleIdHash === currentCycleIdHash) return;
		settledCycleIdHash = currentCycleIdHash;
		dispatch({ ...nextBase(), type: "run/cycle-settled" });
		const state = store.snapshot();
		const validationErrors = validateRunStateSnapshot(state);
		record("run-kernel", "settled", {
			phase: state.workflow.phase,
			outcome: state.outcome.status,
			lifecycle: state.lifecycle.state,
			receipts: state.counters.receipts,
			failures: state.failures.count,
			mutations: state.mutation.count,
			verification_attempts: state.verification.attempts,
			valid_gates: state.verification.validGates,
			transitions: state.workflow.history.length,
			missing_start: state.counters.missingStart,
			missing_result: state.counters.missingResult,
			validation_errors: validationErrors.length,
		});
	});

	pi.on("session_shutdown", async () => {
		dispatch({ ...nextBase(), type: "run/session-shutdown" });
		normalizer.reset();
		clearDetectedProjectGate();
	});

	return { mode, getState: () => store.snapshot() };
}

export default function (pi: ExtensionAPI): void {
	installRunKernel(pi);
}
