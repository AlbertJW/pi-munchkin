// CONFORMANCE double for pi's ExtensionAPI (pi-coding-agent 0.83).
//
// This file used to be a RECORDER: it stored whatever extensions did and handed
// it straight back to assertions. That let tests pin behaviour pi does not have,
// and it hid two real production defects for months —
//   * compact_context sent {deliverAs:"nextTurn", triggerTurn:true} and a test
//     asserted exactly that, while pi IGNORES triggerTurn for nextTurn, so the
//     session never resumed;
//   * plan_write/plan_go returned {isError:true} and tests asserted it, while pi
//     only marks a tool failed when execute() THROWS.
// Every behaviour below is therefore a CITED contract, not an approximation.
// Citations: DOC = pi-coding-agent/docs/extensions.md, and the shipped
// implementation (RUNNER = dist/core/extensions/runner.js, SESSION =
// dist/core/agent-session.js, LOOP = pi-agent-core/dist/agent-loop.js).
// When pi upgrades, re-derive these rules before trusting this file again.
import { execFile } from "node:child_process";

export type FakePi = ReturnType<typeof makeFakePi>;

/** How pi combines handler return values, per event (RUNNER, verified 0.83).
 *  "first-wins" is the rule the old double applied to EVERYTHING; it is correct
 *  for exactly three events. */
export type CombineStrategy = "chain" | "accumulate" | "last-wins" | "first-wins" | "discard";

export const EVENT_STRATEGY: Record<string, CombineStrategy> = {
	// Chained/middleware: handler N's output is handler N+1's input (DOC:820-823).
	tool_result: "chain",
	context: "chain",
	message_end: "chain",
	before_provider_request: "chain",
	// Accumulate: every extension contributes (RUNNER:834-887).
	before_agent_start: "accumulate",
	resources_discover: "accumulate",
	// Last truthy wins, block/cancel short-circuits (RUNNER:698-716, 576-606).
	tool_call: "last-wins",
	session_before_compact: "last-wins",
	session_before_tree: "last-wins",
	session_before_switch: "last-wins",
	session_before_fork: "last-wins",
	// Genuinely first-wins (RUNNER:717-743, 942-943).
	user_bash: "first-wins",
	project_trust: "first-wins",
	// Everything else: return value is read and DROPPED (RUNNER:586 gates capture).
	session_start: "discard", session_shutdown: "discard", session_compact: "discard",
	session_tree: "discard", agent_start: "discard", agent_end: "discard",
	turn_start: "discard", turn_end: "discard", message_start: "discard",
	message_update: "discard", tool_execution_start: "discard",
	tool_execution_update: "discard", tool_execution_end: "discard",
	model_select: "discard", thinking_level_select: "discard",
	after_provider_response: "discard", agent_settled: "discard",
};

/** What actually happened to a message pi was asked to deliver. Tests assert on
 *  this rather than on the raw options, because several option combinations are
 *  silently ignored (SESSION:1075-1094). */
export type DeliveryVerdict = "delivered" | "queued-next-turn" | "queued-steer" | "queued-follow-up" | "lost";

export type RecordedDelivery = {
	api: "sendMessage" | "sendUserMessage";
	content: unknown;
	text: string;
	deliverAs: unknown;
	triggerTurn: unknown;
	/** Alias of `content` for sendMessage entries, where the payload IS the message. */
	message?: unknown;
	/** pi's real outcome, not what the caller asked for. */
	effective: DeliveryVerdict;
	/** Set when pi would have raised — the extension never sees this (C2.5). */
	swallowedError?: string;
};

