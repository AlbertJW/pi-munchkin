import { eventBusOwner } from "./event-bus-owner.ts";
/** Reload-stable values are owned by an event bus, never by the latest session in the process. */
const KEY = "__pi_runtime_ownership_v1";
export type Lifetime = "event-bus" | "session" | "branch" | "generation";
export type RuntimeField<T> = { key: string; lifetime: Lifetime; create: () => T };
type OwnedValue = { lifetime: Lifetime; value: unknown };
type Scope = { sessionId: string | null; generation: number; values: Map<string, OwnedValue> };
function scopes(): WeakMap<object, Scope> {
 const shared = globalThis as Record<string, unknown>;
 if (!(shared[KEY] instanceof WeakMap)) shared[KEY] = new WeakMap<object, Scope>();
 return shared[KEY] as WeakMap<object, Scope>;
}
function scope(bus: object): Scope {
 bus = eventBusOwner(bus);
 let state = scopes().get(bus);
 if (!state) { state = { sessionId: null, generation: 0, values: new Map() }; scopes().set(bus, state); }
 return state;
}
export function runtimeValue<T>(bus: object, field: RuntimeField<T>): T {
 const state = scope(bus); const existing = state.values.get(field.key);
 if (existing && existing.lifetime !== field.lifetime) throw new Error(`Runtime ownership mismatch: ${field.key}`);
 if (!existing) state.values.set(field.key, { lifetime: field.lifetime, value: field.create() });
 return state.values.get(field.key)!.value as T;
}
export function beginRuntimeGeneration(bus: object, sessionId: string): number {
 const state = scope(bus); const replaced = state.sessionId !== sessionId;
 for (const [key, entry] of state.values) if (entry.lifetime === "generation" || (replaced && entry.lifetime !== "event-bus")) state.values.delete(key);
 state.sessionId = sessionId; return ++state.generation;
}
export function invalidateRuntimeBranch(bus: object): void {
 for (const [key, entry] of scope(bus).values) if (entry.lifetime === "branch") scope(bus).values.delete(key);
}
export function runtimeIdentity(bus: object): { sessionId: string | null; generation: number } {
 const state = scope(bus); return { sessionId: state.sessionId, generation: state.generation };
}
