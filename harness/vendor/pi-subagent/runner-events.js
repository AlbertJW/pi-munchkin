/**
 * Helpers for parsing Pi JSON mode events and summarizing subagent results.
 */

function getSeenMessageSignatures(result) {
  if (!Object.prototype.hasOwnProperty.call(result, "__seenMessageSignatures")) {
    Object.defineProperty(result, "__seenMessageSignatures", {
      value: new Set(),
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return result.__seenMessageSignatures;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(",")}}`;
}

function getMessageSignature(message) {
  return stableStringify(message);
}

function updateAssistantMetadata(result, message) {
  if (!message || message.role !== "assistant") return;
  if (!result.model && message.model) result.model = message.model;
  if (message.stopReason) result.stopReason = message.stopReason;
  if (message.errorMessage) result.errorMessage = message.errorMessage;
}

function addAssistantMessage(result, message) {
  if (!message || message.role !== "assistant") return false;

  updateAssistantMetadata(result, message);

  const signature = getMessageSignature(message);
  const seen = getSeenMessageSignatures(result);
  if (seen.has(signature)) return false;
  seen.add(signature);

  result.messages.push(message);

  result.usage.turns++;
  const usage = message.usage;
  if (usage) {
    result.usage.input += usage.input || 0;
    result.usage.output += usage.output || 0;
    result.usage.cacheRead += usage.cacheRead || 0;
    result.usage.cacheWrite += usage.cacheWrite || 0;
    result.usage.cost += usage.cost?.total || 0;
    result.usage.contextTokens = usage.totalTokens || 0;
  }

  return true;
}

function addAssistantMessages(result, messages) {
  if (!Array.isArray(messages)) return false;
  let changed = false;
  for (const message of messages) {
    if (addAssistantMessage(result, message)) changed = true;
  }
  return changed;
}

// Keep delegated retrieval evidence independently bound to the tool execution
// stream. Assistant messages contain the model's requested tool calls, but not
// the executed tool result metadata; counting prose or calls alone lets a
// child claim complete coverage after a failed/truncated read. Only the safe
// aggregate receipt is retained — never arguments, URLs, or page content.
function observeResearchToolResult(result, event) {
  if (event.toolName !== "web_search" && event.toolName !== "web_read") return false;
  if (!Object.prototype.hasOwnProperty.call(result, "__seenResearchToolCalls")) {
    Object.defineProperty(result, "__seenResearchToolCalls", {
      value: new Set(), enumerable: false, configurable: false, writable: false,
    });
  }
  const key = typeof event.toolCallId === "string" && event.toolCallId.length > 0
    ? event.toolCallId : `${event.toolName}:${result.__seenResearchToolCalls.size}`;
  if (result.__seenResearchToolCalls.has(key)) return false;
  result.__seenResearchToolCalls.add(key);

  const details = event.result && typeof event.result === "object" ? event.result.details : undefined;
  const coverage = details && typeof details === "object" ? details.coverage : undefined;
  const valid = coverage && typeof coverage === "object" && !Array.isArray(coverage) &&
    Number.isSafeInteger(coverage.returned_count) && coverage.returned_count >= 0 &&
    typeof coverage.truncated === "boolean" && typeof coverage.failed === "boolean" &&
    typeof coverage.budget_exhausted === "boolean" && typeof coverage.complete === "boolean" &&
    coverage.complete === (!coverage.truncated && !coverage.failed && !coverage.budget_exhausted);
  const prior = result.researchCoverage || {
    calls: 0, returned_count: 0, incomplete: false, truncated: false, failed: false, budget_exhausted: false,
  };
  if (!valid) {
    result.researchCoverage = {
      calls: prior.calls + 1, returned_count: prior.returned_count, incomplete: true,
      truncated: prior.truncated, failed: true, budget_exhausted: prior.budget_exhausted,
    };
    return true;
  }
  result.researchCoverage = {
    calls: prior.calls + 1,
    returned_count: prior.returned_count + coverage.returned_count,
    incomplete: prior.incomplete || !coverage.complete,
    truncated: prior.truncated || coverage.truncated,
    failed: prior.failed || coverage.failed,
    budget_exhausted: prior.budget_exhausted || coverage.budget_exhausted,
  };
  return true;
}

export function processPiEvent(event, result) {
  if (!event || typeof event !== "object") return false;

  switch (event.type) {
    case "tool_execution_end":
      return observeResearchToolResult(result, event);

    case "message_end":
      return addAssistantMessage(result, event.message);

    case "turn_end":
      return addAssistantMessage(result, event.message);

    case "agent_end":
      result.sawAgentEnd = true;
      return addAssistantMessages(result, event.messages);

    default:
      return false;
  }
}

export function processPiJsonLine(line, result) {
  if (!line.trim()) return false;

  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return false;
  }

  return processPiEvent(event, result);
}

export function getFinalAssistantText(messages) {
  if (!Array.isArray(messages)) return "";

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== "assistant" || !Array.isArray(message.content)) {
      continue;
    }

    for (const part of message.content) {
      if (part?.type === "text" && typeof part.text === "string" && part.text.length > 0) {
        return part.text;
      }
    }
  }

  return "";
}

// Clamp: a subagent's final text enters the PARENT window verbatim — an
// unbounded child answer can dump tens of thousands of tokens into a 30k
// context. Subagents are contracted to return distilled results; cap hard.
// Tunable via PI_SUBAGENT_MAX_SUMMARY_CHARS (default 12000) for parents with a
// larger window; a non-positive/invalid value falls back to the default.
const MAX_SUMMARY_CHARS = (() => {
  const n = Number.parseInt(process.env.PI_SUBAGENT_MAX_SUMMARY_CHARS || "", 10);
  return Number.isFinite(n) && n > 0 ? n : 12000;
})();
function clampSummary(text) {
  if (typeof text !== "string" || text.length <= MAX_SUMMARY_CHARS) return text;
  return `${text.slice(0, MAX_SUMMARY_CHARS)}\n…[subagent output truncated: ${text.length} chars total]`;
}

// Error text is not model-authored work product. It is an untrusted child
// process diagnostic and may contain compiler output, absolute paths, URLs, or
// credential-shaped values. Keep it useful enough to distinguish a timeout or
// permission failure, but make the parent-facing contract bounded and safe.
const DIAGNOSTIC_MAX_BYTES = 500;

function sanitizeDiagnostic(text) {
  if (typeof text !== "string") return "";
  const cleaned = text
    .replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/gu, "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, " ")
    .replace(/\b(?:https?|wss?):\/\/[^\s]+/giu, "[url omitted]")
    .replace(/(?:^|\s)(?:\/(?:Users|home|private|var|tmp)\/[^\s]+)/gu, " [path omitted]")
    .replace(/(?:^|\s)[A-Za-z]:\\[^\s]+/gu, " [path omitted]")
    .replace(/\b(?:sk|rk|pk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{6,}\b/giu, "[redacted]")
    .replace(/\b(api[_-]?key|access[_-]?token|token|password|secret|credential)\s*[:=]\s*\S+/giu, "$1=[redacted]")
    .replace(/\s+/gu, " ")
    .trim();
  if (Buffer.byteLength(cleaned, "utf8") <= DIAGNOSTIC_MAX_BYTES) return cleaned;
  let bounded = "";
  let bytes = 0;
  for (const character of cleaned) {
    const width = Buffer.byteLength(character, "utf8");
    if (bytes + width > DIAGNOSTIC_MAX_BYTES) break;
    bounded += character;
    bytes += width;
  }
  return bounded.trim();
}

function diagnosticClass(text) {
  if (/\b(?:timed?\s*out|timeout|ETIMEDOUT)\b/i.test(text)) return "timeout";
  if (/\b(?:permission denied|EACCES|EPERM|read-only file system)\b/i.test(text)) return "permission";
  if (/\b(?:provider|ECONN|ENOTFOUND|network|socket)\b/i.test(text)) return "provider";
  return "unknown";
}

export function renderSubagentDiagnostic(text) {
  const excerpt = sanitizeDiagnostic(text);
  return [
    "UNTRUSTED_SUBAGENT_DIAGNOSTIC",
    "status=error",
    `failure_class=${diagnosticClass(excerpt)}`,
    `excerpt=${JSON.stringify(excerpt || "no diagnostic")}`,
  ].join("\n");
}

export function getResultSummaryText(result) {
  const processFailed =
    (typeof result?.exitCode === "number" && result.exitCode > 0) ||
    result?.stopReason === "error" ||
    result?.stopReason === "aborted";

  // A child that exited with an error is not successful merely because its
  // last assistant message says "done". Process truth wins before model prose.
  if (processFailed) {
    return renderSubagentDiagnostic(
      (typeof result?.errorMessage === "string" && result.errorMessage.trim()) ||
      (typeof result?.stderr === "string" && result.stderr.trim()) ||
      "child process failed",
    );
  }

  const finalText = getFinalAssistantText(result?.messages);
  if (finalText) return clampSummary(finalText);

  if (typeof result?.errorMessage === "string" && result.errorMessage.trim()) {
    return renderSubagentDiagnostic(result.errorMessage.trim());
  }

  if (typeof result?.stderr === "string" && result.stderr.trim()) {
    return renderSubagentDiagnostic(result.stderr.trim());
  }

  return "(no output)";
}
