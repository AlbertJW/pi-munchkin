import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { agentDir } from "./agent-dir.ts";
import { sha256 } from "./failure-episodes.ts";

const SETTINGS_MAX_BYTES = 128 * 1024;
export const FIRST_PARTY_TOOLS = [
	"read", "edit", "plan_write", "plan_go", "subagent", "compact_context",
	"web_search", "web_read", "search_spans", "read_span",
] as const;

type SourceInfo = { source?: unknown; scope?: unknown; origin?: unknown; path?: unknown };
export type DoctorTool = { name: string; sourceInfo?: SourceInfo };

export type ToolSurfaceSummary = {
	active: number;
	all: number;
	preservedExplicit: boolean;
	sourceGroups: string[];
	missing: string[];
	duplicates: string[];
	overrides: string[];
};

export type RuntimePosture = {
	retryEnabled: boolean;
	maxRetries: number;
	baseDelayMs: number;
	httpIdleTimeoutMs: number;
	providerTimeoutMs: number | null;
	providerMaxRetries: number;
	providerMaxRetryDelayMs: number;
	shellPolicyDeclared: boolean;
};

type SettingsShape = {
	retry?: {
		enabled?: unknown; maxRetries?: unknown; baseDelayMs?: unknown;
		provider?: { timeoutMs?: unknown; maxRetries?: unknown; maxRetryDelayMs?: unknown };
	};
	httpIdleTimeoutMs?: unknown;
	shellCommandPrefix?: unknown;
};

function boundedAtom(value: unknown, fallback = "unknown"): string {
	const text = String(value ?? "").replace(/[\r\n\t]/g, " ").trim().slice(0, 96);
	return text || fallback;
}

function safeSource(source: unknown): string {
	const value = boundedAtom(source);
	if (["builtin", "sdk", "local", "unknown"].includes(value)) return value;
	if (/^npm:(?:@?[a-z0-9_.-]+)(?:\/[a-z0-9_.-]+)?$/i.test(value)) return value;
	return `other:${sha256(value).slice(0, 10)}`;
}

function safeDimension(value: unknown): string {
	const atom = boundedAtom(value);
	if (/^(?:builtin|global|project|local|package|extension|sdk|unknown)$/i.test(atom)) return atom;
	if (/^(?:npm:)?(?:[a-z0-9_.-]+|@[a-z0-9_.-]+\/[a-z0-9_.-]+)$/i.test(atom)) return atom;
	return `other:${sha256(atom).slice(0, 10)}`;
}

function sourceLabel(info: SourceInfo | undefined): string {
	return `${safeSource(info?.source)}|${safeDimension(info?.scope)}|${safeDimension(info?.origin)}`;
}

export function summarizeToolSurface(
	tools: DoctorTool[],
	activeNames: string[],
	preservedExplicit: boolean,
): ToolSurfaceSummary {
	const counts = new Map<string, number>();
	const sources = new Map<string, number>();
	const overrides: string[] = [];
	for (const tool of tools) {
		counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
		const label = sourceLabel(tool.sourceInfo);
		sources.set(label, (sources.get(label) ?? 0) + 1);
		if (["read", "edit", "write", "bash"].includes(tool.name) && tool.sourceInfo?.source !== "builtin") {
			overrides.push(`${boundedAtom(tool.name)}@${label}`);
		}
	}
	return {
		active: activeNames.length,
		all: tools.length,
		preservedExplicit,
		sourceGroups: [...sources.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, 16)
			.map(([label, count]) => `${label}=${count}`),
		missing: FIRST_PARTY_TOOLS.filter((name) => !counts.has(name)),
		duplicates: [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => boundedAtom(name)).sort(),
		overrides: [...new Set(overrides)].sort(),
	};
}

