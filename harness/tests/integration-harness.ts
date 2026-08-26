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
//
// KNOWN-UNFAITHFUL — the boundaries of what this double models. Named here so
// the next author reads them instead of discovering them the expensive way:
//  1. fire() has NO extension identity. It reads one flat handler map, so it
//     cannot model emitError attribution, ordering across a mixed extension
//     load, or the real `extensionPath` on resources_discover paths.
//  2. callTool models only HALF the tool pipeline: it never fires tool_call /
//     beforeToolCall. In pi a {block:true} return or a throwing tool_call
//     handler becomes kind:"immediate" (LOOP:395-444) — an error result with NO
//     tool_result event and NO afterToolCall. Guard extensions (git-guard) must
//     be tested by hand-firing plus constructing pi's consequence by hand.
//  3. callTool's ctx is {cwd, model} only — no ui/compact/exec/getContextUsage/
//     getSystemPrompt. Tools needing those bypass callTool and hand-roll a
//     richer ctx (see compact-tool.integration.test.ts).
//  4. Streaming state is ONE boolean. There is no _pendingNextTurnMessages
//     queue and no drain-at-next-prompt (SESSION:877-880), so "queued-next-turn"
//     is a verdict label, not a modelled behaviour — nothing here proves the
//     message is ever delivered.
//  5. fire() does NOT project the event to its per-type shape. Whatever object a
//     test hands in reaches the handler verbatim, so a test can invent a field pi
//     never emits and the double will happily deliver it. This is how
//     spec-adherence's read-detection was certified working while dead: the tests
//     hand-fired `tool_execution_end` carrying `args`, but pi builds that event
//     explicitly (SESSION:487-514) and copies `args` onto _start and _update ONLY.
//     tsc is the real defence for this class (`on()` is typed per event, and
//     `npm run typecheck` covers extensions) — it was defeated by an `as` cast,
//     not by the double. So: never hand-build an event shape without reading the
//     emitter, and treat a widening cast on an event as a defect in review.
import { buildControlProposal, emitControlProposal } from "../lib/control-proposal.ts";
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
	| "headers"          // one shared object mutated in place; return ignored
	| "discard";         // return value read and dropped

/** Stand-in for the owning extension's path. fire() has no extension identity
 *  (see KNOWN-UNFAITHFUL #1), so every tagged path gets this one. */
export const TEST_EXTENSION_PATH = "test-extension";

