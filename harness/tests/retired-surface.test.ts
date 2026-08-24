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
		"PI_PROVIDER_HEADERS_TIMEOUT_MS", "PI_PROVIDER_BODY_TIMEOUT_MS",
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
	for (const path of ["micro-gate.ts", "micro-gate-policy.ts", "payload-audit.ts", "provider-patience.ts"]) {
		assert.equal(serializedManifest.includes(path), false, `${path} remains package-visible`);
	}
	const schema = JSON.parse(readFileSync(join(root, "optimizer", "prompt-lab", "configs", "schema.json"), "utf8"));
	const thresholds = schema.dimensions.thresholds.fields;
	for (const option of [
		"CTX_REDUNDANCY_NUDGE", "CTX_REDUNDANCY_PCT", "PLAN_SUBAGENT_ONLY",
		"MICRO_GATE", "MICRO_GATE_SLOP", "RETRY_FRESH", "RETRY_MODE",
	]) assert.equal(option in thresholds, false, `${option} remains optimizer-active`);
	assert.deepEqual(thresholds.STATE_LENS, ["off", "steer"]);
});
