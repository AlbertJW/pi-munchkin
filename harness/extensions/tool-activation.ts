import { subscribeOnce } from "../lib/extension-lifecycle.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { agentDir } from "../lib/agent-dir.ts";
import { FLAT_PLAN_TOOLS, PLAN_SURFACE_TOOLS, measureActiveSurface } from "../lib/capability-surface.ts";
import { classifyBashCommand } from "../lib/command-policy.ts";
import { record } from "../lib/telemetry.ts";
import { initialToolSurface } from "../lib/session-bootstrap.ts";
import { onHarnessSignal } from "../lib/harness-signals.ts";

type Profile = "ambient" | "core";
type LegacyMode = "ambient" | "dynamic" | "phase";
const PLAN_GRAPH_ENABLED = process.env.PLAN_GRAPH === "on";
const DEEP_RESEARCH_PLANNING_ENABLED = PLAN_GRAPH_ENABLED && process.env.DEEP_RESEARCH_PLANNING === "on";
// A skill-scoped parent lease for the dark deep-research graph. This is
// deliberately a separate, parent-only opt-in: ordinary sessions keep the
// bounded core surface, and delegated children must not inherit the lease.
const HEADLESS_PLAN_ENABLED = DEEP_RESEARCH_PLANNING_ENABLED && process.env.PI_MUNCHKIN_HEADLESS_PLAN === "on";
const HEADLESS_PLAN_TOOLS = new Set([
	"plan_write", "plan_update", "plan_expand", "plan_settle", "research_plan_start",
	"web_search", "web_read", "research_note", "research_recall", "subagent",
]);
type Family = "research" | "delegation" | "browser" | "canvas" | "context" | "planning" | "goals";

export const MUNCHKIN_TOOL_PROFILE_DEFAULT: Profile = "core";
// Exported for plan-runner's post-restart surface restore (audit A6, 2026-08-25):
// after a reload during /plan the in-memory surface bookkeeping is gone, and the
// only correct restore target is the baseline filtered through the same profile.
export const CORE_NAMES = new Set([
	"read", "bash", "edit", "write", "search_spans", "read_span", "recall",
	"verify_project", "capability", "plan_write", "plan_update",
]);
const EXPLICIT_FLAG = "__pi_tool_selection_explicit";

// Survives /reload. `resource-loader.reload()` calls `clearExtensionCache()`
// (resource-loader.js:219) whenever a session has already loaded, so the module is
// RE-IMPORTED and the factory RE-INVOKED against a fresh api (loader.js:354-356) —
// module scope and the default() closure are both wiped. globalThis is the only
// store that outlives a reload inside one Pi process; lib/process-writer.ts uses
// this key pattern for exactly the same reason.
//
// This is load-bearing: audit A1 (2026-08-25) added a `previouslyDeferred` recovery
// so capability families survive an in-process re-entry, but held the record in the
// default() closure — the one place that cannot survive the event it was written for.
// The recovery therefore never ran, and after any /reload every family returned
// "unavailable-or-active" for the rest of the process.
const ACTIVATION_MEMORY_KEY = "__pi_tool_activation_memory_v1";
type ActivationMemory = { deferred: Set<string>; attempted: Set<Family>; owned: Set<string> };

function activationMemory(): ActivationMemory {
	const shared = globalThis as Record<string, unknown>;
	const existing = shared[ACTIVATION_MEMORY_KEY] as ActivationMemory | undefined;
	if (existing?.deferred instanceof Set && existing.attempted instanceof Set && existing.owned instanceof Set) return existing;
	const fresh: ActivationMemory = { deferred: new Set(), attempted: new Set(), owned: new Set() };
	shared[ACTIVATION_MEMORY_KEY] = fresh;
	return fresh;
}

/** Replace a set's contents without breaking the identity the memory shares. */
function setTo<T>(target: Set<T>, values: Iterable<T>): void {
	target.clear();
	for (const value of values) target.add(value);
}

export function profileFromEnvironment(): Profile {
	if (process.env.MUNCHKIN_TOOL_PROFILE === "core" || process.env.MUNCHKIN_TOOL_SURFACE === "minimal") return "core";
	return MUNCHKIN_TOOL_PROFILE_DEFAULT;
}

