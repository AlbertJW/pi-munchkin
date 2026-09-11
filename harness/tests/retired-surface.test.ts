import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(import.meta.dirname, "..", "..");

function sourceFiles(directory: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(directory)) {
		const path = join(directory, name);
		if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
		else if (/\.(?:ts|js)$/u.test(name)) out.push(path);
	}
	return out;
}

function optimizerRuntimeFiles(directory: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(directory)) {
		if (["archive", "docs", "results", "configs", "__pycache__"].includes(name)) continue;
		const path = join(directory, name);
		if (statSync(path).isDirectory()) out.push(...optimizerRuntimeFiles(path));
		else if (/\.(?:py|sh)$/u.test(name)) out.push(path);
	}
	return out;
}

test("retired environment options have no loadable runtime reader", () => {
	const retired = [
		"CTX_REDUNDANCY_NUDGE", "CTX_REDUNDANCY_PCT", "PLAN_SUBAGENT_ONLY",
		"MICRO_GATE", "MICRO_GATE_SLOP", "PAYLOAD_AUDIT", "PROVIDER_PATIENCE",
		"PI_PROVIDER_HEADERS_TIMEOUT_MS", "PI_PROVIDER_BODY_TIMEOUT_MS", "REFLECT_TIMEOUT_MS",
		// Both are advertised as live rollbacks by dated rows in SURFACE_BOUNDARIES.md and
		// have ZERO readers in loadable source. Those rows are history and must not be
		// rewritten, so the guard goes here instead: an operator who reaches for either
		// during an incident gets nothing, and this is what stops a reader quietly
		// reappearing and making the claim half-true.
		"PLAN_GATE_DIAGNOSTICS", "PLAN_MODE",
		// 2026-09-10 retirements (c39, c31, c34): all three code gates are deleted, not
		// merely defaulted off. PLAN_TOOL_GO's plan_go tool is gone entirely; PLAN_UNCERTAINTY
		// and PLAN_ITEM_GUIDANCE_V2's mechanisms were already deleted by the 2026-08-24
		// planning refactor (dbf90f4) — this finishes their paperwork. LOOP_EPISODE_MODE is
		// deliberately NOT here: only its "enforce" hypothesis retired, and the code path for
		// it stays live and env-reachable per the reopen condition (see the schema-field list
		// below, and CANDIDATE_RETIREMENTS_2026-09.md).
		"PLAN_TOOL_GO", "PLAN_UNCERTAINTY", "PLAN_ITEM_GUIDANCE_V2",
	];
	const files = ["extensions", "lib", "vendor"]
		.flatMap((directory) => sourceFiles(join(root, "harness", directory)));
	for (const path of files) {
		const source = readFileSync(path, "utf8");
		for (const option of retired) {
			assert.equal(source.includes(option), false, `${option} remains in loadable runtime source: ${path}`);
		}
	}
});

test("retired environment options have no active optimizer runtime reader", () => {
	const retired = [
		"CTX_REDUNDANCY_NUDGE", "CTX_REDUNDANCY_PCT", "PLAN_SUBAGENT_ONLY",
		"MICRO_GATE", "MICRO_GATE_SLOP", "PAYLOAD_AUDIT", "RETRY_FRESH", "RETRY_MODE",
	];
	const readers = (option: string) => new RegExp(
		`(?:process\\.env\\.${option}|os\\.environ(?:\\.get\\(["']${option}["']|\\[["']${option}["']\\])|\\$\\{?${option}(?:[}:]|\\b))`,
		"u",
	);
	for (const path of optimizerRuntimeFiles(join(root, "optimizer"))) {
		const source = readFileSync(path, "utf8");
		for (const option of retired) {
			assert.equal(readers(option).test(source), false, `${option} remains an optimizer runtime read: ${path}`);
		}
	}
});

test("retired extensions and policy are absent from package and active optimizer schemas", () => {
	const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	const serializedManifest = JSON.stringify(manifest);
	for (const path of ["micro-gate.ts", "micro-gate-policy.ts", "payload-audit.ts", "provider-patience.ts", "reflect.ts", "reflect-policy.ts"]) {
		assert.equal(serializedManifest.includes(path), false, `${path} remains package-visible`);
	}
	const schema = JSON.parse(readFileSync(join(root, "optimizer", "prompt-lab", "configs", "schema.json"), "utf8"));
	const thresholds = schema.dimensions.thresholds.fields;
	for (const option of [
		"CTX_REDUNDANCY_NUDGE", "CTX_REDUNDANCY_PCT", "PLAN_SUBAGENT_ONLY",
		"MICRO_GATE", "MICRO_GATE_SLOP", "RETRY_FRESH", "RETRY_MODE",
		// 2026-09-10: PLAN_TOOL_GO/PLAN_UNCERTAINTY/PLAN_ITEM_GUIDANCE_V2 retired outright
		// (see the loadable-source list above). LOOP_EPISODE_MODE is here ONLY because its
		// schema field (a value, not a boolean gate) was removed — the code path for its
		// retired "enforce" value stays live and reachable by explicit env; this line checks
		// optimizer selectability, not runtime reachability, so it belongs here and nowhere
		// else in this file (ADR-0006's value/mode-field retirement checklist).
		"PLAN_TOOL_GO", "PLAN_UNCERTAINTY", "PLAN_ITEM_GUIDANCE_V2", "LOOP_EPISODE_MODE",
	]) assert.equal(option in thresholds, false, `${option} remains optimizer-active`);
	assert.deepEqual(thresholds.STATE_LENS, ["off", "steer"]);
});
