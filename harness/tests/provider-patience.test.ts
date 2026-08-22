import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { applyProviderPatience } from "../extensions/provider-patience.ts";
import { makeFakePi } from "./integration-harness.ts";

const DISPATCHER = Symbol.for("undici.globalDispatcher.2");

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
	const previous = (globalThis as Record<PropertyKey, unknown>)[DISPATCHER];
	const { url, close } = await slowHeaderServer(1200);
	try {
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
		(globalThis as Record<PropertyKey, unknown>)[DISPATCHER] = previous;
		close();
	}
});

test("fail-open: an unrecognized dispatcher shape leaves the default in place", () => {
	const g = globalThis as Record<PropertyKey, unknown>;
	const previous = g[DISPATCHER];
	try {
		g[DISPATCHER] = { not: "a dispatcher" };
		const result = applyProviderPatience(1_800_000, 1_800_000);
		assert.equal(result.applied, false);
		assert.deepEqual(g[DISPATCHER], { not: "a dispatcher" }, "must not install over an unknown shape");
	} finally {
		g[DISPATCHER] = previous;
	}
});

test("extension: default-on swaps at registration; PROVIDER_PATIENCE=off leaves fetch alone", async () => {
	const g = globalThis as Record<PropertyKey, unknown>;
	const previous = g[DISPATCHER];
	const prevEnv = process.env.PROVIDER_PATIENCE;
	try {
		process.env.PROVIDER_PATIENCE = "off";
		const off = await import(`../extensions/provider-patience.ts?off=${Date.now()}-${Math.random()}`);
		const fpOff = makeFakePi();
		off.default(fpOff.pi as never);
		assert.equal(fpOff.handlers.size, 0, "kill switch must register nothing");
		assert.equal(g[DISPATCHER], previous, "kill switch must not touch the dispatcher");

		delete process.env.PROVIDER_PATIENCE;
		const on = await import(`../extensions/provider-patience.ts?on=${Date.now()}-${Math.random()}`);
		const fpOn = makeFakePi();
		on.default(fpOn.pi as never);
		assert.notEqual(g[DISPATCHER], previous, "default-on must install the patient dispatcher");
		assert.equal(typeof (g[DISPATCHER] as { dispatch?: unknown })?.dispatch, "function",
			"the installed dispatcher must still be a real dispatcher");
	} finally {
		g[DISPATCHER] = previous;
		if (prevEnv === undefined) delete process.env.PROVIDER_PATIENCE; else process.env.PROVIDER_PATIENCE = prevEnv;
	}
});
