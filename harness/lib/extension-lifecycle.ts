// extension-lifecycle — state and subscriptions that know what a reload does to them.
//
// Pi's reload semantics, verified against the installed dist:
//   * `resource-loader.reload()` calls `clearExtensionCache()` once a session has
//     loaded (resource-loader.js:219), so the module is RE-IMPORTED, and
//     `loadExtension` always re-invokes the factory against a fresh api
//     (loader.js:354-357). Module scope and `default()` closure die together —
//     `globalThis` is the only store that outlives a reload inside one process.
//   * The event bus is built ONCE in the constructor (resource-loader.js:120) and
//     handed to every generation. Its `clear()` has no callers anywhere.
//   * `pi.on(...)` handlers do NOT accumulate — `createExtension()` gives each
//     generation a fresh `handlers` Map (loader.js:328-344). `pi.events.on(...)`
//     subscriptions DO, because they live on that one shared bus.
//   * The previous generation's runtime is invalidated on replacement
//     (agent-session.js:551), so every `pi.*` call a stale handler makes throws —
//     and event-bus.js wraps handlers in try/catch, so it is swallowed to
//     console.error. Stale subscribers are therefore silent, not harmless: they
//     burn work, they can mutate shared `globalThis` state before their first
//     throwing `pi.*` call, and Node's default `maxListeners` is 10 with nothing
//     raising it — measured, the domain-signal channel goes 7 → 14 on ONE reload.

const SUBSCRIPTIONS_KEY = "__pi_extension_subscriptions_v1";

export type Disposer = () => void;

function registry(): Map<string, Disposer> {
	const shared = globalThis as Record<string, unknown>;
	const existing = shared[SUBSCRIPTIONS_KEY];
	if (existing instanceof Map) return existing as Map<string, Disposer>;
	const fresh = new Map<string, Disposer>();
	shared[SUBSCRIPTIONS_KEY] = fresh;
	return fresh;
}

/**
 * Subscribe to a shared bus channel, disposing this key's PREVIOUS-generation
 * subscription first.
 *
 * Every one of the fifteen `onHarnessSignal` / `onControlProposal` /
 * `onControlDecision` / `onRunStateSnapshot` / `onRunEvent` call sites in this
 * harness discarded the unsubscribe function the bus returns. Nothing else could
 * dispose them: an extension gets no unload hook, and by the time the next
 * generation runs, the closure holding the disposer is gone. Parking it on
 * `globalThis` is what makes the next generation able to clean up after the last.
 *
 * `key` must be unique per (extension, channel).
 */
export function subscribeOnce(key: string, subscribe: () => Disposer): void {
	const subscriptions = registry();
	const previous = subscriptions.get(key);
	if (previous) {
		// A disposer from a bus that no longer exists is not an error worth raising:
		// the subscription it would have removed is already unreachable.
		try { previous(); } catch { /* stale bus */ }
	}
	subscriptions.set(key, subscribe());
}

/** Drop every recorded subscription. For tests and for a full process teardown. */
export function disposeAllSubscriptions(): void {
	const subscriptions = registry();
	for (const dispose of subscriptions.values()) {
		try { dispose(); } catch { /* stale bus */ }
	}
	subscriptions.clear();
}
