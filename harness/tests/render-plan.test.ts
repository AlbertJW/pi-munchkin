import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// The lavish plan artifact is opened in a real browser. Every model-controlled
// field must come out inert — the Mermaid <pre> block is raw HTML, so a hostile
// plan title is an XSS vector, not a cosmetic issue.
test("render-plan.mjs neutralizes hostile plan fields", () => {
	const dir = mkdtempSync(join(tmpdir(), "render-plan-"));
	const planPath = join(dir, "plan-state.json");
	const outPath = join(dir, "out.html");
	writeFileSync(planPath, JSON.stringify({
		schema_version: 3,
		run_id: "<script>alert(1)</script>",
		request: "<img src=x onerror=alert(1)>",
		phase: "executing",
		items: [
			{ title: "</pre><img src=x onerror=alert(2)>", status: "pending", gate: "npm test", gate_fails: "<b onmouseover=alert(3)>2</b>" },
			{ title: "benign step", status: "done", depends_on: ["</pre><img src=x onerror=alert(2)>"] },
		],
		uncertainties: ["<svg onload=alert(4)>"],
	}));
	const script = resolve(import.meta.dirname, "..", "..", "skills", "lavish-review", "scripts", "render-plan.mjs");
	execFileSync(process.execPath, [script, planPath, outPath]);
	const html = readFileSync(outPath, "utf8");
	// Escaped payloads (&#60;img ...) are inert and MAY appear as text; what must
	// never appear is a raw injected element or a raw event-handler attribute.
	assert.ok(!/<img|<svg|<script>alert/.test(html), "no raw injected elements survive");
	assert.ok(!/<[a-z][^>]*\bon(?:error|load|mouseover)\s*=/i.test(html), "no raw event handlers survive");
	assert.match(html, /benign step/, "legitimate content renders");
});
