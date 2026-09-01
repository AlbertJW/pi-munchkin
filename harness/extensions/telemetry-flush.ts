import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { flushTelemetry } from "../lib/telemetry.ts";

/** Interactive async telemetry is observational, but settlement/shutdown are
 * durability boundaries. Authoritative FD/gate telemetry remains synchronous. */
export default function (pi: ExtensionAPI): void {
	// Pi's print-mode SIGTERM path emits session_shutdown before it invalidates the
	// session. If an agent is still streaming, merely flushing here races the
	// runtime disposal and loses the agent_settled boundary that gate rows require.
	// Abort first, then wait for the actual settlement callback (not just isIdle:
	// AgentSession marks itself idle before awaiting settlement handlers). The wait
	// is bounded below print-mode's 30s hard-kill grace, so a stuck provider cannot
	// turn shutdown into an unbounded hang.
	const shutdownSettleWaitMs = 25_000;
	let resolveSettlement: (() => void) | undefined;
	let settlementWait: Promise<void> | undefined;
	const waitForSettlement = (): Promise<void> => {
		settlementWait ??= new Promise<void>((resolve) => { resolveSettlement = resolve; });
		return settlementWait;
	};
	const settleWaiter = (): void => {
		resolveSettlement?.();
		resolveSettlement = undefined;
		settlementWait = undefined;
	};
	const bounded = async (promise: Promise<void>): Promise<void> => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				promise,
				new Promise<void>((resolve) => { timer = setTimeout(resolve, shutdownSettleWaitMs); }),
			]);
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
	};

	pi.on("agent_settled", async () => flushTelemetry());
	pi.on("agent_settled", async () => settleWaiter());
	pi.on("session_shutdown", async (_event, ctx) => {
		if (typeof ctx.isIdle === "function" && !ctx.isIdle() && typeof ctx.abort === "function") {
			const settled = waitForSettlement();
			try { ctx.abort(); } catch { /* disposal will still flush what is durable */ }
			await bounded(settled);
		}
		await flushTelemetry();
	});
}
