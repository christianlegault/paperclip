import type { AdapterSessionCodec } from "@paperclipai/adapter-utils";
import { sanitizeCopilotSessionId } from "./parse.js";

export { execute, buildCopilotArgs, shouldForwardCopilotStdoutLine } from "./execute.js";
export { listCopilotSkills, syncCopilotSkills, buildCopilotSkillsMount } from "./skills.js";
export { testEnvironment } from "./test.js";
export {
  parseCopilotJsonl,
  isCopilotUnknownSessionError,
  firstCopilotDiagnosticLine,
  sanitizeCopilotSessionId,
} from "./parse.js";

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeSessionParams(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const sessionId = sanitizeCopilotSessionId(record.sessionId ?? record.session_id);
  if (!sessionId) return null;
  const cwd = readNonEmptyString(record.cwd);
  const workspaceId = readNonEmptyString(record.workspaceId);
  const repoUrl = readNonEmptyString(record.repoUrl);
  const repoRef = readNonEmptyString(record.repoRef);
  return {
    sessionId,
    ...(cwd ? { cwd } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(repoUrl ? { repoUrl } : {}),
    ...(repoRef ? { repoRef } : {}),
  };
}

export const sessionCodec: AdapterSessionCodec = {
  deserialize: normalizeSessionParams,
  serialize: normalizeSessionParams,
  getDisplayId(params) {
    if (!params) return null;
    return sanitizeCopilotSessionId(params.sessionId);
  },
};
