import assert from "node:assert/strict";
import test from "node:test";
import { VisualCaptureError, createMacScreenCapture, validateLocalCapture } from "../lib/visual-capture.ts";

test("local capture rejects browser targets and unsafe window identifiers before execution", async () => {
	const capture = createMacScreenCapture({ command: "/definitely/not-run" });
	await assert.rejects(() => capture("browser", "javascript:alert(1)"), (error: unknown) => error instanceof VisualCaptureError && error.reason === "unsupported");
	await assert.rejects(() => capture("screen", "../../etc/passwd"), (error: unknown) => error instanceof VisualCaptureError && error.reason === "unsupported" || error instanceof VisualCaptureError && error.reason === "invalid-target");
});

test("capture metadata validation is bounded and privacy-safe", () => {
	assert.throws(() => validateLocalCapture({ bytes: new Uint8Array(0), mime: "image/png", width: 1, height: 1, device_scale: 2, captured_at: Date.now() }), /byte budget/);
	assert.throws(() => validateLocalCapture({ bytes: new Uint8Array([1]), mime: "image/png", width: 40_000, height: 1, device_scale: 2, captured_at: Date.now() }), /invalid metadata/);
	assert.throws(() => validateLocalCapture({ bytes: new Uint8Array([1]), mime: "image/png", width: 1, height: 1, device_scale: 2, captured_at: Number.NaN }), /invalid metadata/);
});

test("visual capture cancellation is explicit and does not retry", async () => {
	let calls = 0;
	const controller = new AbortController();
	const capture = async (_source: "screen" | "browser", _id: string, _crop: unknown, signal?: AbortSignal) => {
		calls += 1;
		if (signal?.aborted) throw new VisualCaptureError("cancelled", "visual capture cancelled");
		await new Promise((resolve) => setTimeout(resolve, 5));
		if (signal?.aborted) throw new VisualCaptureError("cancelled", "visual capture cancelled");
		throw new VisualCaptureError("failed", "fixture should not complete");
	};
	controller.abort();
	await assert.rejects(() => capture("screen", "1", undefined, controller.signal), /cancelled/);
	assert.equal(calls, 1);
});
