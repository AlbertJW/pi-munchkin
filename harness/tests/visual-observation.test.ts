import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { CONTEXT_RESERVATION_KEY } from "../lib/context-accounting.ts";
import { cropPng, hammingDistance, imageDigest, perceptualHash, pngLuma, regionDigests, VisualObservationCache } from "../lib/visual-observation.ts";
import { refineWithSam, validateGroundingResult, type GroundingRequest } from "../lib/visual-grounding.ts";
import { fire } from "./integration-harness.ts";

const geometry = { width: 32, height: 32, device_scale: 2 };
const base = new Uint8Array(32 * 32);
for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) base[y * 32 + x] = (x * 7 + y * 3) & 0xff;

function fixturePng(): Uint8Array {
	const chunk = (kind: string, payload: Uint8Array) => { const out = new Uint8Array(12 + payload.length); new DataView(out.buffer).setUint32(0, payload.length); out.set(new TextEncoder().encode(kind), 4); out.set(payload, 8); return out; };
	const ihdr = new Uint8Array(13); const view = new DataView(ihdr.buffer); view.setUint32(0, 2); view.setUint32(4, 1); ihdr[8] = 8; ihdr[9] = 2;
	const raw = Uint8Array.from([0, 255, 0, 0, 0, 0, 255]);
	const chunks = [chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())];
	return Uint8Array.from(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks.map((item) => Buffer.from(item))]));
}

function request(overrides: Record<string, unknown> = {}) {
	return {
		session_id: "session-a", source: "screen" as const, source_id: "window-1", geometry,
		exact_sha256: imageDigest(new Uint8Array([1, 2, 3])), phash: perceptualHash(base, 32, 32), question: "where is save?", model_fingerprint: "model-a", analysis_version: "v1", now: 1_000, ttl_ms: 30_000, ...overrides,
	};
}

test("perceptual hash is deterministic and measures visual similarity", () => {
	const changed = base.slice(); changed[16 * 32 + 16] = 255;
	const first = perceptualHash(base, 32, 32);
	assert.equal(first, perceptualHash(base, 32, 32));
	assert.match(first, /^[0-9a-f]{16}$/);
	assert.ok((hammingDistance(first, perceptualHash(changed, 32, 32)) ?? 64) < 8);
	assert.equal(hammingDistance(first, "bad"), null);
});

test("PNG crop materializes the same pixels and geometry sent to the model", () => {
	const cropped = cropPng(fixturePng(), { x: 1, y: 0, width: 1, height: 1 });
	assert.ok(cropped);
	const decoded = pngLuma(cropped!);
	assert.deepEqual({ width: decoded?.width, height: decoded?.height }, { width: 1, height: 1 });
	assert.equal(decoded?.luma[0], 18, "the cropped blue pixel is preserved rather than replaced by a placeholder");
});

test("PNG dimension bombs fail closed before allocating an unbounded raster", () => {
	const hostile = fixturePng();
	new DataView(hostile.buffer, hostile.byteOffset, hostile.byteLength).setUint32(16, 0xffffffff);
	assert.equal(pngLuma(hostile), null);
});

test("cache partitions by window and reuses exact or near frames only", () => {
	const cache = new VisualObservationCache();
	const first = request();
	assert.equal(cache.decide(first).decision, "fresh");
	cache.put(first, "stable layout");
	assert.equal(cache.decide(first).decision, "exact_reuse", "same visual identity may reuse the current interpretation");
	const otherWindow = { ...first, source_id: "window-2", exact_sha256: imageDigest(new Uint8Array([9])) };
	assert.equal(cache.decide(otherWindow).decision, "fresh");
	const stale = { ...first, exact_sha256: imageDigest(new Uint8Array([8])), now: 40_001, ttl_ms: 30_000 };
	assert.equal(cache.decide(stale).decision, "stale");
	assert.equal(cache.decide({ ...first, exact_sha256: imageDigest(new Uint8Array([8])), force: true }).decision, "forced");
});

