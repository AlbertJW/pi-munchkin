import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { changedPaths, checksFor, firstError, formatSlop, jsSlopFindings, PYTHON_SLOP_SCRIPT, slopKindFor } from "../lib/micro-gate-policy.ts";
import { steerText } from "../lib/steer-texts.ts";
import { record } from "../lib/telemetry.ts";

// micro-gate (c21) — DORMANT unless MICRO_GATE=on. After a turn that mutated
// source files, run the cheapest deterministic check on JUST the changed files
// (node --check / ast.parse / JSON.parse) and inject the first actionable
// error as an immediate steer. Debounced naturally to once per turn (turn_end).
// Never runs the project test suite. Candidate spec: c21-micro-gate.json.
//
// MICRO_GATE_SLOP=on (c29, independent leaf): additionally scan just-edited
// files for shortcut patterns small models overproduce (loopgate's anti-slop
// idea) — Python via stdlib ast, JS/TS via honest line regexes. Steer only,
// never a block: some hits are legitimate; the point is a reconsider nudge.

const PARSE_ENABLED = process.env.MICRO_GATE === "on";
const SLOP_ENABLED = process.env.MICRO_GATE_SLOP === "on";
const CHECK_TIMEOUT = 5_000;

export default function (pi: ExtensionAPI) {
	if (!PARSE_ENABLED && !SLOP_ENABLED) return;

	pi.on("turn_end", async (event, ctx) => {
		const msg = event.message;
		if (msg.role !== "assistant") return;
		const paths: string[] = [];
		let sawMutationTool = false;
		for (const c of msg.content) {
			if (c.type !== "toolCall") continue;
			if (c.name !== "edit" && c.name !== "write" && c.name !== "bash") continue;
			sawMutationTool = true;
			paths.push(...changedPaths(c.name, c.arguments));
		}
		if (!sawMutationTool) return;
		if (!paths.length) {
			record("micro-gate", "skipped", { reason: "no-statically-known-path" });
			return;
		}

		// Parse checks run FIRST: a file that doesn't parse gets exactly ONE
		// steer (the parse error) — running slop on it too would emit two
		// competing corrections in the same turn.
		const parseFailed = new Set<string>();
		const outputs: Array<{ file: string; err: string }> = [];
		if (!PARSE_ENABLED) {
			if (SLOP_ENABLED) await slopPass(pi, ctx.cwd, paths, parseFailed);
			return;
		}
		let checked = 0;
		for (const check of checksFor(paths)) {
			const abs = isAbsolute(check.file) ? check.file : join(ctx.cwd, check.file);
			if (!existsSync(abs)) {
				record("micro-gate", "skipped", { reason: "missing-file", file: check.file });
				continue;
			}
			try {
				// ExecResult carries `code` (NOT exitCode — verified against pi's sdk
				// types; the wrong field would make this extension a silent no-op,
				// the exact defect class the c18 audit caught).
				let r: { code: number; stderr: string; stdout: string };
				if (check.kind === "node") {
					r = await pi.exec("node", ["--check", abs], { cwd: ctx.cwd, timeout: CHECK_TIMEOUT });
				} else if (check.kind === "python") {
					r = await pi.exec("python3", ["-c", "import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read(), filename=sys.argv[1])", abs],
						{ cwd: ctx.cwd, timeout: CHECK_TIMEOUT });
				} else {
					r = await pi.exec("node", ["-e", `JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))`, abs],
						{ cwd: ctx.cwd, timeout: CHECK_TIMEOUT });
				}
				checked += 1;
				if (r.code !== 0) {
					outputs.push({ file: check.file, err: r.stderr || r.stdout || "check failed" });
					parseFailed.add(check.file);
				}
			} catch (error) {
				// checker unavailable/timeout: the micro-gate must never become its own fault
				record("micro-gate", "checker-error", { file: check.file, error: error instanceof Error ? error.message : String(error) });
			}
		}
		if (SLOP_ENABLED) await slopPass(pi, ctx.cwd, paths, parseFailed);
		const err = firstError(outputs);
		if (!err) {
			record("micro-gate", checked ? "passed" : "skipped", { files: paths.length, checked });
			return;
		}
		const steerMsg = steerText(
			"MICRO_GATE_MSG",
			"[micro-gate] The file you just edited does not parse/compile — fix this BEFORE anything else:\n{err}",
			{ err },
		);
		record("micro-gate", "fired", { files: paths.length, injected_chars: steerMsg.length });
		pi.sendUserMessage(steerMsg, { deliverAs: "steer" });
	});

	async function slopPass(api: ExtensionAPI, cwd: string, paths: string[], parseFailed: ReadonlySet<string>): Promise<void> {
		const outputs: Array<{ file: string; findings: string[] }> = [];
		let checked = 0;
		const seen = new Set<string>();
		for (const file of paths) {
			if (seen.has(file) || parseFailed.has(file)) continue;
			seen.add(file);
			const kind = slopKindFor(file);
			if (!kind) continue;
			const abs = isAbsolute(file) ? file : join(cwd, file);
			if (!existsSync(abs)) continue;
			try {
				if (kind === "python") {
					// Findings on stdout, exit 0 always — a non-zero code means the
					// CHECKER failed (missing python3, timeout), not a dirty file.
					const r = await api.exec("python3", ["-c", PYTHON_SLOP_SCRIPT, abs], { cwd, timeout: CHECK_TIMEOUT });
					if (r.code !== 0) {
						record("micro-gate", "slop-checker-error", { file, error: r.stderr || "checker exited non-zero" });
						continue;
					}
					const findings = r.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
					checked += 1;
					if (findings.length) outputs.push({ file, findings });
				} else {
					// bounded read: slop scanning must never slurp a huge generated file
					const findings = jsSlopFindings(readFileSync(abs, "utf8").slice(0, 512 * 1024));
					checked += 1;
					if (findings.length) outputs.push({ file, findings });
				}
			} catch (error) {
				// fail open: the slop gate must never become its own fault
				record("micro-gate", "slop-checker-error", { file, error: error instanceof Error ? error.message : String(error) });
			}
			if (checked >= 3) break;
		}
		const findings = formatSlop(outputs);
		if (!findings) {
			if (checked) record("micro-gate", "slop-passed", { files: paths.length, checked });
			return;
		}
		const steerMsg = steerText(
			"MICRO_GATE_SLOP_MSG",
			"[micro-gate] Possible shortcuts in the file you just edited (line:pattern) — reconsider before proceeding; suppressions and error-swallowing usually hide the real bug:\n{findings}",
			{ findings },
		);
		record("micro-gate", "slop-fired", { files: paths.length, findings: outputs.reduce((n, o) => n + o.findings.length, 0), injected_chars: steerMsg.length });
		api.sendUserMessage(steerMsg, { deliverAs: "steer" });
	}
}
