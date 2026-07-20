// Lexical trigger-routing eval for the subagent roles: a model-free check
// that each role's frontmatter description actually attracts the prompts it
// should (and no sibling steals them). Catches the two dominant routing bugs
// — a description missing the words the main model actually says, and two
// over-broad descriptions colliding — for zero tokens, in CI.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { roleVocabulary, routeByOverlap, vocabularyJaccard, type RoleVocabulary } from "../lib/role-routing.ts";

// Resolve from this test file, not cwd — the live ~/.pi/agent tree is flat.
const agentsDir = join(import.meta.dirname, "..", "agents");
const fixture = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "role-triggers.json"), "utf8")) as {
	positives: Record<string, string[]>;
	negatives: string[];
};

function loadRoles(): RoleVocabulary[] {
	return readdirSync(agentsDir).filter((name) => name.endsWith(".md")).map((name) => {
		const source = readFileSync(join(agentsDir, name), "utf8");
		const front = /^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? "";
		const roleName = /^name:\s*(.+)$/m.exec(front)?.[1]?.trim() ?? name.replace(/\.md$/, "");
		const description = /^description:\s*(.+)$/m.exec(front)?.[1]?.trim() ?? "";
		assert.ok(description.length > 0, `${name} has a frontmatter description`);
		return roleVocabulary(roleName, description);
	});
}

test("every fixture positive routes to its labeled role with margin", () => {
	const roles = loadRoles();
	for (const [expected, prompts] of Object.entries(fixture.positives)) {
		assert.ok(roles.some((role) => role.name === expected), `fixture role ${expected} exists in agents/`);
		for (const prompt of prompts) {
			const routed = routeByOverlap(prompt, roles);
			assert.equal(routed.winner, expected, `"${prompt}" routed to ${routed.winner}, expected ${expected}`);
			assert.ok(routed.margin >= 1, `"${prompt}" wins ambiguously (margin ${routed.margin})`);
		}
	}
});

test("every checked-in role has fixture coverage", () => {
	for (const role of loadRoles()) {
		assert.ok((fixture.positives[role.name] ?? []).length >= 3,
			`role ${role.name} needs at least 3 positive trigger prompts in role-triggers.json`);
	}
});

test("negatives have no strong winner", () => {
	const roles = loadRoles();
	for (const prompt of fixture.negatives) {
		const routed = routeByOverlap(prompt, roles);
		assert.ok(routed.score <= 1, `negative "${prompt}" scored ${routed.score} for ${routed.winner} — description vocabulary is too broad`);
	}
});

test("no two role descriptions share more than half their vocabulary", () => {
	const roles = loadRoles();
	for (let i = 0; i < roles.length; i += 1) {
		for (let j = i + 1; j < roles.length; j += 1) {
			const jaccard = vocabularyJaccard(roles[i].words, roles[j].words);
			assert.ok(jaccard <= 0.5,
				`${roles[i].name} and ${roles[j].name} descriptions overlap ${(jaccard * 100).toFixed(0)}% — lexically inseparable`);
		}
	}
});
