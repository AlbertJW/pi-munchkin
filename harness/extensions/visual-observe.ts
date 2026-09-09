import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname } from "node:path";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveReadPath } from "../lib/context-inlet.ts";
import { modelFingerprint as contextModelFingerprint } from "../lib/context-profile.ts";
import { reserveContextOutput } from "../lib/context-accounting.ts";
import { record } from "../lib/telemetry.ts";
import { cropPng, imageDigest, perceptualHash, pngLuma, VisualObservationCache, visualTelemetry, type VisualGeometry } from "../lib/visual-observation.ts";
import { refineWithSam, type SamAdapter, type GroundingHint } from "../lib/visual-grounding.ts";

const ENABLED = process.env.VISION === "on";
const SAM_ENABLED = process.env.VISION_GROUNDING === "sam";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const DEFAULT_TTL_MS = 30_000;
const IMAGE_MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

type VisualModel = { provider?: unknown; id?: unknown; baseUrl?: unknown; contextWindow?: unknown; input?: unknown; modalities?: unknown; supportsVision?: unknown; capabilities?: { input?: unknown } };
export type VisualCapture = { bytes: Uint8Array; mime: string; width: number; height: number };
export type VisualToolOptions = { samAdapter?: SamAdapter; sessionId?: string; capture?: (source: "screen" | "browser", sourceId: string, crop?: { x: number; y: number; width: number; height: number }) => Promise<VisualCapture> };

function modelFingerprint(model: VisualModel): string {
	// Context epochs already normalize provider, model, declared window, and an
	// endpoint hash. Reuse that identity here so a same-named model on a new
	// router or context window cannot inherit an old visual interpretation.
	return contextModelFingerprint(model);
}

function supportsVision(model: VisualModel): boolean {
	if (model.supportsVision === true) return true;
	const values = [model.input, model.modalities, model.capabilities?.input].flatMap((value) => Array.isArray(value) ? value : []);
	return values.some((value) => typeof value === "string" && ["image", "vision", "multimodal"].includes(value.toLowerCase()));
}

function modelFor(ctx: unknown): VisualModel {
	return ((ctx as { model?: unknown }).model ?? {}) as VisualModel;
}

function geometryFor(width: number, height: number, deviceScale: number, crop?: { x: number; y: number; width: number; height: number }): VisualGeometry {
	const geometry: VisualGeometry = { width, height, device_scale: deviceScale };
	if (crop) geometry.viewport = crop;
	return geometry;
}

function validateCrop(crop: { x: number; y: number; width: number; height: number } | undefined, width: number, height: number): void {
	if (!crop) return;
	if (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || ![crop.x, crop.y, crop.width, crop.height].every(Number.isSafeInteger) || crop.x < 0 || crop.y < 0 || crop.width < 1 || crop.height < 1 || crop.x + crop.width > width || crop.y + crop.height > height) throw new Error("visual crop is outside the image");
}

function unavailableModelMessage(model: VisualModel): string {
	const name = typeof model.id === "string" ? model.id : "the active model";
	return `Vision is unavailable for ${name}: the serving model did not advertise image input. Load a vision-capable model with its matching multimodal projector.`;
}

function visualTokenEstimate(width: number, height: number): number {
	// Image tokens are provider-specific; do not pretend base64 bytes are tokens.
	// Reserve a conservative patch-based estimate so dynamic admission can stop a
	// screenshot before it displaces retained context. The provider's exact
	// rendered count remains authoritative at the next request boundary.
	return Math.min(16_384, Math.max(256, Math.ceil(width * height / 256)));
}

