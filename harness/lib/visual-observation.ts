import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";

/**
 * Small, provider-neutral visual observation cache.
 *
 * The cache deliberately stores references and interpretations, never image
 * bytes. An exact digest proves identity; a perceptual match only permits
 * reusing an interpretation and never authorizes an action.
 */
export const VISUAL_OBSERVATION_SCHEMA = "pi.visual-observation/v1" as const;
export const VISUAL_CACHE_SCHEMA = "pi.visual-cache/v1" as const;

export type VisualSource = "image" | "screen" | "browser";
export type VisualCacheDecision = "fresh" | "exact_reuse" | "near_reuse" | "stale" | "forced";

export type VisualGeometry = {
	width: number;
	height: number;
	device_scale: number;
	viewport?: { x: number; y: number; width: number; height: number };
};

export type VisualObservationRequest = {
	session_id: string;
	source: VisualSource;
	source_id: string;
	geometry: VisualGeometry;
	exact_sha256: string;
	phash?: string | null;
	question: string;
	model_fingerprint: string;
	analysis_version: string;
	now?: number;
	ttl_ms?: number;
	force?: boolean;
};

export type VisualObservation = {
	schema: typeof VISUAL_OBSERVATION_SCHEMA;
	observation_id: string;
	session_id: string;
	source: VisualSource;
	source_id: string;
	geometry: VisualGeometry;
	exact_sha256: string;
	phash: string | null;
	question: string;
	model_fingerprint: string;
	analysis_version: string;
	created_at: number;
	last_used_at: number;
	interpretation?: string;
	interpretation_digest?: string;
};

export type VisualObservationDecision = {
	decision: VisualCacheDecision;
	observation: VisualObservation | null;
	matched_observation_id: string | null;
	phash_distance: number | null;
	cache_key: string;
};

function assertText(value: string, field: string): void {
	if (typeof value !== "string" || value.length === 0 || value.length > 512) throw new Error(`invalid visual ${field}`);
}

function assertGeometry(geometry: VisualGeometry): void {
	if (!Number.isSafeInteger(geometry.width) || geometry.width < 1 || geometry.width > 32_000 ||
		!Number.isSafeInteger(geometry.height) || geometry.height < 1 || geometry.height > 32_000 ||
		!Number.isFinite(geometry.device_scale) || geometry.device_scale <= 0 || geometry.device_scale > 8) {
		throw new Error("invalid visual geometry");
	}
	const box = geometry.viewport;
	if (box && (!Number.isSafeInteger(box.x) || !Number.isSafeInteger(box.y) || box.x < 0 || box.y < 0 ||
		!Number.isSafeInteger(box.width) || !Number.isSafeInteger(box.height) || box.width < 1 || box.height < 1)) {
		throw new Error("invalid visual viewport");
	}
}

function digest(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function cacheKey(request: VisualObservationRequest): string {
	return digest({ session: request.session_id, source: request.source, source_id: request.source_id, geometry: request.geometry });
}

function hexBits(value: string): bigint | null {
	return /^[0-9a-f]{16}$/i.test(value) ? BigInt(`0x${value}`) : null;
}

export function hammingDistance(a: string | null | undefined, b: string | null | undefined): number | null {
	const left = a == null ? null : hexBits(a);
	const right = b == null ? null : hexBits(b);
	if (left == null || right == null) return null;
	let bits = left ^ right;
	let count = 0;
	while (bits) { bits &= bits - 1n; count += 1; }
	return count;
}

/**
 * Compute a 64-bit DCT perceptual hash from an 8-bit luma raster. Keeping this
 * decoder-free makes the cache usable on Node and lets capture adapters choose
 * their image decoder. The hash is a similarity hint, never an integrity hash.
 */
export function perceptualHash(luma: Uint8Array, width: number, height: number): string {
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || luma.length !== width * height) throw new Error("invalid luma raster");
	const n = 32;
	const small = new Float64Array(n * n);
	for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) {
		const sx = Math.min(width - 1, Math.floor((x + 0.5) * width / n));
		const sy = Math.min(height - 1, Math.floor((y + 0.5) * height / n));
		small[y * n + x] = luma[sy * width + sx];
	}
	const coefficients: number[] = [];
	const scale = Math.PI / (2 * n);
	for (let v = 0; v < 8; v += 1) for (let u = 0; u < 8; u += 1) {
		let sum = 0;
		for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) sum += small[y * n + x] * Math.cos((2 * x + 1) * u * scale) * Math.cos((2 * y + 1) * v * scale);
		coefficients.push(sum * (u === 0 ? 1 / Math.sqrt(2) : 1) * (v === 0 ? 1 / Math.sqrt(2) : 1));
	}
	const body = coefficients.slice(1).sort((a, b) => a - b);
	const median = body[Math.floor(body.length / 2)] ?? 0;
	let result = 0n;
	for (let i = 0; i < 64; i += 1) if (coefficients[i] >= median) result |= 1n << BigInt(63 - i);
	return result.toString(16).padStart(16, "0");
}