function legacyMode(): LegacyMode {
	const value = process.env.MUNCHKIN_TOOL_ACTIVATION;
	return value === "ambient" || value === "phase" ? value : "dynamic";
}

function commandLineIsExplicit(argv: readonly string[] = process.argv): boolean {
	return argv.some((arg) => ["--tools", "--exclude-tools", "--no-tools", "--no-builtin-tools"].includes(arg) ||
		arg.startsWith("--tools=") || arg.startsWith("--exclude-tools="));
}

async function settingsAreExplicit(cwd: string): Promise<boolean> {
	for (const path of [join(agentDir(), "settings.json"), join(cwd, ".pi", "settings.json")]) {
		try {
			const value = JSON.parse(await readFile(path, "utf8"));
			if (Array.isArray(value?.defaultTools)) return true;
		} catch { /* absent or malformed settings are not evidence of explicit intent */ }
	}
	return false;
}

/**
 * Explicit user intent is judged by POSITIVE evidence only: CLI tool flags and a
 * settings `defaultTools` array. It is deliberately NOT inferred from the shape of
 * the baseline registry (tools present but inactive): that inference is
 * version-coupled to Pi's builtin roster — Pi 0.84.3 added `powershell` as a
 * default-inactive builtin, which made every fresh session look user-narrowed,
 * skip the core profile, and refuse /plan ("the explicit tool selection excludes
 * plan_write"; observed live 2026-08-25 on a package-installed deployment). Pi's
 * initial active set never comes from persisted session state, so any inactive
 * tool at a clean baseline is Pi's own default, not a user's selection.
 */
export function baselineLooksExplicit(argv: readonly string[] = process.argv): boolean {
	return commandLineIsExplicit(argv);
}

function familyTools(family: Family, all: readonly string[]): string[] {
	switch (family) {
		case "research": return all.filter((name) => name === "web_search" || name === "web_read");
		case "delegation": return all.filter((name) => name === "subagent");
		case "browser": return all.filter((name) => name.startsWith("browser_"));
		case "canvas": return all.filter((name) => name.startsWith("tldraw_"));
		case "context": return all.filter((name) => name === "compact_context");
		case "goals": return all.filter((name) => ["goal_propose", "goal_inspect", "goal_update", "goal_settle", "goal_block"].includes(name));
		// Flat plan tools are activatable in ANY session: skills and models may
		// legitimately structure multi-item work without the human /plan surface
		// (measured live 2026-08-25: the process-circleback skill instructs
		// plan_write per meeting and had no legal route to it).
		//
		// Membership is REGISTRATION-driven, not flag-driven. plan-runner already
		// encodes every dark flag in what it registers, so re-deriving those guards
		// here only creates a second copy that can disagree with the first — and did:
		// the graph tools were hidden at startup by plan-runner but listed by this
		// family only under DEEP_RESEARCH_PLANNING, so with PLAN_GRAPH alone they had
		// no route back. `all` is the registered roster, so filtering it is exact.
		case "planning": return all.filter((name) => PLAN_SURFACE_TOOLS.includes(name));
	}
}

function isMutationResult(toolName: string, input: unknown): boolean {
	if (toolName === "edit" || toolName === "write") return true;
	if (toolName !== "bash") return false;
	return classifyBashCommand(String((input as { command?: unknown } | undefined)?.command ?? "")).mutates;
}

