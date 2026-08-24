import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	isPositiveNumber, LARGE_FILE_BYTES, limitBypassesInletGate, resolveReadPath,
	RISKY_MAX_LIMIT, SUPPORT_FILE_BYTES,
} from "../lib/context-inlet.ts";
import { record } from "../lib/telemetry.ts";
import { emitHarnessSignal } from "../lib/harness-signals.ts";

type ReadInput = {
	path?: unknown;
	offset?: unknown;
	limit?: unknown;
};

const RISKY_EXTENSIONS = new Set([".csv", ".tsv", ".jsonl", ".ndjson", ".log", ".trace", ".parquet"]);
// Generic format/role markers for big low-value files (project-agnostic). Add
// project-specific markers with CTX_GUARD_RISKY=part1,part2 (comma list, appends).
const RISKY_PATH_PARTS = [
	"trace",
	"session",
	"dump",
	"snapshot",
	"backup",
	"generated",
	...(process.env.CTX_GUARD_RISKY || "")
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean),
];

function riskySupportPath(path: string): boolean {
	const lowerPath = path.toLowerCase();
	const lowerBase = basename(lowerPath);
	return RISKY_EXTENSIONS.has(extname(lowerBase)) || RISKY_PATH_PARTS.some((part) => lowerPath.includes(part));
}

function blockReason(path: string, bytes: number, risky: boolean): string {
	const kind = risky ? "support/risky" : "large";
	return `failure_class=context_intake_risk. ${kind} file ${path} (${bytes}B) — bounded read only. Use rg/head/tail or narrow limit+offset, then summarise before more reads.`;
}

// How many times we have already blocked an unbounded read of each path this
// session. Lets us escalate the message instead of repeating it identically.
const blockCounts = new Map<string, number>();

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		blockCounts.clear();
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "read") return;

		const input = event.input as ReadInput;
		if (typeof input.path !== "string" || !input.path.trim()) return;

		// A positive page no larger than the shared line cap is bounded intake.
		// Previously any positive limit bypassed normal-file guarding, so a caller
		// could ask for the built-in tool's entire ~50 KiB response ceiling.
		const risky = riskySupportPath(input.path);
		const bigLimit = limitBypassesInletGate(input.limit);
		if (isPositiveNumber(input.limit) && !bigLimit) return;

		let bytes: number;
		const resolvedPath = resolveReadPath(ctx.cwd, input.path);
		try {
			const info = await stat(resolvedPath);
			if (!info.isFile()) return;
			bytes = info.size;
		} catch {
			// Let the read tool report missing/permission errors itself.
			return;
		}

		// Threshold per risk class directly — the old 20KB small-file early-return
		// made the 8KB risky threshold unreachable dead code (any file under 20KB
		// skipped the check before the risky threshold was ever consulted).
		const threshold = risky ? SUPPORT_FILE_BYTES : LARGE_FILE_BYTES;
		if (bytes <= threshold) return;

		const key = resolvedPath;
		const n = (blockCounts.get(key) ?? 0) + 1;
		blockCounts.set(key, n);
		record("context-inlet-guard", "block", { risky, bytes, n, bigLimit });
		emitHarnessSignal(pi.events, { v: 1, type: "capability/need", capability: "span_tools", reason: "inlet-refusal" });

		const reason = bigLimit
			? `failure_class=context_intake_risk. limit=${input.limit} on ${risky ? "risky" : "large"} file ${input.path} (${bytes}B) defeats bounded intake — page it: limit ≤ ${RISKY_MAX_LIMIT} lines per read, or use rg/head/tail.`
			: n >= 3
				? `failure_class=context_intake_risk. Told ${n}× to bounded-read ${input.path}. STOP the unbounded read. Use rg/head/tail or pass a positive limit NOW, or act on what you have. Repeats stay blocked.`
				: blockReason(input.path, bytes, risky);

		return { block: true, reason };
	});
}
