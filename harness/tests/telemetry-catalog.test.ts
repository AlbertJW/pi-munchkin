import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { catalogHas, EVENT_CATALOG, validateCatalogDetail } from "../lib/telemetry-catalog.ts";

test("every literal telemetry emission is represented in the event catalog", () => {
	// Resolve from this test file, not cwd — the live ~/.pi/agent tree is flat
	// (extensions/ at top level) while the repo nests under harness/.
	const extensionDir = join(import.meta.dirname, "..", "extensions");
	const missing = new Set<string>();
	for (const name of readdirSync(extensionDir).filter((file) => file.endsWith(".ts"))) {
		const source = readFileSync(join(extensionDir, name), "utf8");
		for (const match of source.matchAll(/record\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/g)) {
			if (!catalogHas(match[1], match[2])) missing.add(`${match[1]}/${match[2]}`);
		}
		for (const match of source.matchAll(/planEvent\(\s*["']([^"']+)["']/g)) {
			if (!catalogHas("plan-runner", match[1])) missing.add(`plan-runner/${match[1]}`);
		}
		for (const match of source.matchAll(/recordEvent\(\s*["']context-watcher["']\s*,\s*["']([^"']+)["']/g)) {
			if (!catalogHas("context-watcher", match[1])) missing.add(`context-watcher/${match[1]}`);
		}
	}
	assert.deepEqual([...missing], []);
	assert.ok(catalogHas("micro-gate", "passed"));
	assert.ok(catalogHas("micro-gate", "skipped"));
});

test("catalog rejects unknown kinds, fields, and invalid field types", () => {
	assert.match(validateCatalogDetail("missing", "kind", {})[0], /unknown event/);
	assert.deepEqual(validateCatalogDetail("verify-gate", "gate-green-consumed", { leak: "x" }), ["unknown field leak"]);
	assert.match(validateCatalogDetail("verify-gate", "steer", { fires: "one" })[0], /expected number/);
	assert.ok(Object.keys(EVENT_CATALOG).length >= 40, "catalog covers the complete extension surface");
});
