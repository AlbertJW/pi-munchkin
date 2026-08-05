import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { buildTruncatedDiff, extractFindings, isReviewableCommit, MAX_DIFF, REVIEW_PROMPT } from "../lib/drift-policy.ts";
import { record } from "../lib/telemetry.ts";

// Advisory drift / dead-code reviewer.
//
// When a turn ran a `git commit` via the bash tool, ask THE CURRENTLY-SELECTED
// SESSION MODEL (ctx.model) to flag only drift the commit introduced: dead
// references, orphaned definitions, and stale comments/docs — the class of defect
// a deterministic gate can't catch. Surfaced as a non-blocking `followUp` so the
// agent can make a fixup commit.
//
// `turn_end` captures the landed HEAD and bounded diff. Model review starts only
// after `agent_settled`, and is aborted by the next `before_agent_start` or shutdown,
// so an advisory review cannot contend with the coding run on a single-slot
// local server. HEAD and session generation are rechecked before delivery.
//
// Reviewer = the live session model, so the diff only ever goes where the session
// is already going (local→local, cloud→cloud — no new data egress). Auth is
// resolved per-model via ctx.modelRegistry.getApiKeyAndHeaders (the same call the
// harness uses internally in sdk.ts — completeSimple does not pull the key itself).
//
// Every unhappy path — no commit this turn, no active model, no/stale HEAD, empty
// diff, can't authenticate, endpoint down, timeout, aborted, non-"stop" finish —
// fails open silently. Disable with DRIFT_SCANNER=off.

const ENABLED = process.env.DRIFT_SCANNER !== "off";
const TIMEOUT_MS = 90_000; // the local 35B is slow; bound the worst case
const FRESH_SECS = 300; // HEAD older than this wasn't the commit this turn just made

