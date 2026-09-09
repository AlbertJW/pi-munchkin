import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { GroundingRequest, GroundingResult, SamAdapter } from "./visual-grounding.ts";

/** JSON-lines boundary for a separately installed SAM 2.1 Tiny runner. */
export const SAM2_TINY_PROTOCOL = "pi.sam2.1-tiny/v1" as const;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;

export type Sam2TinyOptions = {
	command: string;
	args?: string[];
	version?: string;
	timeout_ms?: number;
	max_output_bytes?: number;
};

export class Sam2TinyError extends Error {
	readonly reason: "unavailable" | "cancelled" | "failed" | "invalid";
	constructor(reason: Sam2TinyError["reason"], message: string) {
		super(message);
		this.name = "Sam2TinyError";
		this.reason = reason;
	}
}

type RunnerResponse = {
	segmenter?: unknown;
	segmenter_version?: unknown;
	mask_digest?: unknown;
	box?: unknown;
	safe_point?: unknown;
	model_score?: unknown;
};

function digest(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

function safeResponse(value: unknown): RunnerResponse {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Sam2TinyError("invalid", "SAM runner returned an invalid response");
	return value as RunnerResponse;
}

function invoke(command: string, args: string[], input: string, timeoutMs: number, maxOutput: number, signal?: AbortSignal): Promise<string> {
	if (signal?.aborted) return Promise.reject(new Sam2TinyError("cancelled", "SAM refinement cancelled"));
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { shell: false, stdio: ["pipe", "pipe", "ignore"] });
		let output = "";
		let settled = false;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			if (error) reject(error); else resolve(output);
		};
		const abort = () => { child.kill("SIGTERM"); finish(new Sam2TinyError("cancelled", "SAM refinement cancelled")); };
		const timer = setTimeout(() => { child.kill("SIGTERM"); finish(new Sam2TinyError("failed", "SAM refinement exceeded its time limit")); }, timeoutMs);
		signal?.addEventListener("abort", abort, { once: true });
		child.on("error", () => finish(new Sam2TinyError("unavailable", "SAM 2.1 Tiny runner is unavailable")));
		child.stdout.on("data", (chunk: Buffer) => {
			if (settled) return;
			output += chunk.toString("utf8");
			if (Buffer.byteLength(output, "utf8") > maxOutput) {
				child.kill("SIGTERM");
				finish(new Sam2TinyError("failed", "SAM runner response exceeded its byte limit"));
			}
		});
		child.on("close", (code) => {
			if (settled) return;
			if (code !== 0) finish(new Sam2TinyError("failed", "SAM refinement did not complete"));
			else finish();
		});
		child.stdin.on("error", () => finish(new Sam2TinyError("failed", "SAM refinement input failed")));
		child.stdin.end(input);
	});
}

/**
 * Create a provider-neutral local SAM adapter. The executable is supplied by
 * the installation (typically a small Python SAM 2.1 Tiny service); this
 * module never downloads weights or starts a model implicitly. The runner
 * receives one bounded base64 image and must return geometry evidence only.
 */
export function createSam2TinyAdapter(options: Sam2TinyOptions): SamAdapter {
	if (!options || typeof options.command !== "string" || options.command.length < 1 || options.command.length > 512) throw new Error("SAM runner command is required");
	const version = options.version ?? "2.1-tiny";
	const timeout = Number.isSafeInteger(options.timeout_ms) && options.timeout_ms! > 0 ? options.timeout_ms! : 8_000;
	const maxOutput = Number.isSafeInteger(options.max_output_bytes) && options.max_output_bytes! > 0 && options.max_output_bytes! <= MAX_OUTPUT_BYTES ? options.max_output_bytes! : MAX_OUTPUT_BYTES;
	return {
		name: "sam2.1-tiny",
		version,
		async refine(request: GroundingRequest) {
			const bytes = request.image_bytes;
			if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_IMAGE_BYTES) throw new Sam2TinyError("invalid", "SAM refinement image is missing or oversized");
			if (digest(bytes) !== request.exact_sha256) throw new Sam2TinyError("invalid", "SAM refinement image digest does not match the observation");
			const input = JSON.stringify({ protocol: SAM2_TINY_PROTOCOL, image_base64: Buffer.from(bytes).toString("base64"), exact_sha256: request.exact_sha256, geometry: request.geometry, hint: request.hint, purpose: request.purpose, expected_label: request.expected_label ?? null }) + "\n";
			const raw = await invoke(options.command, options.args ?? [], input, timeout, maxOutput, request.signal);
			let parsed: unknown;
			try { parsed = JSON.parse(raw); } catch { throw new Sam2TinyError("invalid", "SAM runner returned malformed JSON"); }
			const result = safeResponse(parsed);
			if (typeof result.segmenter !== "string" || typeof result.segmenter_version !== "string" || typeof result.mask_digest !== "string" || !result.box || !result.safe_point) throw new Sam2TinyError("invalid", "SAM runner omitted required grounding fields");
			return result as Omit<GroundingResult, "schema" | "observation_id" | "exact_sha256" | "prompt_digest" | "click_safe">;
		},
	};
}
