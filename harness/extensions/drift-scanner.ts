import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { buildTruncatedDiff, extractFindings, isReviewableCommit, MAX_DIFF, REVIEW_PROMPT } from "../lib/drift-policy.ts";

// Advisory drift / dead-code reviewer.
//
// When a turn ran a `git commit` via the bash tool, ask THE CURRENTLY-SELECTED
// SESSION MODEL (ctx.model) to flag only drift the commit introduced: dead
// references, orphaned definitions, and stale comments/docs — the class of defect
// a deterministic gate can't catch. Surfaced as a non-blocking `followUp` so the
// agent can make a fixup commit.
//
// Runs at `turn_end` (fires AFTER the turn's tools execute), not at the pre-exec
// `tool_call`, so: the commit has actually happened, `git show HEAD` reflects
// exactly what landed (including a compound `git add … && git commit`), and a
// freshness check rejects commits an abort/pre-commit-hook never created. The
// review is awaited here (the documented place for async model work, with
// ctx.signal for Esc-cancel) so delivery is deterministic.
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
		if (!model) return; // no active model → nothing to review with

		try {
			// Confirm a commit actually landed this turn: HEAD must be fresh. This
			// rejects pre-commit-hook aborts and empty-stage no-ops (which leave a
			// stale prior HEAD), so `git show HEAD` is exactly what was just committed.
			const ct = await pi.exec("git", ["show", "-s", "--format=%ct", "HEAD"], { cwd: ctx.cwd, timeout: 10_000 });
			const committedAt = Number((ct.stdout || "").trim());
			if (!Number.isFinite(committedAt)) return; // no repo / no HEAD / parse fail
			if (Math.floor(Date.now() / 1000) - committedAt > FRESH_SECS) return; // no commit landed this turn

			const show = await pi.exec("git", ["show", "--format=", "HEAD"], { cwd: ctx.cwd, timeout: 10_000 });
			const diff = (show.stdout || "").trim();
			if (!diff) return; // e.g. a merge/empty commit with no diff → nothing to review

			const { text, truncated } = buildTruncatedDiff(diff);
			const body = (truncated ? `[diff truncated to first ${MAX_DIFF} chars]\n\n` : "") + text;

			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) return; // can't authenticate this model → fail open

			const review = await completeSimple(
				model,
				{ systemPrompt: REVIEW_PROMPT, messages: [{ role: "user", content: body, timestamp: Date.now() }] },
				// reasoning:"minimal" routes the model's chain-of-thought into a separate
				// thinking block (which extractFindings drops) instead of leaking it into
				// the answer — without it, a small local reasoning model dumps its whole
				// deliberation into the text channel. Verified: still catches real drift.
				{ timeoutMs: TIMEOUT_MS, maxRetries: 0, reasoning: "minimal", signal: ctx.signal, apiKey: auth.apiKey, headers: auth.headers },
			);
			const findings = extractFindings(review.content as Array<{ type: string; text?: string }>, review.stopReason);
			if (!findings) return; // CLEAN / empty / non-"stop" finish → nothing to surface

			// Clamp: reviewer output is model-generated and unbounded; injecting it
			// verbatim can dump thousands of tokens into a 30k window.
			const clamped = findings.length > 4000 ? `${findings.slice(0, 4000)}\n…[drift review truncated]` : findings;

			pi.sendUserMessage(
				"[drift-scanner] Advisory review of your latest commit — possible drift it introduced " +
					"(non-blocking). Make a fixup commit if real; ignore false positives. (DRIFT_SCANNER=off disables.)\n\n" +
					clamped,
				{ deliverAs: "followUp" },
			);
		} catch {
			return; // git error / endpoint down / timeout / aborted → fail open silently
		}
	});
}
