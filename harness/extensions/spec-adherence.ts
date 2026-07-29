import { existsSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { record } from "../lib/telemetry.ts";

// Dark candidate c50 (SPEC_ADHERENCE=on): the retry-trap round measured a new
// failure class — 12/12 sessions found the causal file but GUESSED conventions
// from prior knowledge instead of reading the spec the prompt explicitly named
// as authoritative (German-style ö→oe where docs/naming.md says ö→o). This
// sensor closes that gap with ground truth only: it knows which prompt-named
// files exist on disk, knows which were read, and steers once — after failure
// has actually set in — toward the unread one. Inert (zero surface) whenever
// the prompt names no on-disk files, which makes exposure semantics clean.

const ENABLED = process.env.SPEC_ADHERENCE === "on";
const FAILING_ATTEMPTS_BEFORE_STEER = 2;
const MAX_STEERS = 2;

// Path-like tokens ending in a doc/data extension, plus bare docs/… forms.
const PATH_RE = /(?:\.{0,2}\/)?[\w][\w./-]*\.(?:md|txt|json|yaml|yml)\b/g;

export function extractSpecPaths(prompt: string, cwd: string, exists: (p: string) => boolean = existsSync): string[] {
	const seen = new Set<string>();
	for (const raw of prompt.match(PATH_RE) ?? []) {
		const cleaned = normalize(raw.replace(/^\.\//, ""));
		if (isAbsolute(cleaned) || cleaned.startsWith("..")) continue; // stay inside the task cwd
		if (!seen.has(cleaned) && exists(join(cwd, cleaned))) seen.add(cleaned);
	}
	return [...seen];
}

export function steerMessage(path: string): string {
	return (
		`[spec-adherence] The task names \`${path}\` as an authoritative reference and it has not been read ` +
		"this session. Read it before the next attempt — verify your assumptions against it instead of guessing."
	);
}

const MUTATION_TOOLS = new Set(["edit", "write", "multiedit", "bash"]);
const READ_CAT_RE = /\b(?:cat|head|tail|less|more|sed|grep|awk)\b[^|;&]*/g;

export default function (pi: ExtensionAPI): void {
	if (!ENABLED) return;
	let specs: string[] = [];
	let readSpecs = new Set<string>();
	let failingAttempts = 0;
	let steers = 0;
	let cwd = process.cwd();

	pi.on("session_start", async (_event, ctx) => {
		specs = [];
		readSpecs = new Set();
		failingAttempts = 0;
		steers = 0;
		cwd = ctx.cwd ?? process.cwd();
	});

	pi.on("before_agent_start", async (event) => {
		if (specs.length > 0) return undefined; // first prompt wins; steers are per-session
		const prompt = (event as { prompt?: string }).prompt;
		if (typeof prompt !== "string" || !prompt) return undefined;
		specs = extractSpecPaths(prompt, cwd);
		if (specs.length > 0) record("spec-adherence", "armed", { specs: specs.length });
		return undefined;
	});

	pi.on("tool_execution_end", async (event) => {
		const name = event.toolName;
		const args = ((event as { args?: Record<string, unknown> }).args ?? {}) as Record<string, unknown>;
		if (specs.length === 0) return;
		if ((name === "read" || name === "read_span") && typeof args.path === "string") {
			for (const spec of specs) if (normalize(String(args.path)).endsWith(spec)) readSpecs.add(spec);
		} else if (name === "bash" && typeof args.command === "string") {
			for (const segment of args.command.match(READ_CAT_RE) ?? []) {
				for (const spec of specs) if (segment.includes(spec)) readSpecs.add(spec);
			}
		}
		if (event.isError && MUTATION_TOOLS.has(name)) failingAttempts += 1;
	});

	pi.on("turn_end", async (event) => {
		if (specs.length === 0 || steers >= MAX_STEERS) return;
		if (failingAttempts < FAILING_ATTEMPTS_BEFORE_STEER) return;
		const unread = specs.find((s) => !readSpecs.has(s));
		if (!unread) return;
		steers += 1;
		readSpecs.add(unread); // once per path — treat the steer as having surfaced it
		record("spec-adherence", "steered", { path: unread, turnIndex: event.turnIndex });
		try {
			pi.sendUserMessage(steerMessage(unread), { deliverAs: "steer" });
		} catch { /* stale pi — session replaced */ }
	});
}
