import { eventBusOwner } from "./event-bus-owner.ts";
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

// Event-bus lifetime; reload generations replace only their own channel.
const SUBSCRIPTIONS_KEY = "__pi_extension_subscriptions_v2";
export type Disposer = () => void;
type Registry = { buses: WeakMap<object, Map<string, Disposer>>; maps: Set<WeakRef<Map<string, Disposer>>> };
function registry(): Registry {
 const shared = globalThis as Record<string, unknown>;
 const existing = shared[SUBSCRIPTIONS_KEY] as Registry | undefined;
 if (existing?.buses instanceof WeakMap && existing.maps instanceof Set) return existing;
 const fresh: Registry = { buses: new WeakMap(), maps: new Set() };
 shared[SUBSCRIPTIONS_KEY] = fresh;
 return fresh;
}
function subscriptionsFor(bus: object): Map<string, Disposer> {
 bus = eventBusOwner(bus);
 const state = registry();
 let subscriptions = state.buses.get(bus);
 if (!subscriptions) {
  subscriptions = new Map(); state.buses.set(bus, subscriptions);
  for (const ref of state.maps) if (!ref.deref()) state.maps.delete(ref);
  state.maps.add(new WeakRef(subscriptions));
 }
 return subscriptions;
}
export function subscribeOnce(bus: object, key: string, subscribe: () => Disposer): void {
 const subscriptions = subscriptionsFor(bus);
 const previous = subscriptions.get(key);
 subscriptions.delete(key);
 try { previous?.(); } catch { /* invalidated runtime */ }
 subscriptions.set(key, subscribe());
}
/** Dispose only this bus, or all reachable buses for process/test teardown. */
export function disposeAllSubscriptions(bus?: object): void {
 const maps = bus ? [subscriptionsFor(bus)] : [...registry().maps].flatMap(ref => ref.deref() ? [ref.deref()!] : []);
 for (const subscriptions of maps) {
  const disposers = [...subscriptions.values()]; subscriptions.clear();
  for (const dispose of disposers) try { dispose(); } catch { /* invalidated runtime */ }
 }
}
