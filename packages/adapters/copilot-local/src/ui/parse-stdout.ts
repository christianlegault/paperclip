import type { TranscriptEntry } from "@paperclipai/adapter-utils";

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function readToolResultContent(data: Record<string, unknown>): string {
  const result = asRecord(data.result);
  const content = asString(result.content) || asString(result.detailedContent);
  if (content) return content;
  const error = data.error;
  if (typeof error === "string") return error;
  const errorRec = asRecord(error);
  return asString(errorRec.message) || stringifyUnknown(data.result ?? data.error ?? "");
}

/**
 * Map one `copilot --output-format json` stdout line to transcript entries.
 * Verified against Copilot CLI 1.0.91 JSONL output.
 */
export function parseCopilotStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const parsed = safeJsonParse(line.trim());
  if (!parsed) {
    return line.trim() ? [{ kind: "stdout", ts, text: line }] : [];
  }

  const type = asString(parsed.type);
  const data = asRecord(parsed.data);

  switch (type) {
    case "session.tools_updated": {
      const model = asString(data.model).trim();
      return model ? [{ kind: "init", ts, model, sessionId: "" }] : [];
    }
    case "user.message": {
      const text = asString(data.content).trim();
      return text ? [{ kind: "user", ts, text }] : [];
    }
    case "assistant.reasoning": {
      const text = asString(data.content).trim();
      return text ? [{ kind: "thinking", ts, text }] : [];
    }
    case "assistant.message": {
      const text = asString(data.content).trim();
      const messageId = asString(data.messageId);
      return text
        ? [{ kind: "assistant", ts, text, ...(messageId ? { itemId: messageId } : {}) }]
        : [];
    }
    case "tool.execution_start": {
      const toolUseId = asString(data.toolCallId);
      return [{
        kind: "tool_call",
        ts,
        name: asString(data.toolName, "tool") || "tool",
        input: data.arguments ?? {},
        ...(toolUseId ? { toolUseId } : {}),
      }];
    }
    case "tool.execution_complete": {
      return [{
        kind: "tool_result",
        ts,
        toolUseId: asString(data.toolCallId),
        content: readToolResultContent(data),
        isError: data.success === false,
      }];
    }
    case "error":
    case "session.error": {
      const text = asString(data.message) || asString(parsed.message) || stringifyUnknown(data);
      return [{ kind: "stderr", ts, text }];
    }
    case "session.info":
    case "session.warning": {
      const text = asString(data.message).trim();
      return text ? [{ kind: "system", ts, text }] : [];
    }
    case "result": {
      const usage = asRecord(parsed.usage);
      const exitCode = asNumber(parsed.exitCode, 0);
      const premiumRequests = asNumber(usage.premiumRequests, 0);
      const durationMs = asNumber(usage.sessionDurationMs, 0);
      const sessionId = asString(parsed.sessionId);
      const parts = [
        `Copilot session ${sessionId || "(unknown)"} finished`,
        `premium requests: ${premiumRequests}`,
        ...(durationMs > 0 ? [`duration: ${(durationMs / 1000).toFixed(1)}s`] : []),
      ];
      return [{
        kind: "result",
        ts,
        text: parts.join(" · "),
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        costUsd: 0,
        subtype: exitCode === 0 ? "success" : "error",
        isError: exitCode !== 0,
        errors: [],
      }];
    }
    default:
      // Lifecycle/telemetry events (turn_start, idle, skills_loaded, …) are
      // not useful in the run transcript.
      return [];
  }
}
