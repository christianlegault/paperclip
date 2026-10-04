import { describe, expect, it } from "vitest";
import {
  firstCopilotDiagnosticLine,
  isCopilotUnknownSessionError,
  parseCopilotJsonl,
  sanitizeCopilotSessionId,
} from "./parse.js";
import { COPILOT_AUTH_REQUIRED_RE } from "./parse.js";
import { buildCopilotArgs, shouldForwardCopilotStdoutLine } from "./execute.js";
import { sessionCodec } from "./index.js";

// Trimmed from real `copilot --output-format json` output (Copilot CLI 1.0.91).
const REAL_STREAM = [
  { type: "session.tools_updated", data: { model: "gpt-5-mini" }, ephemeral: true },
  { type: "user.message", data: { content: "Read a.txt", turnId: "0" } },
  { type: "assistant.message_delta", data: { deltaContent: "Reading", messageId: "m1" }, ephemeral: true },
  {
    type: "assistant.message",
    data: {
      content: "Reading the file a.txt.",
      model: "gpt-5-mini",
      toolRequests: [{ toolCallId: "call_1", name: "view", arguments: { path: "/tmp/a.txt" } }],
    },
  },
  {
    type: "tool.execution_start",
    data: { toolCallId: "call_1", toolName: "view", arguments: { path: "/tmp/a.txt" } },
  },
  {
    type: "tool.execution_complete",
    data: { toolCallId: "call_1", success: true, result: { content: "hello\n" } },
  },
  { type: "assistant.message", data: { content: "hello", model: "gpt-5-mini", toolRequests: [] } },
  { type: "session.usage_checkpoint", data: { totalPremiumRequests: 0 }, ephemeral: true },
  {
    type: "result",
    sessionId: "225126f8-325f-4128-a993-6b5e100cb244",
    exitCode: 0,
    usage: {
      premiumRequests: 1,
      totalApiDurationMs: 5953,
      sessionDurationMs: 6807,
      codeChanges: { linesAdded: 2, linesRemoved: 1, filesModified: ["a.txt", 42] },
    },
  },
].map((event) => JSON.stringify(event)).join("\n");

describe("parseCopilotJsonl", () => {
  it("extracts session, model, final summary, tool count, and usage", () => {
    const parsed = parseCopilotJsonl(`${REAL_STREAM}\nnot json\n`);
    expect(parsed.sessionId).toBe("225126f8-325f-4128-a993-6b5e100cb244");
    expect(parsed.model).toBe("gpt-5-mini");
    expect(parsed.summary).toBe("hello");
    expect(parsed.toolCallCount).toBe(1);
    expect(parsed.exitCode).toBe(0);
    expect(parsed.sawResult).toBe(true);
    expect(parsed.errorMessage).toBeNull();
    expect(parsed.usage).toEqual({
      premiumRequests: 1,
      totalApiDurationMs: 5953,
      sessionDurationMs: 6807,
      codeChanges: { linesAdded: 2, linesRemoved: 1, filesModified: ["a.txt"] },
    });
  });

  it("captures error events and tolerates a missing result", () => {
    const parsed = parseCopilotJsonl(
      JSON.stringify({ type: "session.error", data: { message: "Model is not available" } }),
    );
    expect(parsed.errorMessage).toBe("Model is not available");
    expect(parsed.sawResult).toBe(false);
    expect(parsed.sessionId).toBeNull();
  });

  it("rejects malformed session ids from untrusted output", () => {
    const parsed = parseCopilotJsonl(JSON.stringify({ type: "result", sessionId: "../../etc/passwd" }));
    expect(parsed.sessionId).toBeNull();
    expect(sanitizeCopilotSessionId(" 11111111-2222-4333-8444-555555555555 ")).toBe(
      "11111111-2222-4333-8444-555555555555",
    );
    expect(sanitizeCopilotSessionId("--model")).toBeNull();
  });
});

