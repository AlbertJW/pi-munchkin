import assert from "node:assert/strict";
import test from "node:test";
import { renderSafeGateFailure, safeGateDiagnostic, sanitizeGateDiagnostic } from "../lib/plan-gate-diagnostic.ts";

test("safe gate diagnostics are one bounded JSON value with secrets, paths, ANSI, and controls removed", () => {
	const secret = "dummy_token_SUPER_SECRET_123456789";
	const raw = [
		"\u001b[31mFAILED\u001b[0m ```json",
		`token=${secret}`,
		"at /Users/example/private/project/src/app.ts:42",
		"https://example.test/failure?signature=dummy-signed-value#private",
		"control\u0000value",
		"```",
		"x".repeat(900),
	].join("\n");
	const diagnostic = safeGateDiagnostic("npm test", { pass: false, output: raw, reason: "exit" });
	const rendered = renderSafeGateFailure({
		diagnostic,
		requiredNextAction: "change the implementation, then rerun the same gate",
	});
	assert.ok(diagnostic.diagnosticBytes <= 500);
	assert.doesNotMatch(rendered, /SUPER_SECRET|\/Users\/example|signature=|\u001b|\u0000/);
	const lines = rendered.split("\n");
	const marker = lines.indexOf("UNTRUSTED_GATE_DIAGNOSTIC");
	assert.ok(marker >= 0);
	assert.doesNotThrow(() => JSON.parse(lines.slice(marker + 1).join("\n")), "diagnostic must be exactly one JSON string");
});

test("diagnostic failure class is the fixed shared taxonomy", () => {
	assert.equal(safeGateDiagnostic("tsc --noEmit", {
		pass: false,
		output: "error TS2322: Type string is not assignable",
		reason: "exit",
	}).failureClass, "compile_or_lint");
	assert.equal(safeGateDiagnostic("npm test", {
		pass: false,
		output: "timed out",
		reason: "timeout",
	}).failureClass, "timeout");
});

test("sanitizer keeps useful relative evidence", () => {
	assert.equal(sanitizeGateDiagnostic("src/app.ts:4: expected true, got false"),
		"src/app.ts:4: expected true, got false");
});