export function makeFakePi(options: { streaming?: boolean } = {}) {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const handlers = new Map<string, any[]>();
	const sent: string[] = [];
	const deliveries: RecordedDelivery[] = [];
	const customDeliveries: RecordedDelivery[] = [];
	const entries: Array<{ type: string; data: unknown }> = [];
	const busHandlers = new Map<string, Set<(data: unknown) => void>>();
	/** Errors pi would funnel to runner.emitError instead of to the extension. */
	const swallowedErrors: string[] = [];
	let streaming = options.streaming === true;
	let activeTools: string[] = [];

	const textOf = (content: unknown): string => {
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			return content.map((b: any) => (b && typeof b === "object" && typeof b.text === "string" ? b.text : "")).join("\n");
		}
		if (content && typeof content === "object" && typeof (content as any).content === "string") {
			return (content as any).content as string;
		}
		return "";
	};

	// SESSION:1075-1094 — the dispatch ladder, in pi's order. nextTurn is checked
	// FIRST (so it wins even while streaming and never consults triggerTurn);
	// while streaming, anything that is not "followUp" falls through to steer.
	const classify = (deliverAs: unknown, triggerTurn: unknown): DeliveryVerdict => {
		if (deliverAs === "nextTurn") return "queued-next-turn";
		if (streaming) return deliverAs === "followUp" ? "queued-follow-up" : "queued-steer";
		if (triggerTurn === true) return "delivered";
		return "delivered";
	};

	const pi = {
		registerTool: (t: any) => tools.set(t.name, t),
		registerCommand: (name: string, def: any) => commands.set(name, def),
		on: (ev: string, fn: any) => handlers.set(ev, [...(handlers.get(ev) ?? []), fn]),
		exec: (cmd: string, args: string[], opts?: { cwd?: string; timeout?: number }) =>
			new Promise<{ stdout: string; stderr: string; code: number; killed: boolean }>((resolve) => {
				execFile(cmd, args, { cwd: opts?.cwd, timeout: opts?.timeout ?? 30_000 }, (err, stdout, stderr) => {
					const code = err ? (typeof (err as any).code === "number" ? (err as any).code : 1) : 0;
					resolve({ stdout: String(stdout), stderr: String(stderr), code, killed: Boolean((err as any)?.killed) });
				});
			}),
		// DOC:1435 + SESSION:829-830 — streaming without deliverAs throws inside pi,
		// and SESSION:1846-1863 swallows it into emitError: the extension's message
		// is simply LOST, with no exception reaching the caller.
		sendUserMessage: (content: unknown, opts?: { deliverAs?: unknown; triggerTurn?: unknown }) => {
			const text = textOf(content);
			const deliverAs = opts?.deliverAs;
			if (streaming && deliverAs === undefined) {
				const message = "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.";
				swallowedErrors.push(message);
				deliveries.push({ api: "sendUserMessage", content, text, deliverAs, triggerTurn: opts?.triggerTurn, effective: "lost", swallowedError: message });
				return;
			}
			sent.push(text);
			deliveries.push({ api: "sendUserMessage", content, text, deliverAs, triggerTurn: opts?.triggerTurn, effective: classify(deliverAs, opts?.triggerTurn) });
		},
		sendMessage: (message: unknown, opts?: { triggerTurn?: unknown; deliverAs?: unknown }) => {
			customDeliveries.push({
				api: "sendMessage", content: message, message, text: textOf((message as any)?.content ?? message),
				deliverAs: opts?.deliverAs, triggerTurn: opts?.triggerTurn,
				effective: classify(opts?.deliverAs, opts?.triggerTurn),
			});
		},
		getActiveTools: () => activeTools,
		setActiveTools: (names: string[]) => { activeTools = [...names]; },
		getAllTools: () => [...tools.values()].map((tool) => ({
			name: tool.name,
			description: tool.description ?? "",
			sourceInfo: tool.sourceInfo ?? { source: "test", path: "test" },
		})),
		getCommands: () => [...commands.entries()].map(([name, command]) => ({
			name,
			description: command.description ?? "",
			sourceInfo: { source: "test", path: "test" },
		})),
		events: {
			emit: (channel: string, data: unknown) => {
				for (const handler of busHandlers.get(channel) ?? []) handler(data);
			},
			on: (channel: string, handler: (data: unknown) => void) => {
				const current = busHandlers.get(channel) ?? new Set();
				current.add(handler);
				busHandlers.set(channel, current);
				return () => current.delete(handler);
			},
		},
		appendEntry: (type: string, data: unknown) => entries.push({ type, data }),
	};
	return {
		pi, tools, commands, handlers, sent, deliveries, customDeliveries, entries, busHandlers,
		swallowedErrors,
		/** Put the session into/out of the streaming state so delivery rules apply. */
		setStreaming(value: boolean) { streaming = value; },
	};
}

