import { createHash } from "node:crypto";
import { classifyFailure, type FailureClass } from "./failure-episodes.ts";
import type { GateResult } from "./gate-runtime.ts";

const MAX_DIAGNOSTIC_BYTES = 500;
const ANSI_ESCAPE = /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/gu;
const tokenPattern = new RegExp([
	"\\b(?:sk|rk|pk|ghp|github", "_pat|xox[baprs])[-_][A-Za-z0-9_-]{6,}\\b",
].join(""), "giu");
const assignmentPattern = new RegExp([
	"\\b(api[_-]?key|to", "ken|password|secret|authorization)\\s*[:=]\\s*[^\\s,;]+",
].join(""), "giu");
const URL_QUERY = /\b(https?:\/\/[^\s?#]+)[?#][^\s]*/giu;
const POSIX_ABSOLUTE_PATH = /(?<![A-Za-z0-9_.-])\/(?:[^\s\0"'`<>:]+\/)*[^\s\0"'`<>:;,)]*/gu;
const WINDOWS_ABSOLUTE_PATH = /\b[A-Za-z]:\\(?:[^\s\0"'`<>:]+\\)*[^\s\0"'`<>:;,)]*/gu;

export type SafeGateDiagnostic = {
	failureClass: FailureClass;
	diagnostic: string;
	diagnosticBytes: number;
	diagnosticSha256: string;
};

function truncateUtf8(value: string, maxBytes: number): string {
	const bytes = Buffer.from(value, "utf8");
	if (bytes.length <= maxBytes) return value;
	let end = maxBytes;
	while (end > 0 && (bytes[end] & 0b1100_0000) === 0b1000_0000) end -= 1;
	return bytes.subarray(0, end).toString("utf8");
}

export function sanitizeGateDiagnostic(value: string): string {
	const cleaned = value
		.replace(ANSI_ESCAPE, "")
		.replace(URL_QUERY, "$1?[redacted]")
		.replace(tokenPattern, "[redacted]")
		.replace(assignmentPattern, "$1=[redacted]")
		.replace(WINDOWS_ABSOLUTE_PATH, "[path]")
		.replace(POSIX_ABSOLUTE_PATH, "[path]")
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, "")
		.replace(/\r\n?/gu, "\n")
		.trim();
	if (Buffer.byteLength(cleaned, "utf8") <= MAX_DIAGNOSTIC_BYTES) return cleaned;
	const prefix = truncateUtf8(cleaned, MAX_DIAGNOSTIC_BYTES);
	const boundary = prefix.lastIndexOf("\n");
	return (boundary > 0 ? prefix.slice(0, boundary) : prefix).trimEnd();
}

export function safeGateDiagnostic(gate: string, result: GateResult): SafeGateDiagnostic {
	const failureClass = result.reason === "timeout" ? "timeout"
		: result.reason === "policy" ? "policy_rejection"
		: classifyFailure({
			toolName: "bash",
			args: { command: gate },
			text: result.output,
			isError: !result.pass,
		});
	const diagnostic = sanitizeGateDiagnostic(result.output || "No diagnostic output was returned.");
	const diagnosticBytes = Buffer.byteLength(diagnostic, "utf8");
	const diagnosticSha256 = createHash("sha256").update(diagnostic).digest("hex");
	return { failureClass, diagnostic, diagnosticBytes, diagnosticSha256 };
}

export function renderSafeGateFailure(parts: {
	diagnostic: SafeGateDiagnostic;
	requiredNextAction: string;
}): string {
	return [
		"PROJECT_VERIFICATION_FAILURE",
		"status=red",
		`failure_class=${parts.diagnostic.failureClass}`,
		`required_next_action=${parts.requiredNextAction}`,
		"UNTRUSTED_GATE_DIAGNOSTIC",
		JSON.stringify(parts.diagnostic.diagnostic),
	].join("\n");
}