describe("Copilot error detection", () => {
  it("detects the real unknown-session message", () => {
    expect(
      isCopilotUnknownSessionError(
        "",
        "Error: No session, task, or name matched '00000000-0000-4000-8000-000000000000'.",
      ),
    ).toBe(true);
    expect(isCopilotUnknownSessionError("", "Error: rate limited")).toBe(false);
  });

  it("strips the Error prefix for diagnostics", () => {
    expect(firstCopilotDiagnosticLine("\n\nError: No session matched 'x'.\nmore")).toBe("No session matched 'x'.");
  });

  it("recognizes auth failures", () => {
    expect(COPILOT_AUTH_REQUIRED_RE.test("You are not logged in. Run copilot login.")).toBe(true);
    expect(COPILOT_AUTH_REQUIRED_RE.test("Model is not available")).toBe(false);
  });
});

describe("buildCopilotArgs", () => {
  const base = {
    resumeSessionId: null,
    newSessionId: null,
    model: "",
    effort: null,
    maxAutopilotContinues: 0,
    agent: "",
    availableTools: [],
    excludedTools: [],
    additionalMcpConfig: "",
    noCustomInstructions: false,
    skillsDir: null,
    extraArgs: [],
  };

  it("always runs non-interactively with JSON output", () => {
    expect(buildCopilotArgs(base)).toEqual([
      "--output-format",
      "json",
      "--allow-all-tools",
      "--no-ask-user",
      "--no-auto-update",
    ]);
  });

  it("prefers resume over a new session id and maps optional flags", () => {
    const args = buildCopilotArgs({
      ...base,
      resumeSessionId: "sess-1",
      newSessionId: "ignored",
      model: "claude-sonnet-5",
      effort: "high",
      maxAutopilotContinues: 5,
      agent: "engineer",
      availableTools: ["bash", "view"],
      excludedTools: ["web_fetch"],
      additionalMcpConfig: "{\"mcpServers\":{}}",
      noCustomInstructions: true,
      skillsDir: "/tmp/skills",
      extraArgs: ["--log-level", "debug"],
    });
    expect(args).toContain("--resume");
    expect(args).not.toContain("--session-id");
    expect(args.join(" ")).toContain("--model claude-sonnet-5");
    expect(args.join(" ")).toContain("--reasoning-effort high");
    expect(args.join(" ")).toContain("--autopilot --max-autopilot-continues 5");
    expect(args).toContain("--available-tools=bash,view");
    expect(args).toContain("--excluded-tools=web_fetch");
    expect(args.join(" ")).toContain("--add-dir /tmp/skills");
    expect(args.slice(-2)).toEqual(["--log-level", "debug"]);
  });

  it("pins a fresh session id when not resuming", () => {
    const args = buildCopilotArgs({ ...base, newSessionId: "11111111-2222-4333-8444-555555555555" });
    expect(args.join(" ")).toContain("--session-id 11111111-2222-4333-8444-555555555555");
  });
});

describe("shouldForwardCopilotStdoutLine", () => {
  it("drops high-volume delta and telemetry events but keeps everything else", () => {
    expect(shouldForwardCopilotStdoutLine(JSON.stringify({ type: "assistant.message_delta" }))).toBe(false);
    expect(shouldForwardCopilotStdoutLine(JSON.stringify({ type: "session.usage_checkpoint" }))).toBe(false);
    expect(shouldForwardCopilotStdoutLine(JSON.stringify({ type: "assistant.message" }))).toBe(true);
    expect(shouldForwardCopilotStdoutLine("[paperclip] note")).toBe(true);
    expect(shouldForwardCopilotStdoutLine("   ")).toBe(false);
  });
});

describe("sessionCodec", () => {
  it("round-trips session params and drops invalid ids", () => {
    const params = { sessionId: "abc-123", cwd: "/work", workspaceId: "ws", ignored: true };
    const serialized = sessionCodec.serialize(params);
    expect(serialized).toEqual({ sessionId: "abc-123", cwd: "/work", workspaceId: "ws" });
    expect(sessionCodec.deserialize(serialized)).toEqual(serialized);
    expect(sessionCodec.getDisplayId?.(serialized)).toBe("abc-123");
    expect(sessionCodec.deserialize({ sessionId: "bad id with spaces" })).toBeNull();
    expect(sessionCodec.deserialize(null)).toBeNull();
  });
});
