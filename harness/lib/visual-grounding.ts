import { createHash } from "node:crypto";

export const VISUAL_GROUNDING_SCHEMA = "pi.visual-grounding/v1" as const;

export type GroundingHint =
	| { kind: "point"; x: number; y: number }
	| { kind: "box"; x: number; y: number; width: number; height: number };

export type GroundingRequest = {
	observation_id: string;
	exact_sha256: string;
	geometry: { width: number; height: number; device_scale: number };
	hint: GroundingHint;
	purpose: "click" | "drag" | "crop" | "verify";
	expected_label?: string;
	/** Ephemeral bytes supplied only to an in-process/local segmenter. */
	image_bytes?: Uint8Array;
	signal?: AbortSignal;
};

export type GroundingResult = {
	schema: typeof VISUAL_GROUNDING_SCHEMA;
	observation_id: string;
	exact_sha256: string;
	prompt_digest: string;
	segmenter: string;
	segmenter_version: string;
	mask_digest: string;
	box: { x: number; y: number; width: number; height: number };
	safe_point: { x: number; y: number };
	model_score: number | null;
	click_safe: null;
};

export type SamAdapter = {
	name: string;
	version: string;
	refine(request: GroundingRequest): Promise<Omit<GroundingResult, "schema" | "observation_id" | "exact_sha256" | "prompt_digest" | "click_safe">>;
};

function promptDigest(request: GroundingRequest): string {
	return createHash("sha256").update(JSON.stringify({ hint: request.hint, purpose: request.purpose, expected_label: request.expected_label ?? null })).digest("hex");
}

function finite(value: number): boolean { return Number.isFinite(value); }

function boundedText(value: unknown, field: string): asserts value is string {
	if (typeof value !== "string" || value.length < 1 || value.length > 160) throw new Error(`invalid grounding ${field}`);
}

function digestText(value: unknown, field: string): asserts value is string {
	if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) throw new Error(`invalid grounding ${field}`);
}

function validateHint(hint: GroundingHint, width: number, height: number): void {
	if (hint.kind === "point") {
		if (!finite(hint.x) || !finite(hint.y) || hint.x < 0 || hint.y < 0 || hint.x >= width || hint.y >= height) throw new Error("grounding point is outside observation");
		return;
	}
	if (![hint.x, hint.y, hint.width, hint.height].every(finite) || hint.width <= 0 || hint.height <= 0 || hint.x < 0 || hint.y < 0 || hint.x + hint.width > width || hint.y + hint.height > height) throw new Error("grounding box is outside observation");
}

export function validateGroundingRequest(request: GroundingRequest): void {
	if (!/^[0-9a-f]{64}$/i.test(request.observation_id) || !/^[0-9a-f]{64}$/i.test(request.exact_sha256)) throw new Error("invalid grounding identity");
	const { width, height, device_scale } = request.geometry;
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || !finite(device_scale) || device_scale <= 0 || device_scale > 8) throw new Error("invalid grounding geometry");
	validateHint(request.hint, width, height);
	if (request.expected_label != null && (request.expected_label.length < 1 || request.expected_label.length > 300)) throw new Error("invalid grounding label");
}

/** A safe point must be inside the returned region, never on its boundary. */
export function validateGroundingResult(request: GroundingRequest, result: GroundingResult): void {
	validateGroundingRequest(request);
	if (result.schema !== VISUAL_GROUNDING_SCHEMA || result.observation_id !== request.observation_id || result.exact_sha256 !== request.exact_sha256 || result.prompt_digest !== promptDigest(request) || result.click_safe !== null) throw new Error("grounding result has invalid authority fields");
	boundedText(result.segmenter, "segmenter");
	boundedText(result.segmenter_version, "segmenter_version");
	digestText(result.mask_digest, "mask_digest");
	if (!result.box || !result.safe_point || typeof result.box !== "object" || typeof result.safe_point !== "object") throw new Error("grounding result geometry is missing");
	const { width, height } = request.geometry;
	if (!Number.isFinite(result.box.x) || !Number.isFinite(result.box.y) || !Number.isFinite(result.box.width) || !Number.isFinite(result.box.height) || result.box.width <= 0 || result.box.height <= 0 || result.box.x < 0 || result.box.y < 0 || result.box.x + result.box.width > width || result.box.y + result.box.height > height) throw new Error("grounding result box is outside observation");
	const insetX = Math.min(result.box.width / 4, 8);
	const insetY = Math.min(result.box.height / 4, 8);
	if (!(result.safe_point.x > result.box.x + insetX && result.safe_point.x < result.box.x + result.box.width - insetX && result.safe_point.y > result.box.y + insetY && result.safe_point.y < result.box.y + result.box.height - insetY)) throw new Error("grounding safe point is not interior");
	if (result.model_score != null && (!finite(result.model_score) || result.model_score < 0 || result.model_score > 1)) throw new Error("invalid grounding score");
}

export async function refineWithSam(adapter: SamAdapter, request: GroundingRequest): Promise<GroundingResult> {
	validateGroundingRequest(request);
	if (!adapter || typeof adapter.refine !== "function" || !adapter.name || !adapter.version) throw new Error("SAM adapter unavailable");
	const raw = await adapter.refine(request);
	if (raw.segmenter !== adapter.name || raw.segmenter_version !== adapter.version) throw new Error("grounding adapter identity mismatch");
	const result: GroundingResult = { schema: VISUAL_GROUNDING_SCHEMA, observation_id: request.observation_id, exact_sha256: request.exact_sha256, prompt_digest: promptDigest(request), ...raw, click_safe: null };
	validateGroundingResult(request, result);
	return result;
}

export function groundingDigest(result: GroundingResult): string {
	return createHash("sha256").update(JSON.stringify(result)).digest("hex");
}
