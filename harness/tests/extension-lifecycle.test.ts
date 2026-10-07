import assert from "node:assert/strict";
import test from "node:test";
const bus = {};
import { disposeAllSubscriptions, subscribeOnce } from "../lib/extension-lifecycle.ts";

test("subscribeOnce disposes the previous generation's subscription for the same key", () => {
	disposeAllSubscriptions();
	let firstDisposed = 0;
	let secondCalls = 0;
	subscribeOnce(bus, "test:channel", () => {
		return () => { firstDisposed += 1; };
	});
	assert.equal(firstDisposed, 0, "the first generation's disposer must not fire until replaced");
	subscribeOnce(bus, "test:channel", () => {
		secondCalls += 1;
		return () => {};
	});
	assert.equal(firstDisposed, 1, "re-subscribing the same key disposes the previous generation exactly once");
	assert.equal(secondCalls, 1, "the new generation subscribes exactly once");
});

test("a throwing disposer from a stale bus is swallowed, not raised", () => {
	disposeAllSubscriptions();
	subscribeOnce(bus, "test:stale", () => {
		return () => { throw new Error("bus no longer exists"); };
	});
	let replaced = false;
	assert.doesNotThrow(() => {
		subscribeOnce(bus, "test:stale", () => {
			replaced = true;
			return () => {};
		});
	}, "a throwing previous disposer must not block the next generation's subscription");
	assert.equal(replaced, true);
});

test("distinct keys hold independent subscriptions", () => {
	disposeAllSubscriptions();
	let aDisposed = 0;
	let bDisposed = 0;
	subscribeOnce(bus, "test:a", () => () => { aDisposed += 1; });
	subscribeOnce(bus, "test:b", () => () => { bDisposed += 1; });
	subscribeOnce(bus, "test:a", () => () => {});
	assert.equal(aDisposed, 1, "replacing key a must not touch key b");
	assert.equal(bDisposed, 0);
});

test("disposeAllSubscriptions calls every registered disposer and clears the registry", () => {
	disposeAllSubscriptions();
	const disposed: string[] = [];
	subscribeOnce(bus, "test:one", () => () => disposed.push("one"));
	subscribeOnce(bus, "test:two", () => () => disposed.push("two"));
	disposeAllSubscriptions();
	assert.deepEqual(disposed.sort(), ["one", "two"]);
	// The registry is empty afterward: re-subscribing a previously-used key must
	// not fire a stale disposer left over from before the clear.
	let refired = 0;
	subscribeOnce(bus, "test:one", () => () => { refired += 1; });
	subscribeOnce(bus, "test:one", () => () => {});
	assert.equal(refired, 1, "only the post-clear subscription's own disposer fires");
});

test("disposeAllSubscriptions swallows a throwing disposer and still clears the rest", () => {
	disposeAllSubscriptions();
	let goodDisposed = false;
	subscribeOnce(bus, "test:throws", () => () => { throw new Error("stale bus"); });
	subscribeOnce(bus, "test:good", () => () => { goodDisposed = true; });
	assert.doesNotThrow(() => disposeAllSubscriptions());
	assert.equal(goodDisposed, true);
	// Registry is clear either way.
	let refired = 0;
	subscribeOnce(bus, "test:throws", () => () => { refired += 1; });
	subscribeOnce(bus, "test:throws", () => () => {});
	assert.equal(refired, 1);
});

test("the registry lives on globalThis and survives a fresh module instance", async () => {
	disposeAllSubscriptions();
	let disposed = 0;
	subscribeOnce(bus, "test:cross-instance", () => () => { disposed += 1; });
	// Pi's reload gives every extension generation a fresh module instance (module
	// scope and the default() closure both die); only globalThis survives. A
	// cache-busted re-import is exactly that: a distinct module instance sharing
	// the same process, the situation this module exists to handle.
	const fresh = await import(`../lib/extension-lifecycle.ts?reload=${Date.now()}-${Math.random()}`);
	fresh.subscribeOnce(bus, "test:cross-instance", () => () => {});
	assert.equal(disposed, 1, "a subscription recorded by one module instance is disposed by the next");
	fresh.disposeAllSubscriptions();
});

test("independent buses retain their subscriptions across another session's registration and teardown", () => {
 const a = {}, b = {}; let first = 0, second = 0;
 subscribeOnce(a, "same:key", () => () => { first++; });
 subscribeOnce(b, "same:key", () => () => { second++; });
 assert.equal(first, 0);
 disposeAllSubscriptions(a); assert.equal(first, 1); assert.equal(second, 0);
 subscribeOnce(b, "same:key", () => () => {}); assert.equal(second, 1);
 disposeAllSubscriptions(b);
});
test("a failed replacement does not retain a disposed subscription", () => {
 const bus = {}; let disposed = 0;
 subscribeOnce(bus, "key", () => () => { disposed++; });
 assert.throws(() => subscribeOnce(bus, "key", () => { throw new Error("registration failed"); }));
 disposeAllSubscriptions(bus); assert.equal(disposed, 1);
});

test("reload facades share emitter ownership; independent emitters remain separate", () => {
 const channels = new Map<string, Set<(value: unknown) => void>>();
 const facade = () => ({ emit: (key: string, value: unknown) => { for (const fn of channels.get(key) ?? []) fn(value); },
  on: (key: string, fn: (value: unknown) => void) => { if (!channels.has(key)) channels.set(key,new Set()); channels.get(key)!.add(fn); return () => {channels.get(key)?.delete(fn);}; } });
 const old = facade(), fresh = facade(); let first=0, second=0;
 subscribeOnce(old, "extension:signal", () => old.on("signal",()=>{first++;}));
 subscribeOnce(fresh, "extension:signal", () => fresh.on("signal",()=>{second++;}));
 fresh.emit("signal", null); assert.equal(first,0); assert.equal(second,1);
 disposeAllSubscriptions(old);fresh.emit("signal",null);assert.equal(second,1);
});