export function makeCtx(cwd: string) {
	const notes: string[] = [];
	return {
		ctx: {
			cwd,
			model: { provider: "test-provider", id: "test-model" },
			ui: { notify: (m: string, _l?: string) => notes.push(m), confirm: async () => true },
		},
		notes,
	};
}

/** A content block as pi passes it around (text blocks carry `text`). */
export type PiContentBlock = { type: string; text?: string; [key: string]: unknown };
/** pi-shaped tool result: exactly what a tool_result handler receives. */
export type PiToolResult = {
	// `any[]` deliberately: pi's blocks are heterogeneous (text/image/...), and
	// tests overwhelmingly assert on text. Strict typing here buys no safety —
	// it just forces 34 non-null assertions. PiContentBlock is exported above for
	// anyone who wants the honest shape. The double's value is in the CONTRACT
	// semantics (isError, delivery, chaining), which are strictly modelled.
	content: any[];
	details: any;
	isError: boolean;
	terminate?: unknown;
};

/**
 * Run a registered tool the way pi does, then apply pi's result contract.
 * C1.1 (DOC:1959): "Returning a value never sets the error flag regardless of
 * what properties you include in the return object." C1.2 (LOOP:468-520): a
 * THROW becomes content:[{type:"text",text:err.message}], details:{}, and the
 * tool's own details/terminate are LOST.
 */
export async function callTool(fp: FakePi, name: string, params: unknown, cwd: string): Promise<PiToolResult> {
	const tool = fp.tools.get(name);
	if (!tool) throw new Error(`tool not registered: ${name}`);
	try {
		const raw = await tool.execute("tc-test", params, undefined, undefined, {
			cwd,
			model: { provider: "test-provider", id: "test-model" },
		});
		// LOOP:466 hard-codes isError:false; LOOP:530-543 normalizes missing content to [].
		return { content: raw?.content ?? [], details: raw?.details, isError: false, terminate: raw?.terminate };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { content: [{ type: "text", text: message }], details: {}, isError: true };
	}
}

/**
 * Assert a tool call FAILS the way pi reports failure: execute() threw, so the
 * model receives isError:true with the message as its only content. Replaces
 * assert.rejects(callTool(...)), which cannot work now that callTool applies
 * pi's contract (pi never propagates the throw to the caller).
 */
export async function expectToolError(
	fp: FakePi, name: string, params: unknown, cwd: string, match: RegExp,
): Promise<PiToolResult> {
	const r = await callTool(fp, name, params, cwd);
	if (!r.isError) throw new Error(`expected ${name} to fail, but it succeeded: ${JSON.stringify(r.content)}`);
	const text = r.content.map((c) => c.text ?? "").join("\n");
	if (!match.test(text)) throw new Error(`${name} failed with the wrong message.\nexpected ${match}\ngot: ${text}`);
	return r;
}

/** Raw execute(), for the rare test that must inspect what a tool returned
 *  BEFORE pi's contract is applied. Prefer callTool. */
export async function callToolRaw(fp: FakePi, name: string, params: unknown, cwd: string) {
	const tool = fp.tools.get(name);
	if (!tool) throw new Error(`tool not registered: ${name}`);
	return tool.execute("tc-test", params, undefined, undefined, {
		cwd, model: { provider: "test-provider", id: "test-model" },
	});
}

/**
 * Fire an event through EVERY registered handler, combining results the way pi
 * does for that specific event (EVENT_STRATEGY). The old implementation returned
 * the first non-undefined result for all events, which is correct for three of
 * them and wrong for the rest — so multi-extension composition was never tested.
 */
