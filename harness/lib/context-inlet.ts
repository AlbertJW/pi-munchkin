import { isAbsolute, resolve } from "node:path";

export function resolveReadPath(cwd: string, inputPath: string): string {
	return isAbsolute(inputPath) ? inputPath : resolve(cwd, inputPath);
}

export function isPositiveNumber(value: unknown): boolean {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}
