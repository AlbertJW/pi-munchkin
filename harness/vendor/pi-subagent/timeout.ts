// Subagent hard-timeout resolution. Zero imports on purpose: the runner's own
// import graph only resolves under pi's loader, and the default-pinning test in
// harness/tests must be able to import this directly.
//
// 1_800_000 (was 600_000 until 2026-08-24, Albert-approved), aligned with
// PI_TIMEOUT and provider-patience: the wall clock, not a mid-layer, decides when
// to give up. Measured incident: an explorer child on a slow local model hit the
// 600s wall (UNTRUSTED_SUBAGENT_DIAGNOSTIC, failure_class=timeout) and blocked
// its parent task overnight — and with provider-patience allowing a single
// provider request up to 30min of prefill, one slow request could consume an
// entire child budget. PI_SUBAGENT_TIMEOUT_MS still overrides in either direction.
export const DEFAULT_SUBAGENT_TIMEOUT_MS = 1_800_000;

/** Explicit arg > valid env > default. */
export function resolveSubagentTimeoutMs(timeoutMs?: number, env: NodeJS.ProcessEnv = process.env): number {
  const envTimeout = Number.parseInt(env.PI_SUBAGENT_TIMEOUT_MS || "", 10);
  return timeoutMs ?? (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_SUBAGENT_TIMEOUT_MS);
}
