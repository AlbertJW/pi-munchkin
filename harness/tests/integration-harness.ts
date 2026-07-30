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

/**
 * How pi combines handler return values. Verified against the shipped
 * runner.js line by line (2026-07-30) after an adversarial review found the
 * first version of this table wrong in seven ways — pi does NOT have a small
 * set of tidy strategies, it has near-per-event behaviour, and flattening that
 * is exactly how a double starts lying again.
 */
export type CombineStrategy =
	| "tool_result"      // one mutating event; patch = ALL four fields when modified
	| "context"          // chained replacement; returns the BARE array, ALWAYS
	| "message_end"      // chained; returns the BARE message; role change rejected
	| "replace_payload"  // whole return replaces the payload (before_provider_request)
	| "agent_start"      // messages APPEND, systemPrompt CHAINS
	| "resources"        // skill/prompt/theme paths concatenated, tagged per extension
	| "tool_call"        // last-wins; short-circuits on `block` ONLY; throws PROPAGATE
	| "session_before"   // last-wins; short-circuits on `cancel` ONLY; throws CAUGHT
	| "input"            // transform chains; `handled` short-circuits
	| "first_decisive"   // project_trust: a truthy "undecided" does NOT win
	| "first_wins"       // user_bash: first truthy return wins outright
	| "discard";         // return value read and dropped

