const CHILD_ENV_KEYS = [
  "HOME", "LANG", "LC_ALL", "PATH", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "WINDIR",
  "XDG_CONFIG_HOME", "PI_CODING_AGENT_DIR",
  "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT",
  "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "LLAMA_API_KEY",
];

// Harness configuration keys. A subagent runs the same extension surface as its
// parent, so every flag and knob the parent set — INCLUDING an explicit `=off`
// suppression — must hold in the child. Before the 2026-08-07 default-on flips
// this list was unnecessary (unset matched the dark default); after them, a
// stripped env silently re-enables every adopted mechanism inside children,
// which can invalidate a gate suppression arm with no error. Any new
// `process.env.X` read in harness code must be added here or to
// EXCLUDED_HARNESS_ENV_KEYS — the coverage test in subagent-hardening.test.ts
// fails until it is classified.
const HARNESS_CONFIG_KEYS = [
  "ACTIVE_TOOL_PROMPTS", "BASH_OUTPUT_GUARD", "BASH_OUTPUT_MAX_CHARS", "BLACKBOARD",
  "CONTEXT_BRIEF", "CONTEXT_BRIEF_BYTES", "CONTEXT_SURFACE_MODE", "CONTROL_ARBITER",
  "CTX_GUARD_RISKY", "CTX_GUARD_RISKY_LINES", "CTX_REDUNDANCY_NUDGE", "CTX_REDUNDANCY_PCT",
  "DID_YOU_MEAN", "DRIFT_SCANNER", "FORCE_PLAN_WRITE", "GIT_GUARD",
  "HARNESS_CONFIG_SHA256", "HARNESS_SURFACE_SHA256", "HASHLINE",
  "HASHLINE_MAX_EDIT_BYTES", "HASHLINE_MAX_READ_BYTES",
  "KETCH", "KETCH_BACKEND", "KETCH_BIN", "KETCH_MULTI_BACKENDS",
  "LB_EPISODE_T1", "LB_EPISODE_T2", "LB_EPISODE_T3",
  "LB_HARD_STOP", "LB_LOCAL_ONLY", "LB_MIN_REASON_LEN", "LB_OUTCOME_T1",
  "LB_REPEAT_T1", "LB_REPEAT_T2", "LB_REPEAT_T3",
  "LB_SESSION_REPEAT", "LB_SESSION_T1", "LB_SESSION_T2", "LB_SESSION_T3",
  "LB_STREAK_HARD", "LB_STREAK_SOFT",
  "LOOP_BREAKER", "LOOP_EPISODE_MODE", "MICRO_GATE", "MICRO_GATE_SLOP",
  "MUNCHKIN_TOOL_ACTIVATION", "PAYLOAD_AUDIT",
  "PLAN_GATE_MAX", "PLAN_GATE_TIMEOUT_MS", "PLAN_ITEM_GUIDANCE_V2", "PLAN_MODE",
  "PLAN_PRESERVE_MAX", "PLAN_REPLAN_MAX", "PLAN_SUBAGENT_ONLY", "PLAN_TOOL_GO", "PLAN_UNCERTAINTY",
  "PI_SUBAGENT_CONCURRENCY", "PI_SUBAGENT_ENV_ALLOW", "PI_SUBAGENT_TIMEOUT_MS",
  "READ_DEDUP", "REFLECT_TIMEOUT_MS", "RESEARCH_LEDGER", "RUN_CAPSULE", "RUN_KERNEL",
  "SPAN_MAX_FILE_BYTES", "SPAN_TOOLS", "SPAWN_DELEGATION",
  "STATE_LENS", "STATE_LENS_MAX_CHARS", "TEACH_HINTS",
  "TELEMETRY", "TELEMETRY_FILE", "TELEMETRY_MAX_BYTES", "TELEMETRY_SOURCE", "TELEMETRY_STRICT", "TELEMETRY_WRITER",
  "TELEMETRY_ASYNC_BATCH_BYTES", "TELEMETRY_ASYNC_BATCH_ROWS", "TELEMETRY_ASYNC_MAX_BYTES", "TELEMETRY_ASYNC_MAX_ROWS",
  "TOOL_CALL_RESCUE", "VERIFY_EXECUTION_ORDER", "VERIFY_GATE", "VERIFY_GATE_CMD", "VERIFY_GATE_MAX_FIRES",
];

// Dynamic env FAMILIES read via template literals or prefix passthrough:
// TEACH_HINT_<RULE> (teach-hints per-rule kill switches), PI_MSG_<NAME>
// (steer-texts overrides), KETCH_* (ketch-runtime forwards the whole prefix).
// Every var carrying one of these prefixes crosses into children.
const HARNESS_CONFIG_PREFIXES = ["TEACH_HINT_", "PI_MSG_", "KETCH_"];

// Read by harness code but deliberately NOT propagated to children:
//   CHAOS               — gauntlet fault injection is armed per parent session;
//                         children have never faulted and changing that would
//                         silently alter gauntlet semantics.
//   TELEMETRY_FD,
//   TELEMETRY_HMAC_FD   — file-descriptor numbers are process-local; inherited
//                         numbers point at arbitrary fds in the child.
//   PI_MODEL_ID, PI_MODEL_PROVIDER, PI_RUN_ID, PI_SANDBOX_POSTURE
//                       — per-process identity stamped by the launcher for the
//                         parent; the child session derives its own.
//   PI_SUBAGENT_DEPTH   — the runner sets the child's depth explicitly; a copied
//                         parent value would double-count nesting.
const EXCLUDED_HARNESS_ENV_KEYS = [
  "CHAOS", "TELEMETRY_FD", "TELEMETRY_HMAC_FD",
  "PI_MODEL_ID", "PI_MODEL_PROVIDER", "PI_RUN_ID", "PI_SANDBOX_POSTURE",
  "PI_SUBAGENT_DEPTH",
];

export function buildSubagentEnv(source = process.env) {
  const env = {};
  const extra = String(source.PI_SUBAGENT_ENV_ALLOW ?? "")
    .split(",").map((name) => name.trim()).filter((name) => /^[A-Z_][A-Z0-9_]*$/.test(name));
  for (const key of new Set([...CHILD_ENV_KEYS, ...HARNESS_CONFIG_KEYS, ...extra])) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  for (const key of Object.keys(source)) {
    if (env[key] === undefined && HARNESS_CONFIG_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      env[key] = source[key];
    }
  }
  return env;
}

export { CHILD_ENV_KEYS, EXCLUDED_HARNESS_ENV_KEYS, HARNESS_CONFIG_KEYS, HARNESS_CONFIG_PREFIXES };
