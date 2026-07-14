import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { changedPaths, checksFor, firstError } from "../lib/micro-gate-policy.ts";
import { steerText } from "../lib/steer-texts.ts";
import { record } from "../lib/telemetry.ts";

// micro-gate (c21) — DORMANT unless MICRO_GATE=on. After a turn that mutated
// source files, run the cheapest deterministic check on JUST the changed files
// (node --check / py_compile / JSON.parse) and inject the first actionable
// error as a followUp. Debounced naturally to once per turn (turn_end).
// Never runs the project test suite. Candidate spec: c21-micro-gate.json.

const ENABLED = process.env.MICRO_GATE === "on";
const CHECK_TIMEOUT = 5_000;

export default function (pi: ExtensionAPI) {
	if (!ENABLED) return;

	pi.on("turn_end", async (event, ctx) => {
		const msg = event.message;
		if (msg.role !== "assistant") return;
		const paths: string[] = [];
		for (const c of msg.content) {
			if (c.type !== "toolCall") continue;
			if (c.name !== "edit" && c.name !== "write") continue;
			paths.push(...changedPaths(c.name, c.arguments));
		}
		if (!paths.length) return;

		const outputs: Array<{ file: string; err: string }> = [];
		for (const check of checksFor(paths)) {
			const abs = isAbsolute(check.file) ? check.file : join(ctx.cwd, check.file);
			if (!existsSync(abs)) continue;
			try {
				// ExecResult carries `code` (NOT exitCode — verified against pi's sdk
				// types; the wrong field would make this extension a silent no-op,
				// the exact defect class the c18 audit caught).
				let r: { code: number; stderr: string; stdout: string };
				if (check.kind === "node") {
					r = await pi.exec("node", ["--check", abs], { cwd: ctx.cwd, timeout: CHECK_TIMEOUT });
				} else if (check.kind === "python") {
					r = await pi.exec("python3", ["-m", "py_compile", abs], { cwd: ctx.cwd, timeout: CHECK_TIMEOUT });
				} else {
					r = await pi.exec("node", ["-e", `JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))`, abs],
						{ cwd: ctx.cwd, timeout: CHECK_TIMEOUT });
				}
				if (r.code !== 0) outputs.push({ file: check.file, err: r.stderr || r.stdout || "check failed" });
			} catch {
				// checker unavailable/timeout: the micro-gate must never become its own fault
			}
		}
		const err = firstError(outputs);
		if (!err) return;
		record("micro-gate", "fired", { files: paths.length });
		pi.sendUserMessage(
			steerText(
				"MICRO_GATE_MSG",
				"[micro-gate] The file you just edited does not parse/compile — fix this BEFORE anything else:\n{err}",
				{ err },
			),
			{ deliverAs: "followUp" },
		);
	});
}
