// Plan item dependencies: `depends_on` lists items that must be `done` before an item
// may start. "Waiting" is derived from the dependencies, never stored, and is distinct
// from the `blocked` status (an external blocker the model reports).
//
// One invariant holds for every persisted plan: an item that is in_progress has every
// dependency done, and an item newly marked done had every dependency done. Done items
// stay done if a dependency is later reopened (history), but a dependency cannot be
// reopened while one of its dependents is in progress.
import { PLAN_MAX_DEPENDENCIES } from "./plan-limits.ts";

const ID = /^[A-Za-z0-9._:-]{1,96}$/;
export type DependencyItem = { id: string; status: string; depends_on?: string[] };

/** Structural checks: references exist, no self-reference or duplicate, bounded, acyclic. */
export function dependencyStructureErrors(items: readonly DependencyItem[]): string[] {
	const errors: string[] = [];
	const ids = new Set(items.map((item) => item.id));
	for (const item of items) {
		const deps = item.depends_on;
		if (deps === undefined) continue;
		if (!Array.isArray(deps)) { errors.push(`depends_on must be a list for ${item.id}`); continue; }
		if (deps.length > PLAN_MAX_DEPENDENCIES) errors.push(`${item.id} may depend on at most ${PLAN_MAX_DEPENDENCIES} items`);
		const seen = new Set<string>();
		for (const dep of deps) {
			if (typeof dep !== "string" || !ID.test(dep)) { errors.push(`invalid dependency id in ${item.id}`); continue; }
			if (dep === item.id) errors.push(`${item.id} cannot depend on itself`);
			else if (!ids.has(dep)) errors.push(`${item.id} depends on unknown item ${dep} (valid: ${[...ids].join(", ") || "none"})`);
			if (seen.has(dep)) errors.push(`${item.id} lists ${dep} twice in depends_on`);
			seen.add(dep);
		}
	}
	if (errors.length) return errors;
	const cycle = findCycle(items);
	if (cycle) errors.push(`dependency cycle: ${cycle.join(" -> ")}`);
	return errors;
}

function findCycle(items: readonly DependencyItem[]): string[] | null {
	const deps = new Map(items.map((item) => [item.id, item.depends_on ?? []]));
	const state = new Map<string, "visiting" | "done">();
	const path: string[] = [];
	const visit = (id: string): string[] | null => {
		if (state.get(id) === "done") return null;
		if (state.get(id) === "visiting") return [...path.slice(path.indexOf(id)), id];
		state.set(id, "visiting");
		path.push(id);
		for (const dep of deps.get(id) ?? []) {
			const found = visit(dep);
			if (found) return found;
		}
		path.pop();
		state.set(id, "done");
		return null;
	};
	for (const item of items) {
		const found = visit(item.id);
		if (found) return found;
	}
	return null;
}

/** Dependencies of `item` that are not done yet, in declared order. */
export function unmetDependencies(items: readonly DependencyItem[], item: DependencyItem): string[] {
	const byId = new Map(items.map((candidate) => [candidate.id, candidate]));
	return (item.depends_on ?? []).filter((dep) => byId.get(dep)?.status !== "done");
}

/** Status invariant over a resulting plan. `newlyDone` are items moved to done by this change. */
export function dependencyStatusErrors(items: readonly DependencyItem[], newlyDone: ReadonlySet<string> = new Set()): string[] {
	const byId = new Map(items.map((item) => [item.id, item]));
	const errors: string[] = [];
	for (const item of items) {
		if (item.status !== "in_progress" && !newlyDone.has(item.id)) continue;
		const unmet = unmetDependencies(items, item);
		if (!unmet.length) continue;
		const detail = unmet.map((dep) => `${dep} (${byId.get(dep)?.status ?? "missing"})`).join(", ");
		errors.push(`${item.id} cannot be ${item.status === "done" ? "done" : "in_progress"} yet: it depends on ${detail}. Finish those first, or change the dependency with plan_write.`);
	}
	return errors;
}

/** Pending items whose dependencies are all done, in plan order. */
export function readyItems<T extends DependencyItem>(items: readonly T[]): T[] {
	return items.filter((item) => item.status === "pending" && unmetDependencies(items, item).length === 0);
}

/** Pending items that can never start because a dependency is blocked or deferred. */
export function stuckItems<T extends DependencyItem>(items: readonly T[]): Array<{ item: T; on: string[] }> {
	const byId = new Map(items.map((item) => [item.id, item]));
	const terminalNotDone = (id: string, seen = new Set<string>()): boolean => {
		if (seen.has(id)) return false;
		seen.add(id);
		const dep = byId.get(id);
		if (!dep) return false;
		if (dep.status === "blocked" || dep.status === "deferred") return true;
		return dep.status !== "done" && (dep.depends_on ?? []).some((next) => terminalNotDone(next, seen));
	};
	return items.filter((item) => item.status === "pending")
		.map((item) => ({ item, on: (item.depends_on ?? []).filter((dep) => terminalNotDone(dep)) }))
		.filter((entry) => entry.on.length > 0);
}
