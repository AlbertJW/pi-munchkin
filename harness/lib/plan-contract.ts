// plan-contract — the typed, verification-aware plan for plan-weaver (v4).
// Pure functions only (schema validation, DAG order, path normalization, child-result
// parsing) so the whole contract is unit-testable without pi, like plan-integrity.
//
// Design (VeriMAP / plan-once): the model authors the plan ONCE via the plan_compile
// tool; every mutating item must carry a read-only gate command ("no unverifiable
// steps"); the engine — not the model — walks the DAG and dispatches items.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type WeaveMode = "inline" | "explore" | "execute" | "verify";

export type WeaveItem = {
	id: string;
	title: string;
	mode: WeaveMode;
	/** files/dirs the step needs — the ONLY workspace context a child is briefed with */
	inputs: string[];
	/** what the step must produce, one line (files or observable behavior) */
	deliverable: string;
	/** read-only check that must exit 0; REQUIRED for execute items */
	gate?: string;
	depends_on: string[];
	// engine-owned runtime state (never model-written after compile)
	status: "pending" | "running" | "done" | "blocked";
	note?: string;
	gate_fails: number;
	ladder_rung: 0 | 1 | 2 | 3; // 0 fresh, 1 locality-retried, 2 fresh-child, 3 blocked
};

export type WeavePlan = {
	schema_version: 1;
	request: string;
	created_at: string;
	updated_at: string;
	phase: "compiled" | "dispatching" | "handed_off" | "done";
	items: WeaveItem[];
};

export type CompileInput = {
	items: Array<{
		id?: string;
		title: string;
		mode?: string;
		inputs?: string[];
		deliverable?: string;
		gate?: string;
		depends_on?: string[];
	}>;
};

const MODES: WeaveMode[] = ["inline", "explore", "execute", "verify"];

/** Validate a model-authored plan. Returns the compiled plan or a list of errors
 *  (the tool returns errors verbatim; the model gets ONE mechanical retry). */
export function compilePlan(input: CompileInput, request: string, now: string):
	{ ok: true; plan: WeavePlan } | { ok: false; errors: string[] } {
	const errors: string[] = [];
	const raw = Array.isArray(input?.items) ? input.items : [];
	if (raw.length === 0) errors.push("plan has no items");
	if (raw.length > 12) errors.push(`plan has ${raw.length} items — cap is 12; merge trivial steps`);

	const items: WeaveItem[] = [];
	const ids = new Set<string>();
	raw.forEach((r, i) => {
		const id = (r.id && String(r.id).trim()) || `s${i + 1}`;
		if (ids.has(id)) errors.push(`duplicate item id "${id}"`);
		ids.add(id);
		const mode = (r.mode ?? "inline") as WeaveMode;
		if (!MODES.includes(mode)) errors.push(`item ${id}: unknown mode "${r.mode}" (inline|explore|execute|verify)`);
		if (!r.title || !String(r.title).trim()) errors.push(`item ${id}: empty title`);
		if (mode === "execute" && !(r.gate && String(r.gate).trim())) {
			errors.push(`item ${id}: execute items REQUIRE a read-only gate command (e.g. "node --test", "npx tsc --noEmit") — no unverifiable steps`);
		}
		if (mode !== "inline" && (!r.deliverable || !String(r.deliverable).trim())) {
			errors.push(`item ${id}: ${mode} items require a one-line deliverable`);
		}
		items.push({
			id, title: String(r.title ?? "").trim(), mode,
			inputs: (r.inputs ?? []).map(String),
			deliverable: String(r.deliverable ?? "").trim(),
			gate: r.gate ? String(r.gate).trim() : undefined,
			depends_on: (r.depends_on ?? []).map(String),
			status: "pending", gate_fails: 0, ladder_rung: 0,
		});
	});
	for (const it of items) {
		for (const d of it.depends_on) {
			if (!ids.has(d)) errors.push(`item ${it.id}: depends_on unknown id "${d}"`);
		}
	}
	if (errors.length === 0 && hasCycle(items)) errors.push("depends_on contains a cycle");
	if (errors.length > 0) return { ok: false, errors };
	return {
		ok: true,
		plan: { schema_version: 1, request, created_at: now, updated_at: now, phase: "compiled", items },
	};
}

function hasCycle(items: WeaveItem[]): boolean {
	const state = new Map<string, 0 | 1 | 2>(); // 0 unseen, 1 visiting, 2 done
	const byId = new Map(items.map((i) => [i.id, i]));
	const visit = (id: string): boolean => {
		const s = state.get(id) ?? 0;
		if (s === 1) return true;
		if (s === 2) return false;
		state.set(id, 1);
		for (const d of byId.get(id)?.depends_on ?? []) if (visit(d)) return true;
		state.set(id, 2);
		return false;
	};
	return items.some((i) => visit(i.id));
}

/** Next dispatchable item: pending, all deps done. Deterministic (plan order). */
export function nextReady(plan: WeavePlan): WeaveItem | undefined {
	const done = new Set(plan.items.filter((i) => i.status === "done").map((i) => i.id));
	return plan.items.find(
		(i) => i.status === "pending" && i.depends_on.every((d) => done.has(d)),
	);
}

/** True when nothing pending is dispatchable but open items remain (all blocked-on-blocked). */
export function stalled(plan: WeavePlan): boolean {
	return !nextReady(plan) && plan.items.some((i) => i.status === "pending" || i.status === "running");
}

/** Fuzzy-resolve a plan-declared input path against the real tree (plan-once
 *  normalizer lesson: small models write src/utils.js for src/util.js). Exact hit
 *  wins; else a unique same-basename file within two directory levels; else the
 *  original string (the child will report it missing — honest failure). */
export function normalizeInput(cwd: string, p: string): string {
	if (existsSync(join(cwd, p))) return p;
	const base = p.split("/").pop() ?? p;
	const hits: string[] = [];
	const walk = (dir: string, depth: number) => {
		if (depth > 2 || hits.length > 1) return;
		let entries: string[] = [];
		try { entries = readdirSync(join(cwd, dir)); } catch { return; }
		for (const e of entries) {
			if (e.startsWith(".") || e === "node_modules") continue;
			const rel = dir ? `${dir}/${e}` : e;
			try {
				if (statSync(join(cwd, rel)).isDirectory()) walk(rel, depth + 1);
				else if (e === base) hits.push(rel);
			} catch { /* ignore */ }
		}
	};
	walk("", 0);
	return hits.length === 1 ? hits[0] : p;
}

/** Parse the agents/*.md return contract (RESULT: done|blocked — ...). Missing or
 *  malformed RESULT is treated as blocked — a child that can't follow the contract
 *  must not be trusted with a "done". */
export function parseChildResult(text: string): { result: "done" | "blocked"; line: string } {
	const m = text.match(/^\s*RESULT:\s*(done|blocked)\b(.*)$/im);
	if (!m) return { result: "blocked", line: "no RESULT line in child reply" };
	return { result: m[1].toLowerCase() as "done" | "blocked", line: m[0].trim().slice(0, 200) };
}

/** The c18b locality-retry brief — stateful by construction (embeds the failing output). */
export function localityBrief(gate: string, failOutput: string): string {
	return [
		"The gate failed. Follow this protocol EXACTLY:",
		"1. LOCALIZE: from the failing output below, identify the ONE file and smallest span responsible.",
		"2. REPAIR: make ONE bounded edit to that span.",
		`3. VERIFY: run exactly \`${gate}\` and read its output.`,
		"Repeat only if verification still fails. Do not restructure anything else.",
		"",
		"Most recent failing output:",
		failOutput.slice(-1200),
	].join("\n");
}
