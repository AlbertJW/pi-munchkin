import { existsSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { record } from "../lib/telemetry.ts";

// Dark candidate c50 (SPEC_ADHERENCE=on). This sensor uses ground truth only:
// it knows which prompt-named files exist on disk, knows which were read, and
// steers once — after failure has actually set in — toward the unread one.
// Inert (zero surface) whenever the prompt names no on-disk files, which makes
// exposure semantics clean.
//
// PREMISE RETRACTED 2026-07-30. This header used to justify the candidate with
// "12/12 sessions found the causal file but GUESSED conventions instead of
// reading the spec the prompt named". That observation was a HARNESS ARTIFACT:
// real_gate.sh materialized fixtures from an allowlist that omitted docs/, so
// docs/naming.md was never in the model's workdir. The models did not skip an
// available spec — there was none. See MEASUREMENT_METHODOLOGY_2026-07.md §9
// and PREREG_C50_RETRYTRAP_2026-07-29.md. The mechanism below is UNMEASURED:
// neither supported nor refuted. Do not restate the withdrawn claim.

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

/** Suffix match on a PATH BOUNDARY: `docs/other-naming.md` must not satisfy a
 *  spec of `naming.md`. A bare `.endsWith(spec)` did exactly that. */
export function pathMatchesSpec(readPath: string, spec: string): boolean {
	const p = normalize(readPath);
	return p === spec || p.endsWith(`/${spec}`);
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
	/** tool_execution_start args, held until the matching _end (which has none). */
	const pendingArgs = new Map<string, Record<string, unknown>>();

	pi.on("session_start", async (_event, ctx) => {
		specs = [];
		readSpecs = new Set();
		pendingArgs.clear();
		failingAttempts = 0;
		steers = 0;
		cwd = ctx.cwd ?? process.cwd();
	});

	pi.on("before_agent_start", async (event) => {
		if (specs.length > 0) return undefined; // first prompt wins; steers are per-session
		// No cast: BeforeAgentStartEvent.prompt is a REQUIRED string (types.d.ts:527).
		// The cast that used to be here widened it to optional for no benefit — and a
		// reflexive casting habit is what let the tool_execution_end defect below
		// past tsc for a whole candidate cycle. Let the types do their job.
		const prompt = event.prompt;
		if (typeof prompt !== "string" || !prompt) return undefined;
		specs = extractSpecPaths(prompt, cwd);
		if (specs.length > 0) record("spec-adherence", "armed", { specs: specs.length });
		return undefined;
	});

	// pi puts `args` on tool_execution_START and _UPDATE but NOT on _END
	// (agent-session.js:487-514 builds each event explicitly; the end branch copies
	// only toolCallId/toolName/result/isError). Reading event.args on _end therefore
	// yielded {} on every real event, so read-detection was DEAD CODE from the
	// start: readSpecs could only ever be filled by the post-steer self-mark below,
	// and the steer degraded into an unconditional "you have not read this" nag
	// after two failures — false whenever the model HAD read the spec, and it would
	// still have stamped the exposure target, making a round look properly
	// exercised while measuring something else entirely. tsc would have caught it;
	// an `as` cast hid it. Carry args over from _start, keyed by toolCallId, the
	// way session-blackboard.ts:113-119 already does.
	pi.on("tool_execution_start", async (event) => {
		pendingArgs.set(event.toolCallId, (event.args ?? {}) as Record<string, unknown>);
	});

	pi.on("tool_execution_end", async (event) => {
		const name = event.toolName;
		const args = pendingArgs.get(event.toolCallId) ?? {};
		pendingArgs.delete(event.toolCallId);
		if (specs.length === 0) return;
		if ((name === "read" || name === "read_span") && typeof args.path === "string") {
			for (const spec of specs) if (pathMatchesSpec(String(args.path), spec)) readSpecs.add(spec);
		} else if (name === "bash" && typeof args.command === "string") {
			for (const segment of (args.command as string).match(READ_CAT_RE) ?? []) {
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
