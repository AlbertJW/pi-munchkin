// context-brief (DARK: CONTEXT_BRIEF=on — munchkin candidate c30, not a
// default). Appends a bounded, pre-computed environment brief to the system
// prompt so the model skips discovery turns (ls/find/cat-package.json). The
// brief is computed ONCE per session and cached — the system prompt (and so
// the KV prefix and context-surface's system_prompt_sha256) stays stable
// within a session. Git section fail-open: a broken git never breaks a run.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildBrief } from "../lib/context-brief.ts";
import { record } from "../lib/telemetry.ts";

const ENABLED = process.env.CONTEXT_BRIEF === "on";
const MAX_BYTES = Math.max(256, Number.parseInt(process.env.CONTEXT_BRIEF_BYTES || "2048", 10) || 2048);

export default function (pi: ExtensionAPI) {
	if (!ENABLED) return;
	let cached: string | null = null;

	pi.on("session_start", async () => {
		cached = null;
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (cached === null) {
			let gitSummary: string | undefined;
			try {
				const r = await pi.exec("git", ["status", "--porcelain", "--branch"], { cwd: ctx.cwd, timeout: 3000 });
				if (r.code === 0) {
					const lines = r.stdout.trim().split("\n");
					const branch = lines[0]?.replace(/^## /, "") ?? "";
					gitSummary = `${branch}; ${Math.max(0, lines.length - 1)} changed file(s)`;
				}
			} catch {
				// fail-open: omit the git section entirely
			}
			const brief = buildBrief(ctx.cwd, { maxBytes: MAX_BYTES, gitSummary });
			cached = brief.text;
			record("context-brief", "injected", { brief_bytes: brief.bytes, entries: brief.entries, truncated: brief.truncated });
		}
		if (!cached) return;
		return { systemPrompt: `${event.systemPrompt}\n\n## Environment brief (generated — trust it, skip rediscovery)\n${cached}` };
	});
}
