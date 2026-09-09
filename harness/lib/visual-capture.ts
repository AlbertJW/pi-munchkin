import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cropPng, pngLuma } from "./visual-observation.ts";

/** Versioned boundary for local capture adapters.  The adapter owns the
 * platform-specific capture mechanism; the visual tool owns identity,
 * admission, caching, and action safety. */
export const VISUAL_CAPTURE_SCHEMA = "pi.visual-capture/v1" as const;
export const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
export const MAX_CAPTURE_PIXELS = 16_000_000;

export type CaptureCrop = { x: number; y: number; width: number; height: number };
export type LocalVisualCapture = {
	bytes: Uint8Array;
	mime: "image/png";
	width: number;
	height: number;
	device_scale: number;
	viewport?: CaptureCrop;
	captured_at: number;
};

export type LocalCaptureOptions = {
	/** Test seam or a pinned executable supplied by a trusted installation. */
	command?: string;
	timeout_ms?: number;
	max_bytes?: number;
	device_scale?: number;
	temp_parent?: string;
};

export class VisualCaptureError extends Error {
	readonly reason: "unsupported" | "invalid-target" | "cancelled" | "failed" | "oversize";
	constructor(reason: VisualCaptureError["reason"], message: string) {
		super(message);
		this.name = "VisualCaptureError";
		this.reason = reason;
	}
}

function validCrop(crop: CaptureCrop | undefined, width: number, height: number): void {
	if (!crop) return;
	if (![crop.x, crop.y, crop.width, crop.height].every(Number.isSafeInteger) || crop.x < 0 || crop.y < 0 || crop.width < 1 || crop.height < 1 || crop.x + crop.width > width || crop.y + crop.height > height) {
		throw new VisualCaptureError("invalid-target", "visual capture crop is outside the captured window");
	}
}

function windowId(sourceId: string): string {
	// A numeric CGWindowID is the only target accepted by the default adapter.
	// This prevents shell syntax, arbitrary paths, and accidental full-desktop
	// captures from entering a command invocation.
	if (!/^\d{1,12}$/.test(sourceId) || Number(sourceId) < 1) throw new VisualCaptureError("invalid-target", "screen capture requires a numeric window id");
	return sourceId;
}

function abortError(signal?: AbortSignal): VisualCaptureError {
	return new VisualCaptureError("cancelled", signal?.reason instanceof Error ? "visual capture cancelled" : "visual capture cancelled");
}

async function runCapture(command: string, args: string[], cwd: string, timeout: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) throw abortError(signal);
	const child = execFile(command, args, { cwd, timeout, windowsHide: true, maxBuffer: 64 * 1024 }, () => undefined);
	const abort = () => child.kill("SIGTERM");
	signal?.addEventListener("abort", abort, { once: true });
	try {
		await new Promise<void>((resolve, reject) => {
			child.once("error", reject);
			child.once("exit", (code, sig) => {
				if (signal?.aborted) reject(abortError(signal));
				else if (code !== 0 || sig) reject(new VisualCaptureError("failed", "local screen capture did not complete"));
				else resolve();
			});
		});
	} catch (error) {
		if (error instanceof VisualCaptureError) throw error;
		throw new VisualCaptureError("failed", "local screen capture is unavailable");
	} finally {
		signal?.removeEventListener("abort", abort);
		child.removeAllListeners();
	}
}

/**
 * Capture one macOS window with `/usr/sbin/screencapture`.  It is deliberately
 * screen-only and numeric-window-only; browser captures should be supplied by
 * a browser adapter that can attest the tab identity.  No stderr, path, or
 * screenshot bytes are included in errors or telemetry.
 */
export function createMacScreenCapture(options: LocalCaptureOptions = {}) {
	const command = options.command ?? "/usr/sbin/screencapture";
	const timeout = Number.isSafeInteger(options.timeout_ms) && options.timeout_ms! > 0 ? options.timeout_ms! : 10_000;
	const maxBytes = Number.isSafeInteger(options.max_bytes) && options.max_bytes! > 0 && options.max_bytes! <= MAX_CAPTURE_BYTES ? options.max_bytes! : MAX_CAPTURE_BYTES;
	const scale = Number.isFinite(options.device_scale) && options.device_scale! > 0 && options.device_scale! <= 8 ? options.device_scale! : 2;
	return async (source: "screen" | "browser", sourceId: string, crop?: CaptureCrop, signal?: AbortSignal): Promise<LocalVisualCapture> => {
		if (source !== "screen") throw new VisualCaptureError("unsupported", "the local macOS adapter only captures screen windows");
		if (process.platform !== "darwin") throw new VisualCaptureError("unsupported", "local screen capture is available only on macOS");
		const id = windowId(sourceId);
		if (signal?.aborted) throw abortError(signal);
		let directory: string;
		try { directory = await mkdtemp(join(options.temp_parent ?? tmpdir(), "pi-visual-capture-")); }
		catch { throw new VisualCaptureError("failed", "local screen capture could not allocate a private workspace"); }
		const target = join(directory, "window.png");
		try {
			await runCapture(command, ["-x", "-t", "png", "-l", id, target], directory, timeout, signal);
			const info = await stat(target);
			if (!Number.isSafeInteger(info.size) || info.size < 1 || info.size > maxBytes) throw new VisualCaptureError("oversize", "local screen capture exceeded its byte budget");
			let bytes = new Uint8Array(await readFile(target));
			if (bytes.byteLength > maxBytes) throw new VisualCaptureError("oversize", "local screen capture exceeded its byte budget");
			const decoded = pngLuma(bytes);
			if (!decoded || decoded.width * decoded.height > MAX_CAPTURE_PIXELS) throw new VisualCaptureError("failed", "local screen capture produced an invalid image");
			validCrop(crop, decoded.width, decoded.height);
			if (crop) {
				const cropped = cropPng(bytes, crop);
				if (!cropped) throw new VisualCaptureError("failed", "local screen capture crop could not be materialized");
				bytes = new Uint8Array(cropped);
			}
			const finalSize = crop ? { width: crop.width, height: crop.height } : { width: decoded.width, height: decoded.height };
			return { bytes, mime: "image/png", ...finalSize, device_scale: scale, ...(crop ? { viewport: crop } : {}), captured_at: Date.now() };
		} catch (error) {
			if (error instanceof VisualCaptureError) throw error;
			throw new VisualCaptureError("failed", "local screen capture is unavailable");
		} finally {
			await rm(directory, { recursive: true, force: true }).catch(() => undefined);
		}
	};
}

/** Keep an adapter contract honest in tests and integrations without exposing
 * the temporary capture path or bytes. */
export function validateLocalCapture(capture: unknown): asserts capture is LocalVisualCapture {
	if (!capture || typeof capture !== "object") throw new VisualCaptureError("failed", "visual capture has invalid metadata");
	const value = capture as Partial<LocalVisualCapture>;
	const width = value.width; const height = value.height; const scale = value.device_scale;
	if (!(value.bytes instanceof Uint8Array) || value.mime !== "image/png" || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || (width as number) < 1 || (height as number) < 1 || (width as number) > 32_000 || (height as number) > 32_000 || (width as number) * (height as number) > MAX_CAPTURE_PIXELS || !Number.isFinite(scale) || scale! <= 0 || scale! > 8 || !Number.isFinite(value.captured_at)) throw new VisualCaptureError("failed", "visual capture has invalid metadata");
	if (value.bytes.byteLength < 1 || value.bytes.byteLength > MAX_CAPTURE_BYTES) throw new VisualCaptureError("oversize", "visual capture exceeded its byte budget");
}