test("segmenter frames are ephemeral and never survive cache invalidation", () => {
	const cache = new VisualObservationCache(1);
	const first = request();
	const entry = cache.put(first, undefined, new Uint8Array([7, 8, 9]));
	assert.deepEqual(cache.findFrame(entry.observation_id), new Uint8Array([7, 8, 9]));
	const second = { ...first, source_id: "window-2" };
	const secondEntry = cache.put(second, undefined, new Uint8Array([1]));
	assert.equal(cache.findFrame(entry.observation_id), null, "eviction removes image bytes before they can leak or be reused");
	cache.clear();
	assert.equal(cache.findFrame(secondEntry.observation_id), null);
});

test("ephemeral segmenter bytes obey an independent memory ceiling", () => {
	const cache = new VisualObservationCache(4, 8, 4);
	const first = cache.put(request(), undefined, new Uint8Array([1, 2, 3, 4]));
	const second = cache.put({ ...request(), source_id: "window-2" }, undefined, new Uint8Array([5, 6]));
	assert.equal(cache.findFrame(first.observation_id), null, "oldest frame is evicted before the byte ceiling is exceeded");
	assert.deepEqual(cache.findFrame(second.observation_id), new Uint8Array([5, 6]));
});

test("near matches are hints and forced refresh bypasses them", () => {
	const cache = new VisualObservationCache(8, 8);
	const first = request(); cache.put(first, "layout");
	const near = { ...first, exact_sha256: imageDigest(new Uint8Array([4])), phash: first.phash };
	const decision = cache.decide(near);
	assert.equal(decision.decision, "near_reuse");
	assert.equal(decision.observation?.interpretation, "layout");
	assert.equal(cache.decide({ ...near, force: true }).decision, "forced");
});

test("explicit uncertainty blocks reuse until a fresh observation replaces it", () => {
	const cache = new VisualObservationCache();
	const first = request(); cache.put(first, "layout");
	assert.equal(cache.decide({ ...first, uncertain: true }).decision, "forced");
	assert.equal(cache.decide(first).decision, "forced", "uncertainty must persist beyond the signalling call");
	const refreshed = { ...first, exact_sha256: imageDigest(new Uint8Array([77])) };
	cache.put(refreshed, "new layout");
	assert.equal(cache.decide(refreshed).decision, "exact_reuse", "a fresh replacement clears the uncertainty fence");
});

test("a changed local visual region disables near-cache reuse", () => {
	const cache = new VisualObservationCache();
	const left = new Uint8Array(16); const right = left.slice(); right[15] = 255;
	const first = { ...request(), phash: "0000000000000000", region_digests: regionDigests(left, 4, 4) };
	cache.put(first, "layout");
	const changed = { ...first, exact_sha256: imageDigest(new Uint8Array([99])), region_digests: regionDigests(right, 4, 4) };
	assert.notEqual(cache.decide(changed).decision, "near_reuse", "pHash similarity cannot hide a changed local region");
});

test("SAM grounding binds result to the exact observation and never asserts click safety", async () => {
	const request: GroundingRequest = { observation_id: "a".repeat(64), exact_sha256: "b".repeat(64), geometry, hint: { kind: "point", x: 16, y: 16 }, purpose: "click", expected_label: "Save" };
	const result = await refineWithSam({ name: "sam2.1-tiny", version: "fixture", refine: async () => ({ segmenter: "sam2.1-tiny", segmenter_version: "fixture", mask_digest: "c".repeat(64), box: { x: 8, y: 8, width: 16, height: 16 }, safe_point: { x: 16, y: 16 }, model_score: 0.9 }) }, request);
	assert.equal(result.exact_sha256, request.exact_sha256);
	assert.equal(result.click_safe, null);
	validateGroundingResult(request, result);
	await assert.rejects(() => refineWithSam({ name: "sam", version: "v", refine: async () => ({ segmenter: "sam", segmenter_version: "v", mask_digest: "c".repeat(64), box: { x: 8, y: 8, width: 16, height: 16 }, safe_point: { x: 8, y: 8 }, model_score: 0.9 }) }, request), /interior/);
});

