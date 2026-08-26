// session-resume — event.reason alone does not tell you whether a
// session_start actually carries prior history worth restoring.
//
// Verified against Pi's bundled dist (chunk-E5KXRMZK.js, the code that
// actually runs, not the unbundled dev-dependency copy): `pi -p
// --session-id <existing>` ALWAYS fires session_start with reason
// "startup" — never "resume". `buildSessionOptions`'s `hasExistingSession`
// parameter (computed from `sessionManager.buildSessionContext().messages.
// length>0`) only picks default model/thinkingLevel and preloads prior
// messages into `agent.state.messages`; it never touches sessionStartEvent.
// "resume"/"fork" are constructed ONLY by in-process session-management
// calls (ctx.newSession()/switchSession()/fork()) — never by the CLI's
// initial boot.
//
// So the four extensions that gated capsule/blackboard/working-memory/
// run-kernel restoration on `reason === "resume" || "fork"` silently reset
// that state on EVERY `pi -p --session-id <existing>` call, even though the
// underlying transcript correctly resumes. Reproduced live 2026-08-26: a
// `/plan` in one process, followed by `/plan-go --session-id <same id>` in
// a separate process, found no active plan at all — a fresh, empty run
// capsule had been minted instead of the one `/plan` had just written.
//
// The session's own branch is ground truth Pi already loaded before
// emitting session_start (the CLI path pre-populates agent.state.messages
// from it), so a non-empty branch means resumption regardless of what
// reason claims.
export function isEffectiveResume(
	event: { reason: string },
	ctx: { sessionManager: { getBranch(): unknown[] } },
): boolean {
	if (event.reason === "resume" || event.reason === "fork") return true;
	try { return ctx.sessionManager.getBranch().length > 0; } catch { return false; }
}
