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

	// HEAD hashes already handled (reviewed or skipped), per cwd: a commit ATTEMPT
	// that a pre-commit hook aborted leaves HEAD unmoved — the freshness window
	// alone would re-review the previous turn's commit (audit 2026-07-13).
	const handledHead = new Map<string, string>();
	// One review at a time per cwd. The review is now detached (below), so two
	// commits in quick succession could otherwise overlap and double-inject.
	const reviewing = new Set<string>();

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
			const ct = await pi.exec("git", ["show", "-s", "--format=%ct %H", "HEAD"], { cwd: ctx.cwd, timeout: 10_000 });
			const [ctsRaw, headHash] = (ct.stdout || "").trim().split(/\s+/);
			const committedAt = Number(ctsRaw);
			if (!Number.isFinite(committedAt) || !headHash) return; // no repo / no HEAD / parse fail
			// HEAD didn't move since we last handled it -> this turn's commit attempt
			// failed (hook abort / empty stage); do NOT re-review the previous commit.
			if (handledHead.get(ctx.cwd) === headHash) return;
			if (Math.floor(Date.now() / 1000) - committedAt > FRESH_SECS) return; // no commit landed this turn
			// The in-flight guard must come BEFORE the handled-mark. In the original
			// detach fix these were the other way around, so a commit landing while a
			// review for the same cwd was still running got marked handled on the way
			// to the bail — and was then never reviewed at all (2026-07-30 triage #11).
			// Bailing UNMARKED gives the swallowed commit a chance at recovery — but
			// only a chance, not a guarantee: the next turn_end re-reviews only if
			// HEAD has not moved past it (the review always targets HEAD, and the
			// bail above returns early when this turn ran no fresh commit). A commit
			// swallowed mid-review and then FOLLOWED by another commit stays
			// unreviewed. Accepted: drift-scanner is advisory, and reviewing only
			// the latest commit is its normal behaviour elsewhere too.
			if (reviewing.has(ctx.cwd)) return; // a review for this cwd is already running
			handledHead.set(ctx.cwd, headHash);

			const show = await pi.exec("git", ["show", "--format=", "HEAD"], { cwd: ctx.cwd, timeout: 10_000 });
			const diff = (show.stdout || "").trim();
			if (!diff) return; // e.g. a merge/empty commit with no diff → nothing to review

			const { text, truncated } = buildTruncatedDiff(diff);
			const body = (truncated ? `[diff truncated to first ${MAX_DIFF} chars]\n\n` : "") + text;

			// DETACHED from here on. pi awaits extension handlers serially inside the
			// agent loop, so awaiting a 90-second local-model review here froze the
			// whole session on every reviewable commit — no streaming, no tool calls,
			// nothing, for up to a minute and a half (confirmed 2026-07-30). The review
			// is advisory and non-blocking by design; its RESULT arrives as a followUp
			// message whenever it is ready, which is exactly the semantics we want.
			// Everything above stays awaited: the guards are cheap, and handledHead is
			// set before this point (with the in-flight bail ordered before the mark)
			// so the started-review path never re-reviews the same commit.
			reviewing.add(ctx.cwd);
			void (async () => {
			try {
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) {
				record("drift-scanner", "review-skipped", { why: "auth" });
				return; // can't authenticate this model → fail open
			}
			record("drift-scanner", "review-start", { diffChars: body.length, truncated });

			const review = await completeSimple(
				model,
				{ systemPrompt: REVIEW_PROMPT, messages: [{ role: "user", content: body, timestamp: Date.now() }] },
				// reasoning:"minimal" routes the model's chain-of-thought into a separate
				// thinking block (which extractFindings drops) instead of leaking it into
				// the answer — without it, a small local reasoning model dumps its whole
				// deliberation into the text channel. Verified: still catches real drift.
				//
				// ctx.signal is deliberately NOT passed now that this is detached: the
				// signal is scoped to the agent run that triggered it, so a review still
				// in flight when the run ends would be aborted precisely when it was
				// about to deliver. timeoutMs remains the bound.
				{ timeoutMs: TIMEOUT_MS, maxRetries: 0, reasoning: "minimal", apiKey: auth.apiKey, headers: auth.headers },
			);
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
				// Detached: nothing upstream can catch this, and a stale pi/ctx after
				// session replacement throws here. Fail open silently, as before.
				record("drift-scanner", "review-error", { error: String((e as Error)?.message ?? e).slice(0, 150) });
			} finally {
				reviewing.delete(ctx.cwd);
			}
			})();
		} catch (e) {
			record("drift-scanner", "review-error", { error: String((e as Error)?.message ?? e).slice(0, 150) });
			return; // git error / endpoint down / timeout / aborted → fail open silently
		}
	});
}