test("visual observe delivers image content to a vision model and reuses exact frames", async () => {
	const previous = process.env.VISION;
	process.env.VISION = "on";
	try {
		const { makeFakePi } = await import("./integration-harness.ts");
		const { registerVisualTools } = await import(`../extensions/visual-observe.ts?fixture=${Date.now()}-${Math.random()}`);
		const fp = makeFakePi(); const cwd = mkdtempSync(join(tmpdir(), "pi-visual-observe-"));
		registerVisualTools(fp.pi as any, { sessionId: "fixture-session", capture: async () => ({ bytes: new Uint8Array([1, 2, 3, 4]), mime: "image/jpeg", width: 100, height: 80 }) });
		const tool = fp.tools.get("visual_observe");
		const ctx = { cwd, model: { provider: "fixture", id: "vision-model", supportsVision: true } };
		const first = await tool.execute("one", { source: "screen", source_id: "window-a", question: "what is visible?" }, undefined, undefined, ctx);
		assert.equal(first.content[0].type, "image");
		assert.equal(first.details.success, true);
		const second = await tool.execute("two", { source: "screen", source_id: "window-a", question: "what is visible?" }, undefined, undefined, ctx);
		assert.equal(second.details.decision, "exact_reuse");
		assert.equal(second.content.every((part: { type: string }) => part.type === "text"), true);
		const uncertain = await tool.execute("uncertain", { source: "screen", source_id: "window-a", question: "what is visible?", uncertain: true }, undefined, undefined, ctx);
		assert.equal(uncertain.details.decision, "forced", "an explicit uncertainty signal must bypass the interpretation cache");
		const unsupported = await tool.execute("three", { source: "screen", source_id: "window-a", question: "what is visible?" }, undefined, undefined, { cwd, model: { provider: "fixture", id: "text-only" } });
		assert.equal(unsupported.details.reason, "vision-unavailable");
		const bad = makeFakePi();
		const { registerVisualTools: registerBadVisualTools } = await import(`../extensions/visual-observe.ts?bad-capture=${Date.now()}-${Math.random()}`);
		registerBadVisualTools(bad.pi as any, { capture: async () => ({ bytes: new Uint8Array([1]), mime: "text/plain", width: 10, height: 10 } as any) });
		await assert.rejects(() => bad.tools.get("visual_observe").execute("bad", { source: "screen", source_id: "window-a", question: "bad" }, undefined, undefined, ctx), /invalid image metadata/);
	} finally {
		if (previous === undefined) delete process.env.VISION; else process.env.VISION = previous;
	}
});

test("visual lifecycle observes bounded checkpoints, forces after UI actions, and stops at settlement", async () => {
	const previous = process.env.VISION;
	process.env.VISION = "on";
	try {
		const { makeFakePi } = await import("./integration-harness.ts");
		const { registerVisualTools } = await import(`../extensions/visual-observe.ts?lifecycle-fixture=${Date.now()}-${Math.random()}`);
		const fp = makeFakePi(); const cwd = mkdtempSync(join(tmpdir(), "pi-visual-lifecycle-"));
		let captures = 0;
		registerVisualTools(fp.pi as any, {
			sessionId: "lifecycle-session",
			capture: async () => ({ bytes: new Uint8Array([captures += 1]), mime: "image/jpeg", width: 64, height: 64 }),
		});
		const model = { provider: "fixture", id: "vision", supportsVision: true };
		const tool = fp.tools.get("visual_observe");
		const observed = await tool.execute("observe", { source: "screen", source_id: "window-a", question: "watch the screen" }, undefined, undefined, { cwd, model });
		assert.equal(observed.content[0].type, "image");
		assert.equal(captures, 1);
		const context = async () => fire(fp, "context", { type: "context", messages: [] }, { cwd, model });
		assert.equal((await context()).length, 0);
		assert.equal((await context()).length, 0);
		const checkpoint = await context();
		assert.ok(checkpoint.some((message: any) => message.customType === "pi-munchkin:visual-checkpoint"));
		assert.ok(checkpoint.some((message: any) => message.content?.some?.((part: any) => part.type === "image")));
		assert.equal(captures, 2, "a checkpoint is bounded rather than capturing every provider request");
		await fire(fp, "tool_execution_end", { type: "tool_execution_end", toolCallId: "click", toolName: "click", result: {}, isError: false }, { cwd, model });
		const afterAction = await context();
		assert.ok(afterAction.some((message: any) => message.customType === "pi-munchkin:visual-checkpoint"));
		assert.equal(captures, 3, "a successful UI action forces the next checkpoint");
		await fire(fp, "agent_settled", { type: "agent_settled" }, { cwd, model });
		await context();
		assert.equal(captures, 3, "settled agents do not keep observing the screen");
	} finally {
		if (previous === undefined) delete process.env.VISION; else process.env.VISION = previous;
	}
});