export const EVENT_STRATEGY: Record<string, CombineStrategy> = {
	tool_result: "tool_result",              // runner.js:646-697
	context: "context",                      // runner.js:744-772
	message_end: "message_end",              // runner.js:607-644
	before_provider_request: "replace_payload", // runner.js:783-790
	before_provider_headers: "headers",      // runner.js:806-833 (mutate in place)
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
export type DeliveryVerdict =
	| "delivered"          // a turn ran immediately
	| "appended-no-turn"   // pushed to state.messages; the model sees it, no turn runs
	| "queued-next-turn"
	| "queued-steer"
	| "queued-follow-up"
	| "lost";

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
	const flags = new Map<string, unknown>();
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

	// sendMessage → sendCustomMessage (SESSION:1846-1852). Its ladder
	// (SESSION:1075-1094) has FOUR outcomes: nextTurn is checked first (so it wins
	// even while streaming and never consults triggerTurn); while streaming,
	// anything not "followUp" falls to steer; otherwise a TRUTHY triggerTurn runs
	// a real turn, and without one the message is only appended — no turn.
	const classify = (deliverAs: unknown, triggerTurn: unknown): DeliveryVerdict => {
		if (deliverAs === "nextTurn") return "queued-next-turn";
		if (streaming) return deliverAs === "followUp" ? "queued-follow-up" : "queued-steer";
		if (triggerTurn) return "delivered";
		return "appended-no-turn";
	};

	// sendUserMessage → prompt() (SESSION:1855-1862 → :1126-1131), a DIFFERENT
	// ladder: `deliverAs` becomes `streamingBehavior`, `triggerTurn` is never
	// passed, and _pendingNextTurnMessages is never touched. So "nextTurn" is not
	// special here — while streaming it STEERS, and while idle it runs a turn
	// immediately (":1097 Always triggers a turn"). Sharing classify() between the
	// two APIs was wrong in opposite directions.
	const classifyUserMessage = (deliverAs: unknown): DeliveryVerdict => {
		if (!streaming) return "delivered";
		return deliverAs === "followUp" ? "queued-follow-up" : "queued-steer";
	};

	const pi = {
		registerTool: (t: any) => tools.set(t.name, t),
		registerCommand: (name: string, def: any) => commands.set(name, def),
		registerFlag: (name: string, def: { default?: unknown }) => flags.set(name, def.default),
		getFlag: (name: string) => flags.get(name),
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
			deliveries.push({ api: "sendUserMessage", content, text, deliverAs, triggerTurn: opts?.triggerTurn, effective: classifyUserMessage(deliverAs) });
		},
		sendMessage: (message: unknown, opts?: { triggerTurn?: unknown; deliverAs?: unknown }) => {
			const text = textOf((message as any)?.content ?? message);
			// `sent` means "text that reached the model", from EITHER api — every
			// verdict but "lost" ends up in the payload. Recording sendUserMessage
			// only made `sent`-based assertions silently blind to sendMessage.
			sent.push(text);
			customDeliveries.push({
				api: "sendMessage", content: message, message, text,
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
			// event-bus.js:9-17 wraps EVERY subscriber in an async safeHandler with
			// try/catch, so one throwing tap can never break emit() or starve the
			// subscribers registered after it.
			emit: (channel: string, data: unknown) => {
				for (const handler of busHandlers.get(channel) ?? []) {
					try {
						const r: any = handler(data);
						if (r && typeof r.catch === "function") {
							r.catch((error: unknown) => swallowedErrors.push(error instanceof Error ? error.message : String(error)));
						}
					} catch (error) {
						swallowedErrors.push(error instanceof Error ? error.message : String(error));
					}
				}
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
			sessionManager: { getBranch: (): unknown[] => [] },
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
	/** LOOP:498 lands `afterResult.usage ?? result.usage` here — a tool_result
	 *  handler can rewrite it, so it is part of the contract. */
	usage?: unknown;
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
		// LOOP:466 hard-codes isError:false. Content is left UNNORMALIZED here on
		// purpose: pi normalizes at LOOP:537, i.e. AFTER the tool_result chain, so a
		// handler doing `event.content.push(...)` throws in pi. Normalizing first
		// would make the double quietly forgive that.
		result = { content: raw?.content, details: raw?.details, isError: false, terminate: raw?.terminate, usage: raw?.usage } as PiToolResult;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		result = { content: [{ type: "text", text: message }], details: {}, isError: true };
	}
	// pi runs finalizeExecutedToolCall — and therefore the tool_result handler
	// chain — after execute() settles, for BOTH the return and the throw paths
	// (agent-loop.js:316,357). Omitting this made observers like plan-runner's
	// write-rejected unreachable through callTool, so a test could only reach them
	// by hand-firing an event pi may never emit. Fire it here, apply the patch.
	// SESSION:240-249 is the full emitted shape — `type` and `usage` included. A
	// handler that guards on `event.type === "tool_result"` (the habit every other
	// pi event teaches) was a silent no-op here while running fine in production.
	const patch: any = await fire(fp, "tool_result", {
		type: "tool_result",
		toolCallId: "tc-test", toolName: name, input: params,
		content: result.content, details: result.details, isError: result.isError, usage: result.usage,
	}, ctx);
	if (patch) {
		if (patch.content !== undefined) result.content = patch.content;
		if (patch.details !== undefined) result.details = patch.details;
		if (patch.isError !== undefined) result.isError = patch.isError;
		if (patch.usage !== undefined) result.usage = patch.usage;
	}
	// LOOP:530-543 — normalization happens after the chain, not before.
	result.content = result.content ?? [];
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

	// EVERY emitter in runner.js except emitToolCall wraps the handler call in
	// try/catch → emitError → continue: a throwing handler is skipped and the
	// event proceeds as if it had returned undefined. `tool_call` alone
	// (runner.js:698-716) has no try/catch, so a throw there propagates and
	// blocks the call fail-safe. Every branch below routes through `safe` except
	// that one — the asymmetry is the contract, not an oversight.
	const safe = async (fn: any, ev2: unknown, c: unknown) => {
		try {
			return await fn(ev2, c);
		} catch (error) {
			fp.swallowedErrors.push(error instanceof Error ? error.message : String(error));
			return undefined;
		}
	};

	switch (strategy) {
		case "tool_result": {
			// runner.js:646-697. ONE object built before the loop and handed to every
			// handler, so in-place mutation is visible downstream. When anything was
			// modified pi returns all FOUR fields (carrying unmodified ones through),
			// not just the ones a handler set.
			const currentEvent: any = { ...(event as any) };
			let modified = false;
			for (const fn of fns) {
				const r = await safe(fn, currentEvent, ctx);
				if (!r) continue;
				// runner.js:659-674 sets `modified` INSIDE each `!== undefined` block,
				// so a return of `{}` — or of only keys pi ignores — leaves the event
				// unmodified and the emitter still returns undefined.
				for (const key of ["content", "details", "isError", "usage"]) {
					if (r[key] !== undefined) { currentEvent[key] = r[key]; modified = true; }
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
				const r = await safe(fn, { ...(event as any), messages: currentMessages }, ctx);
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
				const r = await safe(fn, { ...(event as any), message: currentMessage }, ctx);
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
				const r = await safe(fn, { type: "before_provider_request", payload: currentPayload }, ctx);
				if (r !== undefined) currentPayload = r;
			}
			return currentPayload;
		}
		case "agent_start": {
			// runner.js:834-887. messages APPEND; systemPrompt CHAINS.
			const messages: unknown[] = [];
			let systemPrompt = (event as any)?.systemPrompt;
			let promptModified = false;
			for (const fn of fns) {
				const r = await safe(fn, { ...(event as any), systemPrompt }, ctx);
				if (!r) continue;
				// runner.js:859-861 pushes on TRUTHINESS (an empty-string message is
				// dropped); :862-865 records the rewrite with a flag rather than by
				// comparing values, so a no-op rewrite still counts as modified.
				if (r.message) messages.push(r.message);
				if (r.systemPrompt !== undefined) { systemPrompt = r.systemPrompt; promptModified = true; }
			}
			if (!messages.length && !promptModified) return undefined;
			// runner.js:880-885 — both keys are always PRESENT once anything acted,
			// each undefined if that half was untouched.
			return {
				messages: messages.length > 0 ? messages : undefined,
				systemPrompt: promptModified ? systemPrompt : undefined,
			};
		}
		case "resources": {
			// runner.js:888-925. Concatenates the three path lists, TAGGING each path
			// with the owning extension: `.map((path) => ({path, extensionPath}))`.
			// Handlers return bare strings; consumers never see them.
			// KNOWN-UNFAITHFUL: fire() reads a flat handler map with no extension
			// identity (see the header note), so every path is tagged with one
			// placeholder rather than its real owner. Presence of the wrapper is
			// modelled; per-extension attribution is not.
			const skillPaths: unknown[] = [], promptPaths: unknown[] = [], themePaths: unknown[] = [];
			const tag = (p: unknown) => ({ path: p, extensionPath: TEST_EXTENSION_PATH });
			for (const fn of fns) {
				const r = await safe(fn, event, ctx);
				if (!r) continue;
				for (const p of r.skillPaths ?? []) skillPaths.push(tag(p));
				for (const p of r.promptPaths ?? []) promptPaths.push(tag(p));
				for (const p of r.themePaths ?? []) themePaths.push(tag(p));
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
				const r = await safe(fn, event, ctx);
				if (r) { result = r; if (r.cancel) return result; }
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
				const r = await safe(fn, { ...original, text, images }, ctx);
				if (!r) continue;
				if (r.action === "handled") return r;
				if (r.action === "transform") {
					// runner.js:947-948 — text is assigned UNCONDITIONALLY (a transform
					// that omits it wipes the prompt), images only via `?? currentImages`.
					text = r.text;
					images = r.images ?? images;
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
				const r: any = await safe(fn, event, ctx);
				if (r && r.trusted !== "undecided") return r;
			}
			return undefined;
		}
		case "first_wins": {
			for (const fn of fns) {
				const r = await safe(fn, event, ctx);
				if (r) return r;
			}
			return undefined;
		}
		case "headers": {
			// runner.js:806-833. One shared headers object is passed to every
			// handler, which MUTATES IT IN PLACE; the return value is ignored and
			// the same object comes back out.
			const headers: any = (event as any)?.headers ?? {};
			for (const fn of fns) await safe(fn, { type: "before_provider_headers", headers }, ctx);
			return headers;
		}
		default: {
			// Every handler runs; pi reads the return and drops it (runner.js:586).
			for (const fn of fns) await safe(fn, event, ctx);
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

/**
 * Emit a proposal that will BEAT the producer under test at `boundarySequence`.
 *
 * This is the primitive the suite was missing. `control-arbiter.test.ts` has 18
 * tests and every one asserts what the ARBITER emitted; not one asserts what a
 * producer's own state looks like after its proposal lost. That gap is why the
 * charge-at-proposal defect — fixed in tool-call-rescue and verify-gate's plateau
 * on 2026-08-21, with the incident written into both files — was never looked for
 * at the other fourteen charge sites.
 *
 * `terminal: true` additionally suppresses the arbiter's two merge rescues
 * (control-arbiter.ts:51-84 both require a `message` winner), which is the only way
 * to make verify-gate's wrap nag or session-blackboard's lens genuinely lose: both
 * are otherwise delivered as a merged suffix/prefix while `decision.winner` names
 * somebody else.
 *
 * Pair it with a REAL arbiter extension rather than a synthesised decision — the
 * merge behaviour above is exactly what a hand-built `ControlDecisionV1` cannot model.
 */
export function emitRivalProposal(
	fp: FakePi,
	boundarySequence: number,
	options: { terminal?: boolean; message?: string } = {},
): void {
	const effect = options.terminal ? "abort" : "message";
	const proposal = buildControlProposal({
		boundarySequence,
		kind: "safe_abort", // priority 700: outranks every other producer
		reason: "loop_recovery",
		source: "loop-breaker",
		cooldownKey: `rival:${boundarySequence}`,
		messageFactory: "loop-tier",
		effect,
		legacyActed: false,
	});
	emitControlProposal(fp.pi.events as never, proposal, options.terminal
		? { abort: () => {} }
		: { message: options.message ?? "[rival] change strategy now" });
}