export function registerVisualTools(pi: ExtensionAPI, options: VisualToolOptions = {}): void {
	if (!ENABLED) return;
	const cache = new VisualObservationCache();
	const sessionId = options.sessionId ?? randomUUID();
	pi.on("session_start", async () => cache.clear());
	// A cache match is only meaningful in the same transcript and serving epoch.
	// Pi emits these lifecycle events before the next model request, so invalidate
	// rather than relying on the model to remember the force-refresh instruction.
	pi.on("session_compact", async () => cache.clear());
	pi.on("model_select", async () => cache.clear());

	pi.registerTool(defineTool({
		name: "visual_observe",
		label: "Visual observe",
		description: "Inspect one explicitly selected image. Returns an image only when a fresh visual observation is required; exact or near cache matches are hints and do not authorize actions.",
		promptSnippet: "visual_observe(path, question, crop?, force?): inspect an image with bounded visual caching",
		parameters: Type.Object({
			path: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
			source: Type.Optional(Type.Union([Type.Literal("image"), Type.Literal("screen"), Type.Literal("browser")])),
			source_id: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
			question: Type.String({ minLength: 1, maxLength: 1_000 }),
			device_scale: Type.Optional(Type.Number({ minimum: 0.1, maximum: 8 })),
			crop: Type.Optional(Type.Object({ x: Type.Integer({ minimum: 0 }), y: Type.Integer({ minimum: 0 }), width: Type.Integer({ minimum: 1 }), height: Type.Integer({ minimum: 1 }) })),
			force: Type.Optional(Type.Boolean()),
			ttl_ms: Type.Optional(Type.Integer({ minimum: 0, maximum: 86_400_000 })),
		}),
		async execute(_id, params, _signal, _update, ctx) {
			const model = modelFor(ctx);
			if (!supportsVision(model)) return { content: [{ type: "text" as const, text: unavailableModelMessage(model) }], details: { tool_name: "visual_observe", success: false, reason: "vision-unavailable" } };
			const source = params.source ?? "image";
			let sourceId: string; let bytes: Uint8Array; let mime: string; let width: number; let height: number;
			if (source === "image") {
				if (!params.path) throw new Error("visual_observe requires path for an image source");
				const path = resolveReadPath(ctx.cwd, params.path);
				const info = await stat(path);
				if (info.size > MAX_IMAGE_BYTES) throw new Error(`visual_observe refuses images over ${MAX_IMAGE_BYTES} bytes`);
				mime = IMAGE_MIME[extname(path).toLowerCase()] ?? "";
				if (!mime) throw new Error("visual_observe supports PNG, JPEG, GIF, and WebP images");
				bytes = await readFile(path); sourceId = await realpath(path);
				if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`visual_observe refuses images over ${MAX_IMAGE_BYTES} bytes`);
				const png = mime === "image/png" ? pngLuma(bytes) : null; width = png?.width ?? 1; height = png?.height ?? 1;
				if (params.crop) {
					validateCrop(params.crop, width, height);
					if (mime !== "image/png") throw new Error("visual file cropping currently requires an 8-bit PNG");
					const cropped = cropPng(bytes, params.crop);
					if (!cropped) throw new Error("visual crop could not be materialized");
					bytes = cropped; width = params.crop.width; height = params.crop.height;
				}
			} else {
				if (!params.source_id) throw new Error("visual_observe requires source_id for screen or browser sources");
				if (!options.capture) throw new Error(`${source} capture is unavailable: install a local capture adapter`);
				const captured = await options.capture(source, params.source_id, params.crop);
				if (!captured || typeof captured !== "object" || !(captured.bytes instanceof Uint8Array) || !Object.values(IMAGE_MIME).includes(captured.mime) || !Number.isSafeInteger(captured.width) || !Number.isSafeInteger(captured.height) || captured.width < 1 || captured.height < 1 || captured.width > 32_000 || captured.height > 32_000) throw new Error("visual capture has invalid image metadata");
				if (captured.bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`visual_observe refuses captures over ${MAX_IMAGE_BYTES} bytes`);
				bytes = captured.bytes; mime = captured.mime; width = captured.width; height = captured.height; sourceId = params.source_id;
			}
			const digest = imageDigest(bytes);
			const png = mime === "image/png" ? pngLuma(bytes) : null;
			if (source !== "image") validateCrop(params.crop, width, height);
			const geometry = geometryFor(width, height, params.device_scale ?? 1, params.crop);
			const request = { session_id: sessionId, source, source_id: sourceId, geometry, exact_sha256: digest, phash: png ? perceptualHash(png.luma, png.width, png.height) : null, question: params.question, model_fingerprint: modelFingerprint(model), analysis_version: "visual-observe/v1", ttl_ms: params.ttl_ms ?? DEFAULT_TTL_MS, force: params.force };
			const decision = cache.decide(request);
			record("visual-observe", "cache", visualTelemetry(decision));
			const metadata = `[visual ${decision.decision} observation=${decision.matched_observation_id ?? "new"} sha256=${digest.slice(0, 16)} size=${bytes.byteLength} geometry=${width}x${height}@${geometry.device_scale}]`;
			const reuse = decision.decision === "exact_reuse" || decision.decision === "near_reuse";
			if (!reuse) {
				const reservation = reserveContextOutput(_id, visualTokenEstimate(width, height));
				if (reservation && !reservation.ok) throw new Error("visual evidence exceeds the remaining context allowance; compact or crop the image before retrying");
				const observation = cache.put(request);
					return { content: [{ type: "image" as const, data: Buffer.from(bytes).toString("base64"), mimeType: mime }, { type: "text" as const, text: `${metadata} Fresh visual evidence. Use the image for this turn; cache matches never authorize an action.` }], details: { tool_name: "visual_observe", success: true, observation_id: observation.observation_id, ...visualTelemetry(decision), image_bytes: bytes.byteLength, model_fingerprint: request.model_fingerprint } };
			}
			return { content: [{ type: "text" as const, text: `${metadata} Cached visual interpretation may be reused from the current context. Force a fresh observation after any UI action, compaction, model switch, or uncertainty.` }], details: { tool_name: "visual_observe", success: true, ...visualTelemetry(decision), image_bytes: 0, model_fingerprint: request.model_fingerprint } };
		},
	}));

	pi.registerTool(defineTool({
		name: "visual_refine_target",
		label: "Refine visual target",
		description: "Use the optional local SAM adapter to refine a VLM-proposed point or box. The result is geometry evidence, never click authorization.",
		promptSnippet: "visual_refine_target(observation_id, exact_sha256, geometry, hint, purpose): refine an ambiguous visual target",
		parameters: Type.Object({
			observation_id: Type.String({ minLength: 64, maxLength: 64 }), exact_sha256: Type.String({ minLength: 64, maxLength: 64 }),
			geometry: Type.Object({ width: Type.Integer({ minimum: 1 }), height: Type.Integer({ minimum: 1 }), device_scale: Type.Number({ minimum: 0.1, maximum: 8 }) }),
			hint: Type.Union([Type.Object({ kind: Type.Literal("point"), x: Type.Number(), y: Type.Number() }), Type.Object({ kind: Type.Literal("box"), x: Type.Number(), y: Type.Number(), width: Type.Number({ exclusiveMinimum: 0 }), height: Type.Number({ exclusiveMinimum: 0 }) })]),
			purpose: Type.Union([Type.Literal("click"), Type.Literal("drag"), Type.Literal("crop"), Type.Literal("verify")]), expected_label: Type.Optional(Type.String({ maxLength: 300 })),
		}),
		async execute(_id, params, _signal, _update, _ctx) {
			if (!SAM_ENABLED || !options.samAdapter) return { content: [{ type: "text" as const, text: "Visual segmentation is unavailable: enable VISION_GROUNDING=sam with a local SAM adapter." }], details: { tool_name: "visual_refine_target", success: false, reason: "sam-unavailable" } };
			const observation = cache.find(params.observation_id);
			if (!observation || observation.exact_sha256 !== params.exact_sha256 || JSON.stringify(observation.geometry) !== JSON.stringify(params.geometry)) return { content: [{ type: "text" as const, text: "Visual segmentation refused: observation is not from the current visual cache or geometry. Capture a fresh image first." }], details: { tool_name: "visual_refine_target", success: false, reason: "observation-not-current" } };
			const result = await refineWithSam(options.samAdapter, params as { observation_id: string; exact_sha256: string; geometry: { width: number; height: number; device_scale: number }; hint: GroundingHint; purpose: "click" | "drag" | "crop" | "verify"; expected_label?: string });
			record("visual-observe", "grounding", { segmenter: result.segmenter, segmenter_version: result.segmenter_version, mask_digest: result.mask_digest, observation_id: result.observation_id, exact_sha256: result.exact_sha256 });
			return { content: [{ type: "text" as const, text: JSON.stringify({ ...result, click_safe: "requires fresh snapshot and independent target validation" }) }], details: { tool_name: "visual_refine_target", success: true, grounding_digest: result.mask_digest } };
		},
	}));
}

export default function (pi: ExtensionAPI): void { registerVisualTools(pi); }
