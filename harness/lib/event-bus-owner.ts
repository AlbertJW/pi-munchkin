/** Pi may expose a fresh events facade per extension generation. Ownership follows the emitter, not that facade. */
const CACHE = "__pi_event_bus_owner_v1";
const CHANNEL = "pi-munchkin/event-bus-owner/v1";
export type BusFacade = { emit(event: string, data: unknown): void; on(event: string, handler: (data: unknown) => void): () => void };
export function eventBusOwner(bus: object): object {
 const global = globalThis as Record<string, unknown>;
 if (!(global[CACHE] instanceof WeakMap)) global[CACHE] = new WeakMap<object, object>();
 const cache = global[CACHE] as WeakMap<object, object>;
 const existing = cache.get(bus); if (existing) return existing;
 const facade = bus as Partial<BusFacade>;
 if (typeof facade.emit !== "function" || typeof facade.on !== "function") { cache.set(bus, bus); return bus; }
 const probe: { owner?: object } = {};
 facade.emit(CHANNEL, probe);
 if (!probe.owner) {
  const owner = {};
  // The listener lives exactly as long as its emitter; it captures no Pi API or facade.
  facade.on(CHANNEL, value => {
   if (value && typeof value === "object" && !Reflect.has(value, "owner")) Reflect.set(value, "owner", owner);
  });
  probe.owner = owner;
 }
 cache.set(bus, probe.owner); return probe.owner;
}