export function imageDigest(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

type DecodedPng = { pixels: Uint8Array; channels: 3 | 4; width: number; height: number };

/** Decode the common 8-bit, non-interlaced PNG forms without a native image dependency. */
function decodePng(bytes: Uint8Array): DecodedPng | null {
	const MAX_PIXELS = 16_000_000;
	const signature = "89504e470d0a1a0a";
	if (bytes.length < 33 || Buffer.from(bytes.subarray(0, 8)).toString("hex") !== signature) return null;
	let width = 0; let height = 0; let channels = 0; let interlace = 0; const idat: Uint8Array[] = [];
	for (let offset = 8; offset + 12 <= bytes.length;) {
		const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
		if (length > bytes.length - offset - 12) return null;
		const kind = Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString("ascii");
		const chunk = bytes.subarray(offset + 8, offset + 8 + length);
		if (kind === "IHDR" && length >= 13) {
			const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
			width = view.getUint32(0); height = view.getUint32(4);
			if (view.getUint8(8) !== 8 || view.getUint8(10) !== 0 || view.getUint8(12) !== 0) return null;
			const color = view.getUint8(9); channels = color === 2 ? 3 : color === 6 ? 4 : 0; interlace = view.getUint8(12);
		} else if (kind === "IDAT") idat.push(chunk);
		offset += 12 + length;
		if (kind === "IEND") break;
	}
	if (!width || !height || !channels || interlace !== 0 || !idat.length) return null;
	const stride = width * channels; const expected = height * (stride + 1);
	if (width > 32_000 || height > 32_000 || !Number.isSafeInteger(width * height) || width * height > MAX_PIXELS || !Number.isSafeInteger(expected)) return null;
	let raw: Buffer;
	try { raw = inflateSync(Buffer.concat(idat.map((chunk) => Buffer.from(chunk))), { maxOutputLength: expected }); } catch { return null; }
	if (raw.length !== expected) return null;
	const pixels = new Uint8Array(width * height * channels); let source = 0;
	for (let y = 0; y < height; y += 1) {
		const filter = raw[source++]; const row = y * stride; const prior = row - stride;
		if (filter > 4) return null;
		for (let x = 0; x < stride; x += 1) {
			const left = x >= channels ? pixels[row + x - channels] : 0;
			const up = y ? pixels[prior + x] : 0;
			const upLeft = y && x >= channels ? pixels[prior + x - channels] : 0;
			const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : (() => { const p = left + up - upLeft; const pa = Math.abs(p - left); const pb = Math.abs(p - up); const pc = Math.abs(p - upLeft); return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft; })();
			pixels[row + x] = (raw[source++] + predictor) & 0xff;
		}
	}
	return { pixels, channels: channels as 3 | 4, width, height };
}

export function pngLuma(bytes: Uint8Array): { luma: Uint8Array; width: number; height: number } | null {
	const decoded = decodePng(bytes);
	if (!decoded) return null;
	const luma = new Uint8Array(decoded.width * decoded.height);
	for (let i = 0, p = 0; i < luma.length; i += 1, p += decoded.channels) luma[i] = Math.round(0.2126 * decoded.pixels[p] + 0.7152 * decoded.pixels[p + 1] + 0.0722 * decoded.pixels[p + 2]);
	return { luma, width: decoded.width, height: decoded.height };
}

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(kind: string, payload: Uint8Array): Uint8Array {
	const kindBytes = new TextEncoder().encode(kind);
	const out = new Uint8Array(12 + payload.length);
	new DataView(out.buffer).setUint32(0, payload.length);
	out.set(kindBytes, 4); out.set(payload, 8);
	const checksum = new Uint8Array(kindBytes.length + payload.length);
	checksum.set(kindBytes); checksum.set(payload, kindBytes.length);
	new DataView(out.buffer).setUint32(8 + payload.length, crc32(checksum));
	return out;
}

/** Crop an 8-bit RGB/RGBA PNG while preserving color and alpha. */
export function cropPng(bytes: Uint8Array, crop: { x: number; y: number; width: number; height: number }): Uint8Array | null {
	const decoded = decodePng(bytes);
	if (!decoded || !Number.isSafeInteger(crop.x) || !Number.isSafeInteger(crop.y) || !Number.isSafeInteger(crop.width) || !Number.isSafeInteger(crop.height) || crop.x < 0 || crop.y < 0 || crop.width < 1 || crop.height < 1 || crop.x + crop.width > decoded.width || crop.y + crop.height > decoded.height) return null;
	const stride = crop.width * decoded.channels;
	const raw = new Uint8Array(crop.height * (stride + 1));
	for (let y = 0; y < crop.height; y += 1) {
		raw[y * (stride + 1)] = 0;
		raw.set(decoded.pixels.subarray((crop.y + y) * decoded.width * decoded.channels + crop.x * decoded.channels, (crop.y + y) * decoded.width * decoded.channels + (crop.x + crop.width) * decoded.channels), y * (stride + 1) + 1);
	}
	const ihdr = new Uint8Array(13); const view = new DataView(ihdr.buffer);
	view.setUint32(0, crop.width); view.setUint32(4, crop.height); ihdr[8] = 8; ihdr[9] = decoded.channels === 4 ? 6 : 2;
	const compressed = deflateSync(raw);
	const chunks = [pngChunk("IHDR", ihdr), pngChunk("IDAT", compressed), pngChunk("IEND", new Uint8Array())];
	const output = new Uint8Array(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0)); output.set(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
	let offset = 8; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
	return output;
}

export class VisualObservationCache {
	private readonly entries = new Map<string, VisualObservation>();
	private readonly maxEntries: number;
	private readonly nearDistance: number;
	constructor(maxEntries = 128, nearDistance = 8) {
		this.maxEntries = maxEntries;
		this.nearDistance = nearDistance;
		if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 10_000) throw new Error("invalid visual cache size");
	}

	decide(request: VisualObservationRequest): VisualObservationDecision {
		assertText(request.session_id, "session_id"); assertText(request.source_id, "source_id"); assertText(request.question, "question");
		assertText(request.model_fingerprint, "model_fingerprint"); assertText(request.analysis_version, "analysis_version");
		if (!/^[0-9a-f]{64}$/i.test(request.exact_sha256)) throw new Error("invalid visual exact_sha256");
		if (request.phash != null && hexBits(request.phash) == null) throw new Error("invalid visual phash");
		assertGeometry(request.geometry);
		const now = request.now ?? Date.now();
		const ttl = request.ttl_ms ?? 30_000;
		if (!Number.isFinite(now) || !Number.isFinite(ttl) || ttl < 0 || ttl > 86_400_000) throw new Error("invalid visual cache clock");
		const key = cacheKey(request);
		const candidates = [...this.entries.values()].filter((entry) => digest({ session: entry.session_id, source: entry.source, source_id: entry.source_id, geometry: entry.geometry }) === key && entry.question === request.question && entry.model_fingerprint === request.model_fingerprint && entry.analysis_version === request.analysis_version);
		const exact = candidates.find((entry) => entry.exact_sha256 === request.exact_sha256);
		if (exact && now - exact.created_at <= ttl && !request.force) { exact.last_used_at = now; return { decision: "exact_reuse", observation: exact, matched_observation_id: exact.observation_id, phash_distance: 0, cache_key: key }; }
		const near = !request.force && request.phash ? candidates.map((entry) => ({ entry, distance: hammingDistance(entry.phash, request.phash) })).filter((item): item is { entry: VisualObservation; distance: number } => item.distance != null && item.distance <= this.nearDistance && now - item.entry.created_at <= ttl).sort((a, b) => a.distance - b.distance)[0] : undefined;
		if (near) { near.entry.last_used_at = now; return { decision: "near_reuse", observation: near.entry, matched_observation_id: near.entry.observation_id, phash_distance: near.distance, cache_key: key }; }
		return { decision: request.force ? "forced" : candidates.length ? "stale" : "fresh", observation: null, matched_observation_id: null, phash_distance: null, cache_key: key };
	}

	put(request: VisualObservationRequest, interpretation?: string): VisualObservation {
		const now = request.now ?? Date.now();
		const id = digest({ schema: VISUAL_OBSERVATION_SCHEMA, session: request.session_id, source: request.source, source_id: request.source_id, geometry: request.geometry, exact: request.exact_sha256, question: request.question, model: request.model_fingerprint, version: request.analysis_version });
		const entry: VisualObservation = { schema: VISUAL_OBSERVATION_SCHEMA, observation_id: id, session_id: request.session_id, source: request.source, source_id: request.source_id, geometry: request.geometry, exact_sha256: request.exact_sha256, phash: request.phash ?? null, question: request.question, model_fingerprint: request.model_fingerprint, analysis_version: request.analysis_version, created_at: now, last_used_at: now, ...(interpretation === undefined ? {} : { interpretation, interpretation_digest: digest(interpretation) }) };
		this.entries.delete(cacheKey(request));
		this.entries.set(cacheKey(request), entry);
		while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
		return entry;
	}

	clear(): void { this.entries.clear(); }

	find(observationId: string): VisualObservation | null {
		const entry = [...this.entries.values()].find((candidate) => candidate.observation_id === observationId);
		return entry ?? null;
	}
}

export function visualTelemetry(decision: VisualObservationDecision): Record<string, unknown> {
	// `schema` is a reserved Pi telemetry envelope key. The cache schema is
	// versioned at the module boundary; the emitted row carries only the bounded
	// decision fields, while the normal telemetry envelope supplies its own schema.
	return { decision: decision.decision, matched_observation: decision.matched_observation_id, phash_distance: decision.phash_distance, cache_key: decision.cache_key };
}