test("a UI action invalidates cached image observations even without a screen watcher", async () => {
	const previous = process.env.VISION;
	process.env.VISION = "on";
	try {
		const { makeFakePi } = await import("./integration-harness.ts");
		const { registerVisualTools } = await import(`../extensions/visual-observe.ts?action-image-fixture=${Date.now()}-${Math.random()}`);
		const fp = makeFakePi(); const cwd = mkdtempSync(join(tmpdir(), "pi-visual-action-image-"));
		writeFileSync(join(cwd, "frame.png"), fixturePng());
		registerVisualTools(fp.pi as any, { sessionId: "action-image-session" });
		const model = { provider: "fixture", id: "vision", supportsVision: true };
		const ctx = { cwd, model };
		const tool = fp.tools.get("visual_observe");
		const first = await tool.execute("one", { source: "image", path: "frame.png", question: "what is visible?" }, undefined, undefined, ctx);
		assert.equal(first.details.decision, "fresh");
		await fire(fp, "tool_execution_end", { type: "tool_execution_end", toolCallId: "click", toolName: "click", result: {}, isError: true }, ctx);
		const second = await tool.execute("two", { source: "image", path: "frame.png", question: "what is visible?" }, undefined, undefined, ctx);
		assert.equal(second.details.decision, "fresh", "an action must not permit stale image reuse");
	} finally {
		if (previous === undefined) delete process.env.VISION; else process.env.VISION = previous;
	}
});

test("visual cache is partitioned by the complete serving epoch and reset by compaction", async () => {
	const previous = process.env.VISION;
	process.env.VISION = "on";
	try {
		const { makeFakePi } = await import("./integration-harness.ts");
		const { registerVisualTools } = await import(`../extensions/visual-observe.ts?epoch-fixture=${Date.now()}-${Math.random()}`);
		const fp = makeFakePi(); const cwd = mkdtempSync(join(tmpdir(), "pi-visual-epoch-"));
		registerVisualTools(fp.pi as any, { sessionId: "epoch-session", capture: async () => ({ bytes: new Uint8Array([9, 8, 7]), mime: "image/png", width: 10, height: 10 }) });
		const tool = fp.tools.get("visual_observe");
		const firstCtx = { cwd, model: { provider: "router-a", id: "vision", baseUrl: "http://127.0.0.1:9000/v1", contextWindow: 32_768, input: ["text", "image"] } };
		const first = await tool.execute("one", { source: "screen", source_id: "window-a", question: "what is visible?" }, undefined, undefined, firstCtx);
		assert.equal(first.content[0].type, "image");
		const switched = await tool.execute("two", { source: "screen", source_id: "window-a", question: "what is visible?" }, undefined, undefined, { ...firstCtx, model: { ...firstCtx.model, contextWindow: 131_072 } });
		assert.equal(switched.content[0].type, "image", "a destination context window is a new visual serving epoch");
		assert.equal(switched.details.decision, "fresh");
		assert.ok(fp.handlers.get("session_compact")?.length, "visual extension listens for compaction");
		for (const handler of fp.handlers.get("session_compact") ?? []) await handler({});
		const afterCompact = await tool.execute("three", { source: "screen", source_id: "window-a", question: "what is visible?" }, undefined, undefined, { ...firstCtx, model: { ...firstCtx.model, contextWindow: 131_072 } });
		assert.equal(afterCompact.content[0].type, "image", "compaction invalidates cached visual interpretation");
		assert.equal(afterCompact.details.decision, "fresh");
	} finally {
		if (previous === undefined) delete process.env.VISION; else process.env.VISION = previous;
	}
});

