// Shared fake ExtensionAPI for extension INTEGRATION tests (audit: 913-line
// runtime adapters had pure-policy tests only — API-shape mistakes like reading
// r.exitCode where ExecResult carries r.code are invisible to policy tests).
// exec() is REAL (child_process) and returns the genuine ExecResult shape, so a
// wrong field name fails here exactly as it would in pi.
import { execFile } from "node:child_process";

export type FakePi = ReturnType<typeof makeFakePi>;

export function makeFakePi() {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const handlers = new Map<string, any[]>();
	const sent: string[] = [];
	const deliveries: Array<{ text: string; deliverAs: unknown }> = [];
	const customDeliveries: Array<{ message: unknown; triggerTurn: unknown; deliverAs: unknown }> = [];
	const entries: Array<{ type: string; data: unknown }> = [];
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
		sendUserMessage: (text: string, opts?: { deliverAs?: unknown }) => {
			sent.push(text);
			deliveries.push({ text, deliverAs: opts?.deliverAs });
		},
		sendMessage: (message: unknown, opts?: { triggerTurn?: unknown; deliverAs?: unknown }) => {
			customDeliveries.push({ message, triggerTurn: opts?.triggerTurn, deliverAs: opts?.deliverAs });
		},
		getActiveTools: () => [] as string[],
		appendEntry: (type: string, data: unknown) => entries.push({ type, data }),
	};
	return { pi, tools, commands, handlers, sent, deliveries, customDeliveries, entries };
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

// Run a registered tool the way pi does: execute(toolCallId, params, signal, onUpdate, ctx)
export async function callTool(fp: FakePi, name: string, params: unknown, cwd: string) {
	const tool = fp.tools.get(name);
	if (!tool) throw new Error(`tool not registered: ${name}`);
	return tool.execute("tc-test", params, undefined, undefined, {
		cwd,
		model: { provider: "test-provider", id: "test-model" },
	});
}

// Fire an event through all registered handlers; returns the first non-undefined result
export async function fire(fp: FakePi, ev: string, event: unknown, ctx?: unknown) {
	for (const fn of fp.handlers.get(ev) ?? []) {
		const r = await fn(event, ctx);
		if (r !== undefined) return r;
	}
	return undefined;
}
