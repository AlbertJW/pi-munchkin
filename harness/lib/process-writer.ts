import { randomUUID } from "node:crypto";

const WRITER_MARKER_KEY = "__pi_plan_runner_process_writer_v1";

/** Stable across extension reloads in one Pi process; fresh in a new OS process. */
export function processWriterMarker(): string {
	const shared = globalThis as Record<string, unknown>;
	const existing = shared[WRITER_MARKER_KEY];
	if (typeof existing === "string" && existing.length > 0) return existing;
	const marker = randomUUID();
	shared[WRITER_MARKER_KEY] = marker;
	return marker;
}
