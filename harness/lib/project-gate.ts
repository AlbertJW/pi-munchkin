import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const SHARED_GATE_KEY = "__pi_detected_project_gate_v1";

type SharedGate = { cwdHash: string; command: string | null };

function cwdHash(cwd: string): string {
	return createHash("sha256").update(cwd).digest("hex");
}

/** Share the already-detected result between ordered first-party extensions so
 * the shadow observer does not repeat project filesystem work. No cwd is kept. */
export function publishDetectedProjectGate(cwd: string, command: string | null): void {
	(globalThis as Record<string, unknown>)[SHARED_GATE_KEY] = { cwdHash: cwdHash(cwd), command } satisfies SharedGate;
}

export function clearDetectedProjectGate(): void {
	delete (globalThis as Record<string, unknown>)[SHARED_GATE_KEY];
}

export function readDetectedProjectGate(cwd: string): { found: true; command: string | null } | { found: false } {
	const value = (globalThis as Record<string, unknown>)[SHARED_GATE_KEY] as Partial<SharedGate> | undefined;
	if (!value || value.cwdHash !== cwdHash(cwd) || (value.command !== null && typeof value.command !== "string")) {
		return { found: false };
	}
	return { found: true, command: value.command };
}

function hasRecipe(text: string, name: string): boolean {
	return new RegExp(`^${name}:`, "m").test(text);
}

/** Best-effort project-gate detection shared by verification and shadow
 * observation. It never throws and never returns file contents. */
export async function detectProjectGate(
	cwd: string,
	override: string | undefined = process.env.VERIFY_GATE_CMD,
): Promise<string | null> {
	if (override) return override;
	try {
		const files = new Set(await readdir(cwd));
		for (const jf of ["justfile", "Justfile", ".justfile"]) {
			if (!files.has(jf)) continue;
			const text = await readFile(join(cwd, jf), "utf8");
			for (const recipe of ["verify", "check", "test"]) {
				if (hasRecipe(text, recipe)) return `just ${recipe}`;
			}
		}
		if (files.has("package.json")) {
			try {
				const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
				if (pkg?.scripts?.test) return "npm test";
				if (pkg?.scripts?.check) return "npm run check";
			} catch { /* malformed package metadata means no detected npm gate */ }
		}
		for (const mk of ["Makefile", "makefile"]) {
			if (!files.has(mk)) continue;
			const text = await readFile(join(cwd, mk), "utf8");
			for (const recipe of ["verify", "check", "test"]) {
				if (hasRecipe(text, recipe)) return `make ${recipe}`;
			}
		}
		if (files.has("pyproject.toml") || files.has("pytest.ini") || files.has("tox.ini")) return "pytest";
		if (files.has("Cargo.toml")) return "cargo test";
		if (files.has("go.mod")) return "go test ./...";
		if (files.has("tsconfig.json")) return "tsc --noEmit";
	} catch { /* inaccessible cwd is an unknown project, not a session failure */ }
	return null;
}
