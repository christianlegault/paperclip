import { describe, expect, it } from "vitest";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import { buildCopilotLocalConfig } from "./build-config.js";
import { parseCopilotStdoutLine } from "./parse-stdout.js";

const TS = "2026-10-04T16:09:11.850Z";

describe("buildCopilotLocalConfig", () => {
  const values = {
    adapterType: "copilot_local",
    cwd: "/work",
    instructionsFilePath: "/work/AGENTS.md",
    model: "",
    thinkingEffort: "HIGH",
    command: "",
    extraArgs: "--log-level, debug",
    envVars: "",
    envBindings: {},
  } as unknown as CreateConfigValues;

  it("defaults the model to auto and normalizes effort", () => {
    expect(buildCopilotLocalConfig(values)).toEqual({
      cwd: "/work",
      instructionsFilePath: "/work/AGENTS.md",
      model: "auto",
      effort: "high",
      timeoutSec: 0,
      graceSec: 15,
      extraArgs: ["--log-level", "debug"],
    });
  });

  it("drops unknown effort values", () => {
    const config = buildCopilotLocalConfig({ ...values, thinkingEffort: "ultra", model: "gpt-5.5" });
    expect(config.effort).toBeUndefined();
    expect(config.model).toBe("gpt-5.5");
  });
});

describe("parseCopilotStdoutLine", () => {
  const line = (event: unknown) => JSON.stringify(event);

  it("maps assistant messages, tool calls, and tool results", () => {
    expect(
      parseCopilotStdoutLine(line({ type: "assistant.message", data: { content: "hello", messageId: "m1" } }), TS),
    ).toEqual([{ kind: "assistant", ts: TS, text: "hello", itemId: "m1" }]);

    expect(
      parseCopilotStdoutLine(
        line({ type: "tool.execution_start", data: { toolCallId: "c1", toolName: "view", arguments: { path: "a" } } }),
        TS,
      ),
    ).toEqual([{ kind: "tool_call", ts: TS, name: "view", input: { path: "a" }, toolUseId: "c1" }]);

    expect(
      parseCopilotStdoutLine(
        line({ type: "tool.execution_complete", data: { toolCallId: "c1", success: false, result: { content: "boom" } } }),
        TS,
      ),
    ).toEqual([{ kind: "tool_result", ts: TS, toolUseId: "c1", content: "boom", isError: true }]);
  });

  it("summarizes the terminal result event", () => {
    const [entry] = parseCopilotStdoutLine(
      line({ type: "result", sessionId: "s1", exitCode: 0, usage: { premiumRequests: 2, sessionDurationMs: 1500 } }),
      TS,
    );
    expect(entry).toMatchObject({ kind: "result", isError: false, subtype: "success" });
    expect(entry && "text" in entry ? entry.text : "").toContain("premium requests: 2");
  });

  it("hides lifecycle noise and passes through plain text", () => {
    expect(parseCopilotStdoutLine(line({ type: "assistant.turn_start", data: {} }), TS)).toEqual([]);
    expect(parseCopilotStdoutLine("[paperclip] note", TS)).toEqual([
      { kind: "stdout", ts: TS, text: "[paperclip] note" },
    ]);
  });
});
