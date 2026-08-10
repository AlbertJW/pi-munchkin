import type { EventBus } from "@earendil-works/pi-coding-agent";
import { validateRunStateSnapshot } from "./run-kernel-state.ts";
import type { RunStateV1 } from "./run-kernel-types.ts";

export const RUN_STATE_SNAPSHOT_CHANNEL = "pi-munchkin/run-state-snapshot/v1";

export type RunStateSnapshotEventV1 = {
	v: 1;
	reason: "update" | "phase";
	sequence: number;
	state: RunStateV1;
};

export function isRunStateSnapshotEvent(value: unknown): value is RunStateSnapshotEventV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const item = value as Record<string, unknown>;
	const keys = Object.keys(item);
	return keys.length === 4 && keys.every((key) => ["v", "reason", "sequence", "state"].includes(key)) &&
		item.v === 1 && ["update", "phase"].includes(String(item.reason)) &&
		Number.isSafeInteger(item.sequence) && Number(item.sequence) >= 0 &&
		validateRunStateSnapshot(item.state).length === 0;
}

export function emitRunStateSnapshot(bus: EventBus, event: RunStateSnapshotEventV1): void {
	if (isRunStateSnapshotEvent(event)) bus.emit(RUN_STATE_SNAPSHOT_CHANNEL, event);
}

export function onRunStateSnapshot(
	bus: EventBus,
	handler: (event: RunStateSnapshotEventV1) => void | Promise<void>,
): () => void {
	return bus.on(RUN_STATE_SNAPSHOT_CHANNEL, (value) => {
		if (!isRunStateSnapshotEvent(value)) return;
		return handler(value);
	});
}