export const EVENT_STRATEGY: Record<string, CombineStrategy> = {
	tool_result: "tool_result",              // runner.js:646-697
	context: "context",                      // runner.js:744-772
	message_end: "message_end",              // runner.js:607-644
	before_provider_request: "replace_payload", // runner.js:783-790
	before_agent_start: "agent_start",       // runner.js:834-887
	resources_discover: "resources",         // runner.js:888-925
	tool_call: "tool_call",                  // runner.js:698-716 (no try/catch!)
	session_before_compact: "session_before", // runner.js:576-606 (try/catch)
	session_before_tree: "session_before",
	session_before_switch: "session_before",
	session_before_fork: "session_before",
	input: "input",                          // runner.js:926-962
	project_trust: "first_decisive",         // runner.js:68-76
	user_bash: "first_wins",                 // runner.js:717-743
	// Return value read and DROPPED (runner.js:586 gates capture on isSessionBeforeEvent).
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
	const ctx = { cwd, model: { provider: "test-provider", id: "test-model" } };
	let result: PiToolResult;
	try {
		const raw = await tool.execute("tc-test", params, undefined, undefined, ctx);
		// LOOP:466 hard-codes isError:false; LOOP:530-543 normalizes missing content to [].
		result = { content: raw?.content ?? [], details: raw?.details, isError: false, terminate: raw?.terminate };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		result = { content: [{ type: "text", text: message }], details: {}, isError: true };
	}
	// pi runs finalizeExecutedToolCall — and therefore the tool_result handler
	// chain — after execute() settles, for BOTH the return and the throw paths
	// (agent-loop.js:316,357). Omitting this made observers like plan-runner's
	// write-rejected unreachable through callTool, so a test could only reach them
	// by hand-firing an event pi may never emit. Fire it here, apply the patch.
	const patch: any = await fire(fp, "tool_result", {
		toolCallId: "tc-test", toolName: name, input: params,
		content: result.content, details: result.details, isError: result.isError,
	}, ctx);
	if (patch) {
		if (patch.content !== undefined) result.content = patch.content;
		if (patch.details !== undefined) result.details = patch.details;
		if (patch.isError !== undefined) result.isError = patch.isError;
	}
	return result;
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
 * Fire an event through EVERY registered handler, combining results exactly as
 * pi's runner does for that event. Each branch cites the runner function it
 * mirrors; the differences between them are real and load-bearing (tool_call
 * short-circuits on `block` and lets handler throws propagate, while
 * session_before_* short-circuits on `cancel` and swallows them — mirror images
 * that a shared branch silently got backwards).
 */
export async function fire(fp: FakePi, ev: string, event: unknown, ctx?: unknown) {
	const fns = fp.handlers.get(ev) ?? [];
	const strategy = EVENT_STRATEGY[ev] ?? "discard";

	switch (strategy) {
		case "tool_result": {
			// runner.js:646-697. ONE object built before the loop and handed to every
			// handler, so in-place mutation is visible downstream. When anything was
			// modified pi returns all FOUR fields (carrying unmodified ones through),
			// not just the ones a handler set.
			const currentEvent: any = { ...(event as any) };
			let modified = false;
			for (const fn of fns) {
				const r = await fn(currentEvent, ctx);
				if (!r) continue;
				modified = true;
				for (const key of ["content", "details", "isError", "usage"]) {
					if (r[key] !== undefined) currentEvent[key] = r[key];
				}
			}
			if (!modified) return undefined;
			return {
				content: currentEvent.content,
				details: currentEvent.details,
				isError: currentEvent.isError,
				usage: currentEvent.usage,
			};
		}
		case "context": {
			// runner.js:744-772. Input is structuredClone'd; the BARE array is
			// returned ALWAYS — never undefined, even when no handler acted.
			let currentMessages = structuredClone((event as any)?.messages ?? []);
			for (const fn of fns) {
				const r = await fn({ ...(event as any), messages: currentMessages }, ctx);
				if (r && r.messages) currentMessages = r.messages;
			}
			return currentMessages;
		}
		case "message_end": {
			// runner.js:607-644. Fresh event per handler; a role change is rejected
			// and DISCARDED; returns the BARE message, or undefined if unmodified.
			let currentMessage: any = (event as any)?.message;
			let modified = false;
			for (const fn of fns) {
				const r = await fn({ ...(event as any), message: currentMessage }, ctx);
				if (!r || !r.message) continue;
				if (r.message.role !== currentMessage?.role) continue; // rejected, loop continues
				currentMessage = r.message;
				modified = true;
			}
			return modified ? currentMessage : undefined;
		}
		case "replace_payload": {
			// runner.js:783-790. The handler's ENTIRE return replaces the payload.
			let currentPayload: any = (event as any)?.payload ?? event;
			for (const fn of fns) {
				const r = await fn({ type: "before_provider_request", payload: currentPayload }, ctx);
				if (r !== undefined) currentPayload = r;
			}
			return currentPayload;
		}
		case "agent_start": {
			// runner.js:834-887. messages APPEND; systemPrompt CHAINS.
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
		case "resources": {
			// runner.js:888-925. Concatenates the three path lists across extensions.
			const skillPaths: unknown[] = [], promptPaths: unknown[] = [], themePaths: unknown[] = [];
			for (const fn of fns) {
				const r = await fn(event, ctx);
				if (!r) continue;
				for (const p of r.skillPaths ?? []) skillPaths.push(p);
				for (const p of r.promptPaths ?? []) promptPaths.push(p);
				for (const p of r.themePaths ?? []) themePaths.push(p);
			}
			return { skillPaths, promptPaths, themePaths };
		}
		case "tool_call": {
			// runner.js:698-716. `block` ONLY short-circuits, and there is NO try/catch
			// — a throwing handler propagates out, blocking the call fail-safe and
			// skipping every later handler.
			let result: any;
			for (const fn of fns) {
				const r = await fn(event, ctx);
				if (r) { result = r; if (r.block) return result; }
			}
			return result;
		}
		case "session_before": {
			// runner.js:576-606. `cancel` ONLY short-circuits, and handler throws ARE
			// caught (emitError) so the loop continues — the opposite of tool_call.
			let result: any;
			for (const fn of fns) {
				try {
					const r = await fn(event, ctx);
					if (r) { result = r; if (r.cancel) return result; }
				} catch { /* swallowed into emitError; pi proceeds */ }
			}
			return result;
		}
		case "input": {
			// runner.js:926-962. `handled` short-circuits; transforms chain; falls back
			// to transform/continue based on identity change.
			const original = event as any;
			let text = original?.text;
			let images = original?.images;
			for (const fn of fns) {
				const r = await fn({ ...original, text, images }, ctx);
				if (!r) continue;
				if (r.action === "handled") return r;
				if (r.action === "transform") {
					if (r.text !== undefined) text = r.text;
					if (r.images !== undefined) images = r.images;
				}
			}
			if (text !== original?.text || images !== original?.images) {
				return { action: "transform", text, images };
			}
			return { action: "continue" };
		}
		case "first_decisive": {
			// runner.js:68-76. A truthy {trusted:"undecided"} does NOT win — pi skips it.
			for (const fn of fns) {
				const r: any = await fn(event, ctx);
				if (r && r.trusted !== "undecided") return r;
			}
			return undefined;
		}
		case "first_wins": {
			for (const fn of fns) {
				const r = await fn(event, ctx);
				if (r) return r;
			}
			return undefined;
		}
		default: {
			// Every handler runs; pi reads the return and drops it (runner.js:586).
			for (const fn of fns) await fn(event, ctx);
			return undefined;
		}
	}
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
