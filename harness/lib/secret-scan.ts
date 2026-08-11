import { isIP } from "node:net";
import { isPrivateAddress } from "./public-url.ts";

export type DiffLine = { file: string; line: number; text: string };
export type SecretFinding = { file: string; line: number; pattern: string };

const providerToken = new RegExp([
  "(?:sk", "-[A-Za-z0-9_-]{20,}|ghp", "_[A-Za-z0-9]{20,}|github", "_pat_[A-Za-z0-9_]{20,}|xox[baprs]", "-[A-Za-z0-9-]{20,}|AKIA[A-Z0-9]{16})",
].join(""));
const credentialAssignment = new RegExp([
  "(?:API", "_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)\\s*[:=]\\s*[\\\"']?([^\\s\\\"']{12,})",
].join(""), "i");
const placeholder = /(?:\$\{|dummy|sentinel|example|test|redacted|placeholder|change[_-]?me|x{4,})/i;

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === ["local", "host"].join("") || host.endsWith(".local")) return true;
  return isIP(host) !== 0 && isPrivateAddress(host);
}

function containsPrivateEndpoint(text: string): boolean {
  for (const match of text.matchAll(/https?:\/\/[^\s"'`<>]+/gi)) {
    try {
      if (isPrivateHost(new URL(match[0]).hostname)) return true;
    } catch {
      // A malformed URL is not reported as a credential match.
    }
  }
  return false;
}

export function scanAddedLines(lines: DiffLine[]): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const privateKeyMarker = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
  const bearerMarker = new RegExp(["authorization", "\\s*:\\s*bearer\\s+[^\\s]{16,}"].join(""), "i");
  for (const line of lines) {
    let pattern: string | null = null;
    // Placeholder suppression is judged against the MATCHED TOKEN, never the
    // whole line — same scope CREDENTIAL_ASSIGNMENT below already uses. A real
    // key on a line that happens to say "test" or "example" must still be found.
    const providerMatch = providerToken.exec(line.text);
    if (line.text.includes(privateKeyMarker)) pattern = "PRIVATE_KEY";
    else if (bearerMarker.test(line.text)) pattern = "AUTH_BEARER";
    else if (providerMatch && !placeholder.test(providerMatch[0])) pattern = "PROVIDER_TOKEN";
    else {
      const assignment = credentialAssignment.exec(line.text);
      if (assignment && !placeholder.test(assignment[1])) pattern = "CREDENTIAL_ASSIGNMENT";
      else if (containsPrivateEndpoint(line.text)) pattern = "PRIVATE_ENDPOINT";
    }
    if (pattern) findings.push({ file: line.file, line: line.line, pattern });
  }
  return findings;
}

export function parseUnifiedDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let file = "";
  let newLine = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ b/")) {
      file = raw.slice(6);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (!file || raw.startsWith("---")) continue;
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      lines.push({ file, line: newLine, text: raw.slice(1) });
      newLine += 1;
    } else if (!raw.startsWith("-")) {
      newLine += 1;
    }
  }
  return lines;
}