test("grounding rejects forged adapter identity and malformed mask digests", async () => {
	const groundingRequest: GroundingRequest = { observation_id: "a".repeat(64), exact_sha256: "b".repeat(64), geometry, hint: { kind: "point", x: 16, y: 16 }, purpose: "verify" };
	await assert.rejects(() => refineWithSam({ name: "sam2.1-tiny", version: "2.1", refine: async () => ({ segmenter: "other", segmenter_version: "2.1", mask_digest: "c".repeat(64), box: { x: 8, y: 8, width: 16, height: 16 }, safe_point: { x: 16, y: 16 }, model_score: null }) }, groundingRequest), /identity mismatch/);
	await assert.rejects(() => refineWithSam({ name: "sam2.1-tiny", version: "2.1", refine: async () => ({ segmenter: "sam2.1-tiny", segmenter_version: "2.1", mask_digest: "not-a-digest", box: { x: 8, y: 8, width: 16, height: 16 }, safe_point: { x: 16, y: 16 }, model_score: null }) }, groundingRequest), /mask_digest/);
});

test("vision tools remain deferred until the capability family is explicitly enabled", async () => {
	const previous = process.env.VISION;
	process.env.VISION = "on";
	try {
		const { makeFakePi } = await import("./integration-harness.ts");
		const { registerVisualTools } = await import(`../extensions/visual-observe.ts?capability-fixture=${Date.now()}-${Math.random()}`);
		const { default: toolActivation } = await import(`../extensions/tool-activation.ts?capability-fixture=${Date.now()}-${Math.random()}`);
		const fp = makeFakePi();
		registerVisualTools(fp.pi as any, { sessionId: "capability-session", capture: async () => ({ bytes: new Uint8Array([1]), mime: "image/jpeg", width: 1, height: 1 }) });
		toolActivation(fp.pi as any);
		fp.pi.setActiveTools([...fp.tools.keys()]);
		for (const handler of fp.handlers.get("session_start") ?? []) await handler({}, { cwd: mkdtempSync(join(tmpdir(), "pi-visual-capability-")) });
		assert.equal(fp.pi.getActiveTools().includes("visual_observe"), false, "vision is opt-in under the core profile");
		const capability = fp.tools.get("capability");
		const result = await capability.execute("capability", { action: "enable", family: "vision" });
		assert.equal(result.details.success, true);
		assert.equal(fp.pi.getActiveTools().includes("visual_observe"), true);
		assert.equal(fp.pi.getActiveTools().includes("visual_refine_target"), true);
	} finally {
		if (previous === undefined) delete process.env.VISION; else process.env.VISION = previous;
	}
});

