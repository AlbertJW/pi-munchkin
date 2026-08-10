import { createHash } from "node:crypto";
import { classifyBashCommand, looksFailingOutput } from "./command-policy.ts";

export type FailureClass =
	| "schema_validation"
	| "policy_rejection"
	| "permission"
	| "not_found"
	| "command_missing"
	| "timeout"
	| "provider"
	| "verification_assertion"
	| "compile_or_lint"
	| "edit_conflict"
	| "unknown";

export type RecoveryKind = "tool_success" | "exact_gate" | "provider_first_token" | "manual_resume";
export type EpisodeStatus = "active" | "recovered" | "settled";

export type FailureObservation = {
	toolName: string;
	args: Record<string, unknown>;
	text: string;
	isError: boolean;
	planItemId?: string | null;
	failureClass?: FailureClass;
};

export type SuccessObservation = {
	toolName: string;
	args: Record<string, unknown>;
	verifiedExact?: boolean;
};

export type ToolCallObservation = {
	toolName: string;
	args: Record<string, unknown>;
	planItemId?: string | null;
};

export type FailureEpisode = {
	id: string;
	key: string;
	failureClass: FailureClass;
	toolFamily: string;
	targetHash: string;
	planItemHash: string;
	count: number;
	callsAfterSecond: number;
	correlatedCallsAfterSecond: number;
	strategyHashes: string[];
	openedAt: string;
	updatedAt: string;
	status: EpisodeStatus;
	recovery: RecoveryKind | null;
};

export type FailureEpisodeSnapshot = {
	v: 2;
	totalEpisodes: number;
	totalFailures: number;
	longestEpisode: number;
	semanticFailureOverrun: number;
	correlatedFailureOverrun: number;
	settledWithoutRecovery: number;
	active: FailureEpisode[];
	completed: FailureEpisode[];
};

const MAX_COMPLETED = 64;
const MAX_STRATEGIES = 16;
const MAX_ARGUMENT_KEYS = 32;
const MAX_ARGUMENT_STRING = 4096;
const MAX_ARGUMENT_ARRAY = 32;
const MAX_ARGUMENT_DEPTH = 3;