export default function (pi: ExtensionAPI): void {
	const profile = profileFromEnvironment();
	const activationMode = legacyMode();
	const g = globalThis as Record<string, unknown>;
	let allTools: any[] = [];
	let allNames: string[] = [];
	let explicit = false;
	const memory = activationMemory();
	const deferred = memory.deferred;
	const attempted = memory.attempted;
	const owned = memory.owned;
	let lastOpenItems = 0;
	let lastContextPct = 0;
	let firstUsefulMutation = false;
	let unavailableAttempts = 0;
	let sessionStartedAt = 0;

	const publish = (reason: string) => {
		g.__pi_tool_activation_state = {
			profile, mode: activationMode, preserved_explicit: explicit, reason,
			deferred: [...deferred].sort(), attempted: [...attempted].sort(),
		};
		g[EXPLICIT_FLAG] = explicit;
	};

	const surfaceTelemetry = () => {
		const active = pi.getActiveTools();
		const measured = measureActiveSurface(allTools, active);
		record("tool-activation", "surface", {
			mode: activationMode, surface_mode: profile, active_tools: active.length, all_tools: allTools.length,
			schema_bytes: measured.schemaBytes, guideline_bytes: measured.guidelineBytes,
			// Was the literal `0`. A hard-coded metric reads as coverage while measuring
			// nothing: any analysis joining on it concluded "no model ever hit an
			// unavailable tool", which is the same silent-zero class as the 16-hex vs
			// 64-hex episode-id bug that flat-lined three recovery metrics.
			deferred_tools: deferred.size, unavailable_attempts: unavailableAttempts,
		});
	};

	/** Record a request the harness could not satisfy — the counterpart of `activated`. */
	const noteUnavailable = (family: Family, status: string) => {
		unavailableAttempts += 1;
		const names = familyTools(family, allNames);
		for (const tool of names.length ? names : [family]) record("tool-activation", "unavailable", { tool, reason: status });
		if (!names.length) record("tool-activation", "unavailable", { tool: `family:${family}`, reason: "no-registered-tools" });
	};

	const activateFamily = (family: Family, reason: string): { activated: number; status: string } => {
		const goalActive = (g.__pi_active_goal_context as { status?: unknown } | undefined)?.status === "active";
		if (attempted.has(family) && !(family === "goals" && goalActive)) { noteUnavailable(family, "already-attempted-or-manually-disabled"); return { activated: 0, status: "already-attempted-or-manually-disabled" }; }
		// The one-attempt latch is charged only when activation actually happens (or
		// the family is genuinely already active). A refusal that is not the model's
		// fault — the planning-phase restriction, or tools not yet in the deferred
		// pool — used to burn the family for the whole session (audit A5,
		// 2026-08-25): one capability(delegation) call during /plan permanently
		// disabled delegation, and verify-gate's tier-2 recovery request was
		// silently swallowed the same way.
		if (g.__pi_plan_phase_active === true && family !== "research") {
			noteUnavailable(family, "planning-allows-research-only");
			publish("planning-restriction");
			return { activated: 0, status: "planning-allows-research-only" };
		}
		const familyNames = familyTools(family, allNames);
		const names = family === "goals" && !goalActive ? familyNames.filter((name) => name === "goal_propose") : familyNames;
		const allowed = explicit ? names.filter((name) => (initialToolSurface()?.active ?? []).includes(name)) : names;
		const active = pi.getActiveTools();
		const add = allowed.filter((name) => deferred.has(name) && !active.includes(name));
		if (!add.length) {
			const alreadyActive = names.length > 0 && names.every((name) => active.includes(name));
			if (alreadyActive) attempted.add(family);
			else noteUnavailable(family, explicit ? "preserved-explicit" : "unavailable");
			publish(explicit ? "preserved-explicit" : "unavailable-or-active");
			return { activated: 0, status: explicit ? "preserved-explicit" : "unavailable-or-active" };
		}
		attempted.add(family);
		try {
			pi.setActiveTools([...active, ...add]);
			for (const name of add) {
				deferred.delete(name);
				owned.add(name);
				record("tool-activation", "activated", { tool: name, reason });
			}
			publish("activated");
			surfaceTelemetry();
			return { activated: add.length, status: "activated" };
		} catch {
			noteUnavailable(family, "activation-failed");
			publish("activation-failed");
			return { activated: 0, status: "activation-failed" };
		}
	};

	const deactivateGoalExecution = (reason: string): void => {
		const execution = new Set(["goal_inspect", "goal_update", "goal_settle", "goal_block"]);
		const active = pi.getActiveTools();
		const remove = active.filter((name) => execution.has(name) && owned.has(name));
		if (!remove.length) return;
		pi.setActiveTools(active.filter((name) => !remove.includes(name)));
		for (const name of remove) {
			owned.delete(name);
			deferred.add(name);
			record("tool-activation", "deactivated", { tool: name, reason });
		}
		attempted.delete("goals");
		publish("goal-inactive");
		surfaceTelemetry();
	};

	pi.registerTool(defineTool({
		name: "capability",
		label: "Capability Switch",
		description: "Enable one specialist tool family for this session, or report bounded family status.",
		promptSnippet: "capability: enable research, delegation, browser, canvas, context, planning, or goals tools only when needed",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("enable"), Type.Literal("status")]),
			family: Type.Optional(Type.Union([
				Type.Literal("research"), Type.Literal("delegation"), Type.Literal("browser"),
				Type.Literal("canvas"), Type.Literal("context"), Type.Literal("planning"),
				Type.Literal("goals"),
			])),
		}),
		async execute(_toolCallId, params) {
			if (params.action === "enable" && !params.family) throw new Error("capability: family is required for enable");
			const result = params.action === "enable" ? activateFamily(params.family as Family, "model-request") : null;
			const activeFamilies = (["research", "delegation", "browser", "canvas", "context", "planning", "goals"] as Family[])
				.filter((family) => familyTools(family, allNames).some((name) => pi.getActiveTools().includes(name)));
			return {
				content: [{ type: "text" as const, text: JSON.stringify({ profile, explicit, active_families: activeFamilies, result }) }],
				details: { tool_name: "capability", success: result?.status !== "activation-failed" },
			};
		},
	}));

	subscribeOnce("tool-activation:domain-signal", () => onHarnessSignal(pi.events, (signal) => {
		if (signal.type === "plan/write") lastOpenItems = signal.openItems;
		if (signal.type === "plan/go" && lastOpenItems > 1) activateFamily("delegation", "multi-item-execution");
		if (signal.type === "goal/state") {
			if (signal.status === "active") activateFamily("goals", "goal-active");
			else deactivateGoalExecution(`goal-${signal.status}`);
		}
		if (signal.type === "loop/tier" && signal.tier === 2) activateFamily("delegation", signal.detector === "semantic" ? "semantic-tier-two" : "loop-tier-two");
		// The core/deferred split is computed at session_start, four manifest slots
		// before the capsule identity that makes plan state readable exists. So
		// `activePlan` was ALWAYS false there under the shipped defaults and the plan
		// tools were deferred even mid-plan. This is the corrected answer arriving.
		// It deliberately does NOT go through activateFamily: this is the harness
		// repairing its own mistimed decision, not the model spending its one attempt.
		if (signal.type === "plan/rebound" && !explicit && signal.openItems > 0) {
			const active = pi.getActiveTools();
			const restore = FLAT_PLAN_TOOLS.filter((name) => deferred.has(name) && !active.includes(name));
			if (restore.length) {
				pi.setActiveTools([...active, ...restore]);
				for (const name of restore) {
					deferred.delete(name);
					record("tool-activation", "activated", { tool: name, reason: "plan-rebound" });
				}
				publish("plan-rebound");
				surfaceTelemetry();
			}
		}
		if (signal.type === "capability/need") {
			if (signal.capability === "subagent") activateFamily("delegation", signal.reason);
			if (signal.capability === "compact_context") activateFamily("context", signal.reason);
			if (signal.capability === "web_read") activateFamily("research", signal.reason);
		}
	}));

	pi.on("session_start", async (_event, ctx) => {
		// Keep what the PREVIOUS generation deferred: on an in-process re-entry the
		// live active set is already-narrowed, and this record is the only honest
		// account of which absences are the harness's own doing (vs a manual
		// /tools disable, which appears in neither set and stays authoritative).
		const previouslyDeferred = new Set(deferred);
		deferred.clear();
		attempted.clear();
		owned.clear();
		lastOpenItems = 0;
		lastContextPct = 0;
		firstUsefulMutation = false;
		unavailableAttempts = 0;
		sessionStartedAt = performance.now();
		try { allTools = pi.getAllTools() as any[]; } catch { allTools = []; }
		allNames = allTools.map((tool) => String(tool.name));
		// Explicitness never depends on baseline shape (see baselineLooksExplicit).
		// An incomplete bootstrap baseline no longer forces explicit — that
		// fail-closed branch bricked /plan for a condition the user did not cause;
		// it keeps a distinct telemetry reason for observability.
		const baseline = initialToolSurface();
		explicit = baselineLooksExplicit() || await settingsAreExplicit(ctx.cwd);
		publish(explicit ? "preserved-explicit" : baseline?.complete ? "startup" : "bootstrap-incomplete");
		if (explicit) {
			for (const family of ["research", "delegation", "browser", "canvas", "context", ...(DEEP_RESEARCH_PLANNING_ENABLED ? ["planning" as const] : [])] as Family[]) {
				for (const tool of familyTools(family, allNames)) record("tool-activation", "preserved-explicit", { tool, reason: "explicit-tools" });
			}
			surfaceTelemetry();
			return;
		}

		const active = pi.getActiveTools();
		if (profile === "core") {
			const activePlan = Boolean(g.__pi_active_plan_context);
			const activeGoal = (g.__pi_active_goal_context as { status?: unknown } | undefined)?.status === "active";
			// The candidate pool is the LIVE set plus (a) everything THIS extension
			// deferred previously — on an in-process session re-entry (reload) pi
			// rebuilds from the already-narrowed surface, so deriving from `active`
			// alone left `deferred` empty and every capability family permanently
			// dead (audit A1, 2026-08-25) — and (b) the flat plan tools, which
			// plan-runner (loaded earlier) strips from the active set before this
			// handler ever sees them, which made the `planning` family unreachable
			// at shipped defaults (audit A2). Manual /tools disables stay
			// authoritative: a user can only disable an ACTIVE tool, and those are
			// in neither recovery set.
			const registered = new Set(allNames);
			const pool = new Set(active);
			for (const name of previouslyDeferred) if (registered.has(name)) pool.add(name);
			for (const name of PLAN_SURFACE_TOOLS) if (registered.has(name)) pool.add(name);
			const activeGoalTools = new Set(activeGoal ? familyTools("goals", allNames) : []);
			const core = [...pool].filter((name) =>
				(CORE_NAMES.has(name) && (activePlan || (name !== "plan_write" && name !== "plan_update"))) ||
				activeGoalTools.has(name) || (HEADLESS_PLAN_ENABLED && HEADLESS_PLAN_TOOLS.has(name)));
			setTo(deferred, [...pool].filter((name) => !core.includes(name)));
			for (const name of activeGoalTools) if (core.includes(name)) owned.add(name);
			if (DEEP_RESEARCH_PLANNING_ENABLED) for (const name of familyTools("planning", allNames)) if (!core.includes(name)) deferred.add(name);
			pi.setActiveTools(core);
			if (HEADLESS_PLAN_ENABLED) {
				for (const name of core.filter((candidate) => HEADLESS_PLAN_TOOLS.has(candidate))) {
					record("tool-activation", "activated", { tool: name, reason: "headless-plan-lease" });
				}
			}
			for (const name of deferred) record("tool-activation", "deferred", { tool: name, reason: "core-startup" });
			publish("core-startup");
			surfaceTelemetry();
			return;
		}

		if (activationMode !== "ambient") {
			for (const name of ["subagent", "compact_context"]) if (active.includes(name)) deferred.add(name);
			pi.setActiveTools(active.filter((name) => !deferred.has(name)));
			for (const name of deferred) record("tool-activation", "deferred", { tool: name, reason: "dynamic-startup" });
		}
		publish(activationMode === "ambient" ? "ambient-startup" : "dynamic-startup");
		surfaceTelemetry();
	});

	pi.on("context", async (_event, ctx) => {
		const pct = ctx.getContextUsage()?.percent;
		if (pct != null && lastContextPct < 60 && pct >= 60) activateFamily("context", "context-60");
		if (pct != null) lastContextPct = pct;
	});

	pi.on("tool_result", async (event) => {
		if (firstUsefulMutation || event.isError || !isMutationResult(event.toolName, event.input)) return;
		firstUsefulMutation = true;
		record("tool-activation", "first-useful-mutation", { elapsed_ms: Math.max(0, Math.round(performance.now() - sessionStartedAt)), tool: event.toolName });
	});
}