export async function fire(fp: FakePi, ev: string, event: unknown, ctx?: unknown) {
	const fns = fp.handlers.get(ev) ?? [];
	const strategy = EVENT_STRATEGY[ev] ?? "discard";

	if (strategy === "chain") {
		// RUNNER:646-697 (tool_result), :744-772 (context), :607-644 (message_end):
		// one mutating event; each handler sees prior handlers' changes.
		const current: any = ev === "context" ? structuredClone(event) : { ...(event as any) };
		const touched = new Set<string>();
		let changed = false;
		for (const fn of fns) {
			const r = await fn(current, ctx);
			if (!r) continue;
			changed = true;
			if (ev === "context") { if (r.messages) current.messages = r.messages; continue; }
			if (ev === "message_end") {
				// RUNNER:621-628: a role change is rejected and the return DISCARDED.
				if (r.message && r.message.role !== current.message?.role) continue;
				if (r.message) current.message = r.message;
				continue;
			}
			// tool_result: field-by-field patch, only defined fields (TYPES:790-795).
			// terminate is NOT patchable here (C1.5) — dropped deliberately.
			for (const key of ["content", "details", "isError", "usage"]) {
				if (r[key] !== undefined) { current[key] = r[key]; touched.add(key); }
			}
		}
		if (!changed) return undefined;
		if (ev === "context") return { messages: current.messages };
		if (ev === "message_end") return { message: current.message };
		// Only fields a handler actually SET are part of the patch — a field merely
		// present on the incoming event must not reappear as if it were patched.
		const patch: Record<string, unknown> = {};
		for (const key of touched) patch[key] = (current as any)[key];
		return patch;
	}

	if (strategy === "accumulate") {
		// RUNNER:834-887: messages APPEND across extensions; systemPrompt CHAINS.
		const messages: unknown[] = [];
		let systemPrompt = (event as any)?.systemPrompt;
		let touched = false;
		for (const fn of fns) {
			const r = await fn({ ...(event as any), systemPrompt }, ctx);
			if (!r) continue;
			if (r.message !== undefined) { messages.push(r.message); touched = true; }
			if (r.systemPrompt !== undefined) { systemPrompt = r.systemPrompt; touched = true; }
		}
		if (!touched) return undefined;
		const out: Record<string, unknown> = {};
		if (messages.length) out.messages = messages;
		if (systemPrompt !== (event as any)?.systemPrompt) out.systemPrompt = systemPrompt;
		return out;
	}

	if (strategy === "last-wins") {
		// RUNNER:698-716: later truthy returns overwrite; block/cancel short-circuit.
		// tool_call handler throws are NOT caught (C3.2) — they propagate, blocking
		// the call and skipping later handlers, exactly as in pi.
		let result: any;
		for (const fn of fns) {
			const r = await fn(event, ctx);
			if (r) {
				result = r;
				if (r.block || r.cancel) return result;
			}
		}
		return result;
	}

	if (strategy === "first-wins") {
		for (const fn of fns) {
			const r = await fn(event, ctx);
			if (r) return r;
		}
		return undefined;
	}

	// "discard": every handler runs; pi reads the return and drops it (RUNNER:586).
	for (const fn of fns) await fn(event, ctx);
	return undefined;
}

/**
 * Load extensions the way pi does: a fresh module instance per extension
 * (jiti moduleCache:false, C5.1/LOADER:325-332), so any assumption that two
 * extensions share module-level state fails here exactly as it does live.
 * Shared state must go through the globalThis bus.
 */
export async function loadExtensions(fp: FakePi, specifiers: string[]): Promise<void> {
	for (const spec of specifiers) {
		const mod = await import(`${spec}${spec.includes("?") ? "&" : "?"}inst=${Date.now()}-${Math.random()}`);
		await mod.default(fp.pi as never);
	}
}

/** Clear the cross-extension globalThis bus so test order cannot create or mask
 *  green (several suites leak __pi_plan_phase_active, __pi_gate_green, __pi_lb_*). */
export function resetPiGlobals(): void {
	const g = globalThis as Record<string, unknown>;
	for (const key of Object.keys(g)) {
		if (key.startsWith("__pi_")) delete g[key];
	}
}