test("fresh visual evidence reserves geometry-based context capacity, not base64 length", async () => {
	const previous = process.env.VISION;
	const shared = globalThis as Record<string, unknown>;
	const previousReservation = shared[CONTEXT_RESERVATION_KEY];
	process.env.VISION = "on";
	const calls: Array<{ id: string; tokens: number }> = [];
	shared[CONTEXT_RESERVATION_KEY] = {
		schema_version: "pi.context-reservation/v1", enabled: () => true,
		reserve: (id: string, tokens: number) => { calls.push({ id, tokens }); return { ok: true, id, epoch: "fixture", tokens, idempotent: false }; },
		release: () => undefined, snapshot: () => ({ reserved_tokens: 0, reservation_count: calls.length }), epoch: () => "fixture",
	};
	try {
		const { makeFakePi } = await import("./integration-harness.ts");
		const { registerVisualTools } = await import(`../extensions/visual-observe.ts?reservation-fixture=${Date.now()}-${Math.random()}`);
		const fp = makeFakePi(); const cwd = mkdtempSync(join(tmpdir(), "pi-visual-reservation-"));
		registerVisualTools(fp.pi as any, { sessionId: "reservation-session", capture: async () => ({ bytes: new Uint8Array([1, 2]), mime: "image/jpeg", width: 64, height: 64 }) });
		const result = await fp.tools.get("visual_observe").execute("visual-call", { source: "screen", source_id: "window-a", question: "inspect" }, undefined, undefined, { cwd, model: { provider: "fixture", id: "vision", supportsVision: true } });
		assert.equal(result.content[0].type, "image");
		assert.deepEqual(calls, [{ id: "visual-call", tokens: 256 }], "the reservation uses a bounded image-patch estimate rather than counting encoded bytes");
	} finally {
		if (previous === undefined) delete process.env.VISION; else process.env.VISION = previous;
		if (previousReservation === undefined) delete shared[CONTEXT_RESERVATION_KEY]; else shared[CONTEXT_RESERVATION_KEY] = previousReservation;
	}
});

test("SAM refinement requires a cached observation with matching geometry", async () => {
	const previousVision = process.env.VISION;
	const previousGrounding = process.env.VISION_GROUNDING;
	process.env.VISION = "on";
	process.env.VISION_GROUNDING = "sam";
	try {
		const { makeFakePi } = await import("./integration-harness.ts");
		const { registerVisualTools } = await import(`../extensions/visual-observe.ts?grounding-fixture=${Date.now()}-${Math.random()}`);
		const fp = makeFakePi(); const cwd = mkdtempSync(join(tmpdir(), "pi-visual-grounding-"));
		const bytes = new Uint8Array([1, 2, 3]);
		registerVisualTools(fp.pi as any, {
			sessionId: "grounding-session", capture: async () => ({ bytes, mime: "image/jpeg", width: 100, height: 80 }),
			samAdapter: { name: "sam2.1-tiny", version: "fixture", refine: async () => ({ segmenter: "sam2.1-tiny", segmenter_version: "fixture", mask_digest: "c".repeat(64), box: { x: 20, y: 20, width: 50, height: 30 }, safe_point: { x: 45, y: 35 }, model_score: 0.9 }) },
		});
		const model = { provider: "fixture", id: "vision", supportsVision: true };
		const observed = await fp.tools.get("visual_observe").execute("observe", { source: "screen", source_id: "window-a", question: "find save" }, undefined, undefined, { cwd, model });
		const exact = imageDigest(bytes);
		const params = { observation_id: observed.details.observation_id, exact_sha256: exact, geometry: { width: 100, height: 80, device_scale: 1 }, hint: { kind: "point" as const, x: 45, y: 35 }, purpose: "click" as const };
		const refined = await fp.tools.get("visual_refine_target").execute("refine", params, undefined, undefined, { cwd, model });
		assert.equal(refined.details.success, true);
		const wrongGeometry = await fp.tools.get("visual_refine_target").execute("wrong", { ...params, geometry: { ...params.geometry, device_scale: 2 } }, undefined, undefined, { cwd, model });
		assert.equal(wrongGeometry.details.reason, "observation-not-current");
	} finally {
		if (previousVision === undefined) delete process.env.VISION; else process.env.VISION = previousVision;
		if (previousGrounding === undefined) delete process.env.VISION_GROUNDING; else process.env.VISION_GROUNDING = previousGrounding;
	}
});
