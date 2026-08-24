import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { applyProviderPatience, DISPATCHER_SYMBOLS } from "../extensions/provider-patience.ts";
import { makeFakePi } from "./integration-harness.ts";

// Node keeps the real Agent at ".2" on >=26 but at ".1" on 22/24 (CI runs 22 and
// caught the ".2"-only version). Tests snapshot and restore EVERY symbol, and
// never assume which one the swap lands on.
function snapshotDispatchers(): Map<symbol, unknown> {
	const g = globalThis as Record<PropertyKey, unknown>;
	return new Map(DISPATCHER_SYMBOLS.map((sym) => [sym, g[sym]]));
}
function restoreDispatchers(saved: Map<symbol, unknown>): void {
	const g = globalThis as Record<PropertyKey, unknown>;
	for (const [sym, value] of saved) {
		if (value === undefined) delete g[sym]; else g[sym] = value;
	}
}

function slowHeaderServer(delayMs: number): Promise<{ url: string; close: () => void }> {
	const server = http.createServer((req, res) => setTimeout(() => res.end("ok"), delayMs));
	return new Promise((resolve) =>
		server.listen(0, "127.0.0.1", () =>
			resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, close: () => server.close() })));
}

test("the dispatcher swap governs fetch header patience — both polarities", async () => {
	// The measured live failure: undici's stock headersTimeout (300s) aborted 16 of
	// 600 provider requests at ~301s with status=None — a big model streams nothing
	// until prefill completes, so >300s to FIRST BYTE dies before any status
	// arrives. This test proves the swap is what governs fetch, in miniature: a
	// 300ms cap must kill a 1200ms-header response, and a raised cap must let the
	// same response through. Reverting the extension's swap makes polarity 1 pass
	// vacuously slow — the 300ms cap is the counterfactual's teeth.
	const saved = snapshotDispatchers();
	const { url, close } = await slowHeaderServer(1200);
	try {
		// Materialize the lazy global deterministically on every node version: one
		// real fetch before the swap (the extension's own bootstrap covers the
		// production path; tests must not depend on which init behavior this node has).
		await (await fetch(url)).text();
		const capped = applyProviderPatience(300, 300);
		assert.equal(capped.applied, true, capped.reason);
		await assert.rejects(fetch(url), (error: Error & { cause?: { code?: string } }) => {
			assert.equal(error.cause?.code, "UND_ERR_HEADERS_TIMEOUT", String(error.cause ?? error));
			return true;
		}, "a 300ms cap must abort a 1200ms-header response");

		const raised = applyProviderPatience(1_800_000, 1_800_000);
		assert.equal(raised.applied, true, raised.reason);
		const response = await fetch(url);
		assert.equal(await response.text(), "ok", "a raised cap must let the slow-header response through");
	} finally {
		restoreDispatchers(saved);
		close();
	}
});

test("node-22 shape: the swap falls back to the '.1' symbol when '.2' is absent", () => {
	// On node 22/24 the real Agent lives at ".1" and ".2" does not exist. Simulate
	// that shape on any node: move a real dispatcher to ".1", delete ".2", and the
	// swap must apply via the fallback -- at ".1", touching nothing else.
	const g = globalThis as Record<PropertyKey, unknown>;
	const saved = snapshotDispatchers();
	const [SYM2, SYM1] = DISPATCHER_SYMBOLS;
	try {
		const real = DISPATCHER_SYMBOLS.map((sym) => g[sym])
			.find((v) => typeof (v as { dispatch?: unknown } | undefined)?.dispatch === "function");
		assert.ok(real, "test needs one real dispatcher to relocate");
		g[SYM1] = real;
		// `delete` cannot remove the lazily-materialized global on every node, so
		// absence is simulated with undefined -- which holdsDispatcher() treats the
		// same way, and which IS the observable node-22 state of ".2".
		g[SYM2] = undefined;
		const result = applyProviderPatience(1_800_000, 1_800_000);
		assert.equal(result.applied, true, result.reason);
		assert.notEqual(g[SYM1], real, "the patient dispatcher must land at '.1'");
		assert.equal(typeof (g[SYM1] as { dispatch?: unknown }).dispatch, "function");
		assert.equal(g[SYM2], undefined, "'.2' must stay untouched");
	} finally {
		restoreDispatchers(saved);
	}
});

test("fail-open: unrecognized shapes at EVERY symbol leave the defaults in place", () => {
	const g = globalThis as Record<PropertyKey, unknown>;
	const saved = snapshotDispatchers();
	try {
		// Poison every candidate symbol: on node 22 the real dispatcher lives at
		// ".1", so poisoning only ".2" would let the swap succeed via the fallback.
		for (const sym of DISPATCHER_SYMBOLS) g[sym] = { not: "a dispatcher" };
		const result = applyProviderPatience(1_800_000, 1_800_000);
		assert.equal(result.applied, false);
		for (const sym of DISPATCHER_SYMBOLS) {
			assert.deepEqual(g[sym], { not: "a dispatcher" }, "must not install over an unknown shape");
		}
	} finally {
		restoreDispatchers(saved);
	}
});

test("extension: default-on swaps at registration; PROVIDER_PATIENCE=off leaves fetch alone", async () => {
	const g = globalThis as Record<PropertyKey, unknown>;
	const saved = snapshotDispatchers();
	const prevEnv = process.env.PROVIDER_PATIENCE;
	try {
		process.env.PROVIDER_PATIENCE = "off";
		const off = await import(`../extensions/provider-patience.ts?off=${Date.now()}-${Math.random()}`);
		const fpOff = makeFakePi();
		off.default(fpOff.pi as never);
		assert.equal(fpOff.handlers.size, 0, "kill switch must register nothing");
		for (const [sym, value] of saved) {
			assert.equal(g[sym], value, "kill switch must not touch any dispatcher symbol");
		}

		delete process.env.PROVIDER_PATIENCE;
		const on = await import(`../extensions/provider-patience.ts?on=${Date.now()}-${Math.random()}`);
		const fpOn = makeFakePi();
		on.default(fpOn.pi as never);
		const changed = DISPATCHER_SYMBOLS.filter((sym) => g[sym] !== saved.get(sym));
		assert.equal(changed.length, 1, "default-on must install the patient dispatcher at exactly one symbol");
		assert.equal(typeof (g[changed[0]] as { dispatch?: unknown })?.dispatch, "function",
			"the installed dispatcher must still be a real dispatcher");
	} finally {
		restoreDispatchers(saved);
		if (prevEnv === undefined) delete process.env.PROVIDER_PATIENCE; else process.env.PROVIDER_PATIENCE = prevEnv;
	}
});