export function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	return `{${Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

function boundedValue(value: unknown, depth: number): unknown {
	if (typeof value === "string") return value.slice(0, MAX_ARGUMENT_STRING);
	if (value === null || typeof value !== "object") return value;
	if (depth >= MAX_ARGUMENT_DEPTH) return "[bounded]";
	if (Array.isArray(value)) {
		return value.slice(0, MAX_ARGUMENT_ARRAY).map((entry) => boundedValue(entry, depth + 1));
	}
	return Object.fromEntries(Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.slice(0, MAX_ARGUMENT_KEYS)
		.map(([key, entry]) => [key.slice(0, 128), boundedValue(entry, depth + 1)]));
}

export function boundedArguments(args: Record<string, unknown>): Record<string, unknown> {
	return boundedValue(args, 0) as Record<string, unknown>;
}

function safeAtom(value: string): string {
	const cleaned = value.replace(/^.*[\\/]/, "").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 32);
	return cleaned || "unknown";
}

function bashHead(command: string): string {
	const segment = command.trim().split(/(?:&&|\|\||[;|\n])/u, 1)[0] ?? "";
	const tokens = segment.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
	while (tokens[0] && /^(?:sudo|env|command|timeout)$/i.test(tokens[0])) tokens.shift();
	while (tokens[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens.shift();
	return safeAtom(tokens[0] ?? "command").toLowerCase();
}

export function toolFamily(toolName: string, args: Record<string, unknown>): string {
	if (toolName === "bash") {
		const command = String(args.command ?? "");
		return classifyBashCommand(command).verifyLike ? "bash:verify" : `bash:${bashHead(command)}`;
	}
	if (toolName === "plan_write" || toolName === "plan_go") return "plan";
	if (toolName === "edit" || toolName === "write" || toolName === "multiedit") return "file_mutation";
	return safeAtom(toolName).toLowerCase();
}

export function targetHash(toolName: string, args: Record<string, unknown>): string {
	const family = toolFamily(toolName, args);
	if (family === "bash:verify") return sha256("verification-target");
	if (family === "plan") return sha256("plan-target");
	const path = typeof args.path === "string" ? args.path :
		typeof args.file === "string" ? args.file :
		typeof args.file_path === "string" ? args.file_path : null;
	// Hash the complete target path so equal basenames in different directories
	// cannot collapse into one episode. Only the digest is retained or emitted.
	// (The replaceAll normalizes doubled backslashes — JSON-escaped Windows input —
	// not single ones; on this POSIX-only deployment that is the whole population.)
	if (path) return sha256(`path:${path.trim().replaceAll("\\\\", "/")}`);
	if (toolName === "subagent" && typeof args.agent === "string") return sha256(`agent:${safeAtom(args.agent)}`);
	return sha256(`family:${family}`);
}

export function strategyHash(toolName: string, args: Record<string, unknown>): string {
	return sha256(`${toolName}\0${canonical(args)}`);
}

export function planItemHash(planItemId: string | null | undefined): string {
	return sha256(planItemId ? `plan-item:${planItemId}` : "plan-item:none");
}

export function episodeKey(parts: {
	failureClass: FailureClass;
	toolFamily: string;
	targetHash: string;
	planItemHash: string;
}): string {
	return sha256(`${parts.failureClass}\0${parts.toolFamily}\0${parts.targetHash}\0${parts.planItemHash}`);
}

export function boundedResultText(result: unknown, maxChars = 2048): string {
	const content = (result as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content ?? [];
	return content.filter((part) => part.type === "text").map((part) => part.text ?? "").join(" ").slice(0, maxChars);
}

export function isFailureObservation(observation: FailureObservation): boolean {
	if (observation.isError) return true;
	if (observation.toolName !== "bash") return false;
	const command = String(observation.args.command ?? "");
	return classifyBashCommand(command).verifyLike && looksFailingOutput(observation.text, false);
}

export function classifyFailure(observation: FailureObservation): FailureClass {
	if (observation.failureClass) return observation.failureClass;
	const text = observation.text.slice(0, 2048);
	const command = observation.toolName === "bash" ? String(observation.args.command ?? "") : "";
	const verifyLike = observation.toolName === "bash" && classifyBashCommand(command).verifyLike;
	if (observation.toolName === "research_note") {
		if (/^Citation verification failed:/i.test(text)) return "verification_assertion";
		if (/^Research ledger capacity reached/i.test(text)) return "policy_rejection";
	}

	if (/tool.?call|schema|validation|invalid (?:argument|input|parameter)|required (?:property|field)|expected (?:an? )?(?:array|object|string)|unknown dependenc/i.test(text)) {
		return "schema_validation";
	}
	if (/failure_class=(?:plan_mode_violation|policy_rejection)|blocked by|policy (?:block|reject)|not allowed|denied by (?:guard|policy)/i.test(text)) {
		return "policy_rejection";
	}
	if (/permission denied|operation not permitted|\bEACCES\b|\bEPERM\b/i.test(text)) return "permission";
	if (/timed? ?out|timeout|deadline exceeded/i.test(text)) return "timeout";
	// `ketch upstream` = a search/scrape backend failed (the web analogue of a
	// provider outage); `ketch is unavailable` = the binary is missing/unhealthy,
	// which is a missing command. Before 2026-08-05 both fell through to
	// `unknown`, so web failures never joined the failure-episode instrument.
	if (/provider|rate limit|\bHTTP\s+(?:4\d\d|5\d\d)\b|service unavailable|bad gateway|ketch upstream/i.test(text)) return "provider";
	if (/ketch is unavailable/i.test(text)) return "command_missing";
	if (/old (?:text|string).*not found|no exact match|ambiguous match|patch (?:failed|conflict)|edit conflict|has changed since/i.test(text)) {
		return "edit_conflict";
	}
	if (/command not found|not recognized as (?:an internal|a command)|spawn\s+\S+\s+ENOENT/i.test(text)) return "command_missing";
	if (/no such file|\bENOENT\b|cannot find (?:the )?(?:file|path)|path does not exist/i.test(text)) return "not_found";
	if (verifyLike && /\berror TS\d+\b|syntax error|typecheck|lint(?:er|ing)?|eslint|ruff|compil(?:e|ation)/i.test(text)) {
		return "compile_or_lint";
	}
	if (verifyLike && /assert(?:ion)?|expected|actual|\bfail(?:ed|ing|ure)?\b|tests? failed/i.test(text)) {
		return "verification_assertion";
	}
	if (verifyLike) return "verification_assertion";
	return "unknown";
}

function cloneEpisode(episode: FailureEpisode): FailureEpisode {
	return { ...episode, strategyHashes: [...episode.strategyHashes] };
}

export class FailureEpisodeTracker {
	private active = new Map<string, FailureEpisode>();
	private exposed = new Set<string>();
	private completed: FailureEpisode[] = [];
	private totalEpisodes = 0;
	private totalFailures = 0;
	private longestEpisode = 0;
	private semanticFailureOverrun = 0;
	private correlatedFailureOverrun = 0;
	private settledWithoutRecovery = 0;

	reset(): void {
		this.active.clear();
		this.exposed.clear();
		this.completed = [];
		this.totalEpisodes = 0;
		this.totalFailures = 0;
		this.longestEpisode = 0;
		this.semanticFailureOverrun = 0;
		this.correlatedFailureOverrun = 0;
		this.settledWithoutRecovery = 0;
	}

	noteToolCall(observation: ToolCallObservation): void {
		// The normal path has no exposed episode. Return before inspecting args,
		// hashing a target, or allocating a filtered episode array.
		if (this.exposed.size === 0) return;
		this.semanticFailureOverrun += 1;
		const args = boundedArguments(observation.args);
		const family = toolFamily(observation.toolName, args);
		const target = targetHash(observation.toolName, args);
		const item = planItemHash(observation.planItemId);
		let correlated = false;
		for (const key of this.exposed) {
			const episode = this.active.get(key);
			if (!episode) continue;
			episode.callsAfterSecond += 1;
			if (episode.toolFamily !== family || episode.targetHash !== target || episode.planItemHash !== item) continue;
			episode.correlatedCallsAfterSecond += 1;
			correlated = true;
		}
		if (correlated) this.correlatedFailureOverrun += 1;
	}

	observeFailure(observation: FailureObservation, now = new Date().toISOString()): { episode: FailureEpisode; opened: boolean } {
		const args = boundedArguments(observation.args);
		const boundedObservation = { ...observation, args };
		const failureClass = classifyFailure(boundedObservation);
		const family = toolFamily(observation.toolName, args);
		const target = targetHash(observation.toolName, args);
		const item = planItemHash(observation.planItemId);
		const key = episodeKey({ failureClass, toolFamily: family, targetHash: target, planItemHash: item });
		let episode = this.active.get(key);
		const opened = !episode;
		if (!episode) {
			episode = {
				id: key.slice(0, 16), key, failureClass, toolFamily: family, targetHash: target,
				planItemHash: item, count: 0, callsAfterSecond: 0, correlatedCallsAfterSecond: 0, strategyHashes: [],
				openedAt: now, updatedAt: now, status: "active", recovery: null,
			};
			this.active.set(key, episode);
			this.totalEpisodes += 1;
		}
		episode.count += 1;
		if (episode.count === 2) this.exposed.add(key);
		episode.updatedAt = now;
		const strategy = strategyHash(observation.toolName, args);
		if (!episode.strategyHashes.includes(strategy) && episode.strategyHashes.length < MAX_STRATEGIES) {
			episode.strategyHashes.push(strategy);
		}
		this.totalFailures += 1;
		this.longestEpisode = Math.max(this.longestEpisode, episode.count);
		return { episode: cloneEpisode(episode), opened };
	}

	observeSuccess(observation: SuccessObservation, recovery: RecoveryKind = "tool_success", now = new Date().toISOString()): FailureEpisode[] {
		const args = boundedArguments(observation.args);
		const family = toolFamily(observation.toolName, args);
		const target = targetHash(observation.toolName, args);
		const recovered: FailureEpisode[] = [];
		for (const [key, episode] of this.active) {
			const exactGateRecovery = observation.verifiedExact === true &&
				["verification_assertion", "compile_or_lint", "unknown"].includes(episode.failureClass);
			const providerRecovery = recovery === "provider_first_token" && episode.failureClass === "provider";
			const directRecovery = episode.toolFamily === family && episode.targetHash === target &&
				(["schema_validation", "policy_rejection", "permission", "not_found", "command_missing", "edit_conflict"].includes(episode.failureClass));
			if (!exactGateRecovery && !providerRecovery && !directRecovery) continue;
			episode.status = "recovered";
			episode.recovery = exactGateRecovery ? "exact_gate" : recovery;
			episode.updatedAt = now;
			this.active.delete(key);
			this.exposed.delete(key);
			this.pushCompleted(episode);
			recovered.push(cloneEpisode(episode));
		}
		return recovered;
	}

	settle(now = new Date().toISOString()): FailureEpisode[] {
		const settled: FailureEpisode[] = [];
		for (const [key, episode] of this.active) {
			episode.status = "settled";
			episode.updatedAt = now;
			this.active.delete(key);
			this.exposed.delete(key);
			this.pushCompleted(episode);
			this.settledWithoutRecovery += 1;
			settled.push(cloneEpisode(episode));
		}
		return settled;
	}

	activeEpisodes(): FailureEpisode[] {
		return [...this.active.values()].map(cloneEpisode);
	}

	clearActive(now = new Date().toISOString()): FailureEpisode[] {
		const cleared: FailureEpisode[] = [];
		for (const [key, episode] of this.active) {
			episode.status = "recovered";
			episode.recovery = "manual_resume";
			episode.updatedAt = now;
			this.active.delete(key);
			this.exposed.delete(key);
			this.pushCompleted(episode);
			cleared.push(cloneEpisode(episode));
		}
		return cleared;
	}

	snapshot(): FailureEpisodeSnapshot {
		return {
			v: 2,
			totalEpisodes: this.totalEpisodes,
			totalFailures: this.totalFailures,
			longestEpisode: this.longestEpisode,
			semanticFailureOverrun: this.semanticFailureOverrun,
			correlatedFailureOverrun: this.correlatedFailureOverrun,
			settledWithoutRecovery: this.settledWithoutRecovery,
			active: this.activeEpisodes(),
			completed: this.completed.map(cloneEpisode),
		};
	}

	private pushCompleted(episode: FailureEpisode): void {
		this.completed.push(cloneEpisode(episode));
		if (this.completed.length > MAX_COMPLETED) this.completed.shift();
	}
}
