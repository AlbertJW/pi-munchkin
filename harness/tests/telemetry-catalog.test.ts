import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { catalogHas, EVENT_CATALOG, RESERVED_ENVELOPE_FIELDS, validateCatalogDetail } from "../lib/telemetry-catalog.ts";
import { isForbiddenDetailField } from "../lib/telemetry.ts";

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
});

test("every catalog entry has a real emitter — the direction that was never checked", () => {
	// The test above proves emissions ⊆ catalog. Nothing proved catalog ⊆ emissions,
	// and that is the direction with teeth: optimizer/prompt-lab/exposure.py validates
	// a trial's exposure target against this catalog and nothing else, so a candidate
	// naming a catalogued-but-never-emitted event passes validation and then reports
	// `unexposed` for every row in both arms — indistinguishable from "the mechanism
	// fired and did nothing". Two entries were in exactly that state when this test was
	// written: `tool-activation/unavailable` (now emitted on every refusal path) and
	// `verify-gate/gate-green-consumed` (emitted only by telemetry.test.ts).
	const roots = ["extensions", "lib", "vendor/pi-subagent"];
	let sources = "";
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith(".ts")) sources += readFileSync(full, "utf8");
		}
	};
	for (const root of roots) walk(join(import.meta.dirname, "..", ...root.split("/")));

	const emitted = new Set<string>();
	for (const match of sources.matchAll(/record\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/g)) emitted.add(`${match[1]}/${match[2]}`);
	for (const match of sources.matchAll(/planEvent\(\s*["']([^"']+)["']/g)) emitted.add(`plan-runner/${match[1]}`);
	for (const match of sources.matchAll(/recordEvent\(\s*["']context-watcher["']\s*,\s*["']([^"']+)["']/g)) emitted.add(`context-watcher/${match[1]}`);

	// Entries with no STATIC emitter, each for a stated reason. Adding to this list is
	// a deliberate act; growing it silently is the failure mode being prevented.
	const declaredEmitterless = new Map<string, string>([
		["verify-gate/gate-green-consumed", "retired emitter; retained as telemetry.test.ts's generic fixture event"],
		["telemetry/schema-reject", "emitted from telemetry.ts's own envelope path, not via record()"],
		["telemetry/writer-overflow", "emitted from telemetry.ts's own envelope path, not via record()"],
	]);

	const orphans = Object.keys(EVENT_CATALOG).filter((key) => !emitted.has(key) && !declaredEmitterless.has(key));
	assert.deepEqual(orphans, [], `catalogued with no emitter — a valid exposure target that can only ever report zero: ${orphans.join(", ")}`);

	// And the allowlist must not rot: an entry that regains an emitter leaves it.
	const stale = [...declaredEmitterless.keys()].filter((key) => emitted.has(key));
	assert.deepEqual(stale, [], `listed as emitterless but now emitted: ${stale.join(", ")}`);
});

test("catalog rejects unknown kinds, fields, and invalid field types", () => {
	assert.match(validateCatalogDetail("missing", "kind", {})[0], /unknown event/);
	assert.deepEqual(validateCatalogDetail("verify-gate", "gate-green-consumed", { leak: "x" }), ["unknown field leak"]);
	assert.match(validateCatalogDetail("verify-gate", "steer", { fires: "one" })[0], /expected number/);
	assert.ok(Object.keys(EVENT_CATALOG).length >= 40, "catalog covers the complete extension surface");
});

test("no catalog entry DECLARES a field that shadows an envelope key", () => {
	// validateCatalogDetail rejects a shadowing field at runtime; this is the static
	// half. A declared shadow fails CLOSED (the row is schema-rejected) rather than
	// silently, so this is lint-grade — but it catches the mistake at authoring time
	// instead of in a round. The one that shipped, plan-runner/go's `source`, would
	// have made the event vanish from every gate extraction: context_telemetry.py
	// discards every event whose source != "gate".
	const violations: string[] = [];
	for (const [event, schema] of Object.entries(EVENT_CATALOG)) {
		for (const field of Object.keys(schema)) {
			if (RESERVED_ENVELOPE_FIELDS.has(field)) violations.push(`${event}.${field}`);
		}
	}
	assert.deepEqual(violations, [], "rename the field — envelope keys are not available to detail");
	assert.ok(RESERVED_ENVELOPE_FIELDS.has("source"), "the set must still be the real one, not an empty stand-in");
});

test("machine-readable exposure catalog stays in lockstep with TypeScript catalog", () => {
	const mirror = JSON.parse(readFileSync(join(import.meta.dirname, "..", "lib", "telemetry-event-catalog.json"), "utf8"));
	assert.deepEqual(new Set(mirror.events), new Set(Object.keys(EVENT_CATALOG)));
});

test("an EMPTY array satisfies any array-typed field (it carries no element evidence)", () => {
	// [].every(pred) is vacuously true, so an empty array used to type as string[]
	// and a declared number[] field rejected it — and telemetry.ts replaces a
	// rejected row with a schema-reject stub, so the WHOLE row was destroyed. A
	// context call with zero tool results is ordinary; 12 such rows were lost from
	// the live corpus before this was found.
	assert.deepEqual(validateCatalogDetail("context-surface", "receipt", { tool_names: [], tool_result_bytes: [] }), []);
	// The opposite polarity must still hold: a WRONG element type is still rejected.
	assert.deepEqual(validateCatalogDetail("context-surface", "receipt", { tool_result_bytes: ["x"] }),
		["invalid tool_result_bytes: expected number[], got string[]"]);
	// ...and an empty array must NOT satisfy a scalar field.
	assert.deepEqual(validateCatalogDetail("context-surface", "receipt", { message_count: [] }),
		["invalid message_count: expected number, got empty[]"]);
});

test("no catalog field name is forbidden at runtime — a rejected name is a dead event", () => {
	// The catalog and normalizeDetail's FORBIDDEN_DETAIL_FIELD were unconnected:
	// provider-patience declared `headers_timeout_ms` (matches /header/i), every
	// unit test passed, and the LIVE smoke found the applied row replaced by a
	// schema-reject stub. A catalog entry whose rows can never land is worse than
	// no entry -- it reads as coverage. Counterfactual: add a `*_header_*` field
	// to any catalog entry and this fails.
	const violations: string[] = [];
	for (const [event, spec] of Object.entries(EVENT_CATALOG)) {
		for (const field of Object.keys(spec)) {
			if (isForbiddenDetailField(field)) violations.push(`${event}.${field}`);
		}
	}
	assert.deepEqual(violations, [], "rename these fields — normalizeDetail rejects them at runtime");
});