export default function (pi: ExtensionAPI) {
	if (!ENABLED) return;

	const handledHead = new Map<string, string>();
	type Pending = {
		cwd: string; headHash: string; body: string; truncated: boolean; generation: number;
		model: any; modelRegistry: any;
	};
	const pending = new Map<string, Pending>();
	let generation = 0;
	let active: { controller: AbortController; generation: number } | null = null;

	function abortBusy(): void {
		if (!active || active.controller.signal.aborted) return;
		active.controller.abort();
		record("drift-scanner", "review-skipped", { why: "aborted-busy" });
	}

	pi.on("before_agent_start", async () => {
		generation += 1;
		abortBusy();
	});

	pi.on("session_shutdown", async () => {
		generation += 1;
		pending.clear();
		abortBusy();
	});

	pi.on("turn_end", async (event, ctx) => {
		const msg = event.message;
		if (msg.role !== "assistant") return;

		// Did this turn run a reviewable `git commit` via the bash tool? (verify-gate pattern)
		let committed = false;
		for (const block of msg.content) {
			if (block.type !== "toolCall" || block.name !== "bash") continue;
			const command = String((block.arguments as Record<string, unknown> | undefined)?.command ?? "");
			if (isReviewableCommit(command)) {
				committed = true;
				break;
			}
		}
		if (!committed) return;

		const model = ctx.model;
		if (!model) return;

		try {
			// Confirm a commit actually landed this turn: HEAD must be fresh. This
			// rejects pre-commit-hook aborts and empty-stage no-ops (which leave a
			// stale prior HEAD), so `git show HEAD` is exactly what was just committed.
			const ct = await pi.exec("git", ["show", "-s", "--format=%ct %H", "HEAD"], { cwd: ctx.cwd, timeout: 10_000 });
			const [ctsRaw, headHash] = (ct.stdout || "").trim().split(/\s+/);
			const committedAt = Number(ctsRaw);
			if (!Number.isFinite(committedAt) || !headHash) return; // no repo / no HEAD / parse fail
			// HEAD didn't move since we last handled it -> this turn's commit attempt
			// failed (hook abort / empty stage); do NOT re-review the previous commit.
			if (handledHead.get(ctx.cwd) === headHash) return;
			if (Math.floor(Date.now() / 1000) - committedAt > FRESH_SECS) return; // no commit landed this turn
			handledHead.set(ctx.cwd, headHash);

			const show = await pi.exec("git", ["show", "--format=", "HEAD"], { cwd: ctx.cwd, timeout: 10_000 });
			const diff = (show.stdout || "").trim();
			if (!diff) return; // e.g. a merge/empty commit with no diff → nothing to review

			const { text, truncated } = buildTruncatedDiff(diff);
			const body = (truncated ? `[diff truncated to first ${MAX_DIFF} chars]\n\n` : "") + text;

			// Capture only while the agent is active. Model work starts after agent_settled,
			// so it never contends with the coding run on a single-slot server.
			pending.set(ctx.cwd, {
				cwd: ctx.cwd, headHash, body, truncated, generation,
				model, modelRegistry: ctx.modelRegistry,
			});
		} catch (e) {
			record("drift-scanner", "review-error", { error: String((e as Error)?.message ?? e).slice(0, 150) });
		}
	});

	pi.on("agent_settled", async () => {
		const next = [...pending.values()].at(-1);
		if (!next) return;
		pending.delete(next.cwd); // one shot: busy/abort/stale outcomes are not retried
		if (active) {
			record("drift-scanner", "review-skipped", { why: "aborted-busy" });
			return;
		}
		const controller = new AbortController();
		active = { controller, generation: next.generation };
		void (async () => {
			try {
			const auth = await next.modelRegistry.getApiKeyAndHeaders(next.model);
			if (controller.signal.aborted || generation !== next.generation) return;
			if (!auth.ok) {
				record("drift-scanner", "review-skipped", { why: "auth" });
				return;
			}
			record("drift-scanner", "review-start", { diffChars: next.body.length, truncated: next.truncated });

			const review = await completeSimple(
				next.model,
				{ systemPrompt: REVIEW_PROMPT, messages: [{ role: "user", content: next.body, timestamp: Date.now() }] },
				// reasoning:"minimal" routes the model's chain-of-thought into a separate
				// thinking block (which extractFindings drops) instead of leaking it into
				// the answer — without it, a small local reasoning model dumps its whole
				// deliberation into the text channel. Verified: still catches real drift.
				//
				// A review-owned signal lives beyond the completed coding run, but is
				// aborted immediately when a new coding run begins.
				{ timeoutMs: TIMEOUT_MS, maxRetries: 0, reasoning: "minimal", apiKey: auth.apiKey, headers: auth.headers, signal: controller.signal },
			);
			if (controller.signal.aborted || generation !== next.generation) return;
			const current = await pi.exec("git", ["rev-parse", "HEAD"], { cwd: next.cwd, timeout: 10_000 });
			if ((current.stdout || "").trim() !== next.headHash) {
				record("drift-scanner", "review-skipped", { why: "stale-head" });
				return;
			}
			const findings = extractFindings(review.content as Array<{ type: string; text?: string }>, review.stopReason);
			if (!findings) {
				const textLen = (review.content as Array<{ type: string; text?: string }>)
					.filter((c) => c.type === "text")
					.reduce((n, c) => n + (c.text?.length ?? 0), 0);
				record("drift-scanner", "review-null", { stopReason: review.stopReason, textLen });
				return; // CLEAN / empty / non-"stop" finish → nothing to surface
			}
			record("drift-scanner", "advisory", { chars: findings.length });

			// Clamp: reviewer output is model-generated and unbounded; injecting it
			// verbatim can dump thousands of tokens into a 30k window.
			const clamped = findings.length > 4000 ? `${findings.slice(0, 4000)}\n…[drift review truncated]` : findings;

			pi.sendUserMessage(
				"[drift-scanner] Advisory review of your latest commit — possible drift it introduced " +
					"(non-blocking). Make a fixup commit if real; ignore false positives. (DRIFT_SCANNER=off disables.)\n\n" +
					clamped,
				{ deliverAs: "followUp" },
			);
			} catch (e) {
				if (controller.signal.aborted) return;
				record("drift-scanner", "review-error", { error: String((e as Error)?.message ?? e).slice(0, 150) });
			} finally {
				if (active?.controller === controller) active = null;
			}
			})();
	});
}
