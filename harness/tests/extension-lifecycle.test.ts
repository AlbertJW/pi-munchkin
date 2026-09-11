import assert from "node:assert/strict";
import test from "node:test";
import { disposeAllSubscriptions, subscribeOnce } from "../lib/extension-lifecycle.ts";

test("subscribeOnce disposes the previous generation's subscription for the same key", () => {
	disposeAllSubscriptions();
	let firstDisposed = 0;
	let secondCalls = 0;
	subscribeOnce("test:channel", () => {
		return () => { firstDisposed += 1; };
	});
	assert.equal(firstDisposed, 0, "the first generation's disposer must not fire until replaced");
	subscribeOnce("test:channel", () => {
		secondCalls += 1;
		return () => {};
	});
	assert.equal(firstDisposed, 1, "re-subscribing the same key disposes the previous generation exactly once");
	assert.equal(secondCalls, 1, "the new generation subscribes exactly once");
});

test("a throwing disposer from a stale bus is swallowed, not raised", () => {
	disposeAllSubscriptions();
	subscribeOnce("test:stale", () => {
		return () => { throw new Error("bus no longer exists"); };
	});
	let replaced = false;
	assert.doesNotThrow(() => {
		subscribeOnce("test:stale", () => {
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
	subscribeOnce("test:a", () => () => { aDisposed += 1; });
	subscribeOnce("test:b", () => () => { bDisposed += 1; });
	subscribeOnce("test:a", () => () => {});
	assert.equal(aDisposed, 1, "replacing key a must not touch key b");
	assert.equal(bDisposed, 0);
});

test("disposeAllSubscriptions calls every registered disposer and clears the registry", () => {
	disposeAllSubscriptions();
	const disposed: string[] = [];
	subscribeOnce("test:one", () => () => disposed.push("one"));
	subscribeOnce("test:two", () => () => disposed.push("two"));
	disposeAllSubscriptions();
	assert.deepEqual(disposed.sort(), ["one", "two"]);
	// The registry is empty afterward: re-subscribing a previously-used key must
	// not fire a stale disposer left over from before the clear.
	let refired = 0;
	subscribeOnce("test:one", () => () => { refired += 1; });
	subscribeOnce("test:one", () => () => {});
	assert.equal(refired, 1, "only the post-clear subscription's own disposer fires");
});

test("disposeAllSubscriptions swallows a throwing disposer and still clears the rest", () => {
	disposeAllSubscriptions();
	let goodDisposed = false;
	subscribeOnce("test:throws", () => () => { throw new Error("stale bus"); });
	subscribeOnce("test:good", () => () => { goodDisposed = true; });
	assert.doesNotThrow(() => disposeAllSubscriptions());
	assert.equal(goodDisposed, true);
	// Registry is clear either way.
	let refired = 0;
	subscribeOnce("test:throws", () => () => { refired += 1; });
	subscribeOnce("test:throws", () => () => {});
	assert.equal(refired, 1);
});

test("the registry lives on globalThis and survives a fresh module instance", async () => {
	disposeAllSubscriptions();
	let disposed = 0;
	subscribeOnce("test:cross-instance", () => () => { disposed += 1; });
	// Pi's reload gives every extension generation a fresh module instance (module
	// scope and the default() closure both die); only globalThis survives. A
	// cache-busted re-import is exactly that: a distinct module instance sharing
	// the same process, the situation this module exists to handle.
	const fresh = await import(`../lib/extension-lifecycle.ts?reload=${Date.now()}-${Math.random()}`);
	fresh.subscribeOnce("test:cross-instance", () => () => {});
	assert.equal(disposed, 1, "a subscription recorded by one module instance is disposed by the next");
	fresh.disposeAllSubscriptions();
});