function finite(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

async function readSettings(path: string): Promise<SettingsShape> {
	try {
		const info = await stat(path);
		if (!info.isFile() || info.size > SETTINGS_MAX_BYTES) return {};
		const parsed = JSON.parse(await readFile(path, "utf8"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as SettingsShape : {};
	} catch { return {}; }
}

export async function readRuntimePosture(cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<RuntimePosture> {
	const globalSettings = await readSettings(join(agentDir(env), "settings.json"));
	const projectSettings = await readSettings(join(cwd, ".pi", "settings.json"));
	const globalRetry = globalSettings.retry ?? {};
	const projectRetry = projectSettings.retry ?? {};
	const globalProvider = globalRetry.provider ?? {};
	const projectProvider = projectRetry.provider ?? {};
	const providerTimeout = projectProvider.timeoutMs ?? globalProvider.timeoutMs;
	const providerRetries = projectProvider.maxRetries ?? globalProvider.maxRetries;
	return {
		retryEnabled: typeof projectRetry.enabled === "boolean" ? projectRetry.enabled :
			typeof globalRetry.enabled === "boolean" ? globalRetry.enabled : true,
		maxRetries: finite(projectRetry.maxRetries ?? globalRetry.maxRetries, 3),
		baseDelayMs: finite(projectRetry.baseDelayMs ?? globalRetry.baseDelayMs, 2_000),
		httpIdleTimeoutMs: finite(projectSettings.httpIdleTimeoutMs ?? globalSettings.httpIdleTimeoutMs, 300_000),
		providerTimeoutMs: typeof providerTimeout === "number" && Number.isFinite(providerTimeout) && providerTimeout >= 0
			? Math.floor(providerTimeout) : null,
		providerMaxRetries: finite(providerRetries, 0),
		providerMaxRetryDelayMs: finite(projectProvider.maxRetryDelayMs ?? globalProvider.maxRetryDelayMs, 60_000),
		shellPolicyDeclared: typeof (projectSettings.shellCommandPrefix ?? globalSettings.shellCommandPrefix) === "string",
	};
}

export function sandboxPosture(env: NodeJS.ProcessEnv = process.env): "declared" | "host" | "unknown" {
	return env.PI_SANDBOX_POSTURE === "declared" || env.PI_SANDBOX_POSTURE === "host"
		? env.PI_SANDBOX_POSTURE : "unknown";
}

export function strictModeFlag(model: { api?: unknown; compat?: { supportsStrictMode?: unknown } } | undefined): string {
	if (!model) return "unknown";
	if (model.api !== "openai-completions") return "not-applicable";
	if (model.compat?.supportsStrictMode === true) return "true";
	if (model.compat?.supportsStrictMode === false) return "false";
	return "unspecified";
}

export function renderDoctor(input: {
	piVersion: string;
	surfaceHash?: string;
	model?: { id?: unknown; provider?: unknown; api?: unknown; compat?: { supportsStrictMode?: unknown } };
	providerName?: string;
	tools: ToolSurfaceSummary;
	posture: RuntimePosture;
	sandbox: "declared" | "host" | "unknown";
	preservationReason?: string;
}): string {
	const surface = input.surfaceHash && /^[a-f0-9]{64}$/i.test(input.surfaceHash)
		? input.surfaceHash.toLowerCase() : "unknown";
	const providerTimeout = input.posture.providerTimeoutMs ?? "sdk-default";
	return [
		`munchkin-doctor: pi=${boundedAtom(input.piVersion)}; harness_surface=${surface}`,
		`model=${boundedAtom(input.model?.provider)}/${boundedAtom(input.model?.id)}; provider=${boundedAtom(input.providerName)}; api=${boundedAtom(input.model?.api)}; strict_tool_sampling=${strictModeFlag(input.model)}; json_schema_sampling=not-probed`,
		`tools=${input.tools.active}/${input.tools.all} active/all; preserved_explicit=${input.tools.preservedExplicit}; preservation_reason=${boundedAtom(input.preservationReason, "none")}`,
		`sources(sourceInfo.source|scope|origin): ${input.tools.sourceGroups.join(", ") || "none"}`,
		`missing_first_party=${input.tools.missing.join(",") || "none"}; duplicates=${input.tools.duplicates.join(",") || "none"}; overrides=${input.tools.overrides.join(",") || "none"}`,
		`retry_enabled=${input.posture.retryEnabled}; retry_max=${input.posture.maxRetries}; retry_base_delay_ms=${input.posture.baseDelayMs}; http_idle_timeout_ms=${input.posture.httpIdleTimeoutMs}; provider_timeout_ms=${providerTimeout}; provider_max_retries=${input.posture.providerMaxRetries}; provider_max_retry_delay_ms=${input.posture.providerMaxRetryDelayMs}`,
		`sandbox=${input.sandbox}; shell_policy=${input.posture.shellPolicyDeclared ? "declared" : "none"} (shell policy is not isolation)`,
	].join("\n");
}
