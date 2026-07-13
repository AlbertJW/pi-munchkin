import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { extractReflectFindings, MAX_ARTIFACT, MAX_ROUNDS, METHODS, REFLECT_PROMPT, shouldIterate, voteFindings } from "../lib/reflect-policy.ts";
import { steerText } from "../lib/steer-texts.ts";
import { record } from "../lib/telemetry.ts";

// /reflect — fresh-context adversarial review of the current plan (or, with no
// plan, the last assistant answer). NOT an in-context self-refine loop: the
// review runs out-of-band (drift-scanner's pattern), returns a bounded findings
// contract (blockers/risks/cuts/verify only — adding scope is forbidden), and
// the session model then revises via plan_write. Manual re-invocation is the
// loop; MAX_ROUNDS caps it; "CLEAN" ends it silently.
//
// Phase 2 (optillm): `/reflect <model-id>` reviews with a different models.json
// entry (e.g. an OptiLLM-proxied reasoning pipeline). Any unknown arg is noted.

const TIMEOUT_MS = Number.parseInt(process.env.REFLECT_TIMEOUT_MS || "120000", 10) || 120_000;

let rounds = 0;
let lastAssistantText = "";

async function planArtifact(cwd: string): Promise<string | null> {
	const p = join(cwd, ".pi", "TODO.md");
	try {
		if (!(await stat(p)).isFile()) return null;
		const text = await readFile(p, "utf8");
		return text.trim() ? text.slice(0, MAX_ARTIFACT) : null;
	} catch {
		return null;
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		rounds = 0;
		lastAssistantText = "";
	});

	// Track the latest assistant text so /reflect works on answers, not just plans.
	pi.on("turn_end", async (event) => {
		const msg = event.message;
		if (msg.role !== "assistant") return;
		const text = msg.content
			.filter((c) => c.type === "text")
			.map((c) => ("text" in c ? (c.text ?? "") : ""))
			.join("\n")
			.trim();
		if (text) lastAssistantText = text.slice(0, MAX_ARTIFACT);
	});

	pi.registerCommand("reflect", {
		description: `Fresh-context review of the current plan (or last answer). Bounded findings, never adds scope, max ${MAX_ROUNDS} rounds. Methods: ${Object.keys(METHODS).join(", ")} — '/reflect <method>'; '/reflect help' describes them.`,
		handler: async (args, ctx) => {
			const rawArg = (args ?? "").trim().toLowerCase();
			if (rawArg === "help" || rawArg === "?" || rawArg === "list") {
				const lines = Object.entries(METHODS).map(([k, v]) => `  ${k} — ${v.blurb}`);
				ctx.ui.notify(`reflect methods:\n${lines.join("\n")}`, "info");
				return;
			}
			if (!shouldIterate(rounds, "pending")) {
				ctx.ui.notify(`reflect: round cap reached (${MAX_ROUNDS}) — act on the findings or start a fresh plan`, "warning");
				return;
			}
			const artifact = (await planArtifact(ctx.cwd)) ?? (lastAssistantText || null);
			if (!artifact) {
				ctx.ui.notify("reflect: nothing to review (no .pi/TODO.md and no assistant output yet)", "info");
				return;
			}

			const model = ctx.model;
			const method = METHODS[rawArg || "default"];
			if (rawArg && !method) {
				ctx.ui.notify(`reflect: unknown method '${rawArg}' (have: ${Object.keys(METHODS).join(", ")}) — using default`, "info");
			}
			const m = method ?? METHODS.default;
			if (!model) {
				ctx.ui.notify("reflect: no active model", "warning");
				return;
			}

			try {
				const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
				if (!auth.ok) {
					record("reflect", "review-error", { error: "auth" });
					ctx.ui.notify("reflect: cannot authenticate the reviewer model", "warning");
					return;
				}
				ctx.ui.notify(`reflect: reviewing (round ${rounds + 1}/${MAX_ROUNDS}${m.samples > 1 ? `, ${m.samples}-sample vote` : ""})…`, "info");
				const samples: Array<string | null> = [];
				for (let i = 0; i < m.samples; i++) {
					const review = await completeSimple(
						model,
						{ systemPrompt: m.prompt ?? REFLECT_PROMPT, messages: [{ role: "user", content: artifact, timestamp: Date.now() }] },
						{
							timeoutMs: TIMEOUT_MS,
							maxRetries: 0,
							reasoning: "minimal",
							temperature: m.temperature,
							signal: ctx.signal,
							apiKey: auth.apiKey,
							headers: auth.headers,
						},
					);
					samples.push(extractReflectFindings(review.content as Array<{ type: string; text?: string }>, review.stopReason));
				}
				const findings = m.samples > 1 ? voteFindings(samples, m.minVotes) : samples[0];
				rounds += 1;
				if (!findings) {
					record("reflect", "review", { round: rounds, clean: true });
					ctx.ui.notify("reflect: CLEAN — nothing material", "info");
					return;
				}
				record("reflect", "review", { round: rounds, clean: false, chars: findings.length });
				pi.sendUserMessage(
					steerText(
						"REFLECT_FINDINGS",
						"[reflect] Review findings (round {round}/{max}) — revise the plan with plan_write (or amend your answer), addressing or explicitly rejecting each. Do NOT add scope beyond fixing these:\n\n{findings}",
						{ round: rounds, max: MAX_ROUNDS, findings },
					),
					{ deliverAs: "followUp" },
				);
			} catch (e) {
				record("reflect", "review-error", { error: String((e as Error)?.message ?? e).slice(0, 150) });
				ctx.ui.notify(`reflect: review failed (${String((e as Error)?.message ?? e).slice(0, 80)})`, "warning");
			}
		},
	});
}
