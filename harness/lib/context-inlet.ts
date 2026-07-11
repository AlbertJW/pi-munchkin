import { isAbsolute, resolve } from "node:path";

export function resolveReadPath(cwd: string, inputPath: string): string {
	return isAbsolute(inputPath) ? inputPath : resolve(cwd, inputPath);
}

export function isPositiveNumber(value: unknown): boolean {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

// A big explicit limit on a RISKY file defeats the 8KiB gate (hashline's 50KiB
// byte cap is the only backstop — 6× the intended risky-intake bound). Risky
// reads must page narrowly; CTX_GUARD_RISKY_LINES overrides the page size.
export const RISKY_MAX_LIMIT = (() => {
	const n = Number.parseInt(process.env.CTX_GUARD_RISKY_LINES || "200", 10);
	return Number.isFinite(n) && n > 0 ? n : 200;
})();

export function limitBypassesRiskyGate(limit: unknown, risky: boolean): boolean {
	return risky && typeof limit === "number" && Number.isFinite(limit) && limit > RISKY_MAX_LIMIT;
}
