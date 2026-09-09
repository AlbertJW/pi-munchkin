import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createSam2TinyAdapter, SAM2_TINY_PROTOCOL, Sam2TinyError } from "../lib/sam2-tiny.ts";
import { refineWithSam, type GroundingRequest } from "../lib/visual-grounding.ts";

const image = new Uint8Array([1, 2, 3, 4]);
const exact = createHash("sha256").update(image).digest("hex");
const request: GroundingRequest = { observation_id: "a".repeat(64), exact_sha256: exact, geometry: { width: 100, height: 80, device_scale: 2 }, hint: { kind: "point", x: 50, y: 40 }, purpose: "click", image_bytes: image };

test("SAM 2.1 Tiny adapter speaks a bounded local protocol and returns validated geometry", async () => {
	const script = `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);if(r.protocol!==${JSON.stringify(SAM2_TINY_PROTOCOL)}||r.image_base64.length===0)process.exit(2);process.stdout.write(JSON.stringify({segmenter:'sam2.1-tiny',segmenter_version:'fixture',mask_digest:'${"c".repeat(64)}',box:{x:30,y:20,width:40,height:40},safe_point:{x:50,y:40},model_score:0.8}))})`;
	const adapter = createSam2TinyAdapter({ command: process.execPath, args: ["-e", script], version: "fixture" });
	const result = await refineWithSam(adapter, request);
	assert.equal(result.schema, "pi.visual-grounding/v1");
	assert.equal(result.click_safe, null);
});

test("SAM adapter refuses an image whose bytes do not match the observation", async () => {
	const adapter = createSam2TinyAdapter({ command: process.execPath, args: ["-e", "process.stdin.resume()"], version: "fixture" });
	await assert.rejects(() => adapter.refine({ ...request, image_bytes: new Uint8Array([9]) }), (error: unknown) => error instanceof Sam2TinyError && error.reason === "invalid");
});

test("SAM runner cancellation terminates one local attempt without retry", async () => {
	const adapter = createSam2TinyAdapter({ command: process.execPath, args: ["-e", "process.stdin.on('data',()=>{});setTimeout(()=>{},10000)"], version: "fixture", timeout_ms: 20_000 });
	const controller = new AbortController();
	setTimeout(() => controller.abort(), 20);
	await assert.rejects(() => adapter.refine({ ...request, image_bytes: image, signal: controller.signal }), (error: unknown) => error instanceof Sam2TinyError && error.reason === "cancelled");
});
