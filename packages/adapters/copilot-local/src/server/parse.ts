import { stripVTControlCharacters } from "node:util";
import { asNumber, asString, parseJson, parseObject } from "@paperclipai/adapter-utils/server-utils";

const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface CopilotCodeChanges {
  linesAdded: number;
  linesRemoved: number;
  filesModified: string[];
}

export interface CopilotUsageReport {
  premiumRequests: number;
  totalApiDurationMs: number;
  sessionDurationMs: number;
  codeChanges: CopilotCodeChanges;
}

export interface ParsedCopilotOutput {
  sessionId: string | null;
  model: string | null;
  summary: string;
  errorMessage: string | null;
  exitCode: number | null;
  usage: CopilotUsageReport | null;
  toolCallCount: number;
  sawResult: boolean;
}

/** Copilot session IDs are UUIDs today; accept a conservative token shape only. */
export function sanitizeCopilotSessionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return SESSION_ID_RE.test(trimmed) ? trimmed : null;
}

function readCodeChanges(value: unknown): CopilotCodeChanges {
  const rec = parseObject(value);
  return {
    linesAdded: asNumber(rec.linesAdded, 0),
    linesRemoved: asNumber(rec.linesRemoved, 0),
    filesModified: Array.isArray(rec.filesModified)
      ? rec.filesModified.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

function readErrorText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const rec = parseObject(value);
  return (
    asString(rec.message, "").trim() ||
    asString(rec.error, "").trim() ||
    asString(rec.errorMessage, "").trim() ||
    asString(rec.detail, "").trim()
  );
}

/**
 * Parse `copilot --output-format json` JSONL output.
 *
 * Verified event shapes (Copilot CLI 1.0.91):
 * - `session.tools_updated` { data.model }
 * - `assistant.message` { data.content, data.model, data.toolRequests[] }
 * - `tool.execution_start` / `tool.execution_complete`
 * - `session.error` / `error` { data.message }
 * - terminal `result` { sessionId, exitCode, usage { premiumRequests, ... } }
 */
export function parseCopilotJsonl(stdout: string): ParsedCopilotOutput {
  let sessionId: string | null = null;
  let model: string | null = null;
  let errorMessage: string | null = null;
  let exitCode: number | null = null;
  let usage: CopilotUsageReport | null = null;
  let lastAssistantText = "";
  let toolCallCount = 0;
  let sawResult = false;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const event = parseJson(line);
    if (!event) continue;

    const type = asString(event.type, "");
    const data = parseObject(event.data);

    switch (type) {
      case "session.tools_updated":
      case "session.model_changed": {
        const nextModel = asString(data.model, "").trim() || asString(data.newModel, "").trim();
        if (nextModel) model = nextModel;
        break;
      }
      case "assistant.message": {
        const content = asString(data.content, "").trim();
        if (content) lastAssistantText = content;
        const messageModel = asString(data.model, "").trim();
        if (messageModel) model = messageModel;
        break;
      }
      case "tool.execution_start": {
        toolCallCount += 1;
        break;
      }
      case "error":
      case "session.error": {
        const text = readErrorText(data) || readErrorText(event.error) || readErrorText(event.message);
        if (text) errorMessage = text;
        break;
      }
      case "result": {
        sawResult = true;
        sessionId = sanitizeCopilotSessionId(event.sessionId) ?? sessionId;
        if (typeof event.exitCode === "number") exitCode = event.exitCode;
        const usageRec = parseObject(event.usage);
        if (Object.keys(usageRec).length > 0) {
          usage = {
            premiumRequests: asNumber(usageRec.premiumRequests, 0),
            totalApiDurationMs: asNumber(usageRec.totalApiDurationMs, 0),
            sessionDurationMs: asNumber(usageRec.sessionDurationMs, 0),
            codeChanges: readCodeChanges(usageRec.codeChanges),
          };
        }
        const resultError = readErrorText(event.error);
        if (resultError) errorMessage = resultError;
        break;
      }
      default:
        break;
    }
  }

  return {
    sessionId,
    model,
    summary: lastAssistantText,
    errorMessage,
    exitCode,
    usage,
    toolCallCount,
    sawResult,
  };
}

/** First human-readable stderr line, skipping blank lines and ANSI noise. */
export function firstCopilotDiagnosticLine(text: string): string {
  for (const raw of text.split(/\r?\n/)) {
    const line = stripVTControlCharacters(raw).trim();
    if (!line) continue;
    return line.replace(/^Error:\s*/i, "");
  }
  return "";
}

export function isCopilotUnknownSessionError(stdout: string, stderr: string): boolean {
  const haystack = `${stdout}\n${stderr}`;
  return /no session, task, or name matched/i.test(haystack)
    || /session (?:not found|does not exist)/i.test(haystack);
}

export const COPILOT_AUTH_REQUIRED_RE =
  /(?:not\s+(?:logged|signed)\s+in|not\s+authenticated|authentication\s+(?:required|failed)|no\s+(?:valid\s+)?(?:github\s+)?(?:token|credentials)|run\s+'?copilot\s+login'?|please\s+(?:log|sign)\s+in|unauthorized|\b401\b|copilot\s+(?:subscription|access)\s+(?:is\s+)?(?:required|not\s+enabled))/i;
