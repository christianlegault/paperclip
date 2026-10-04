import pc from "picocolors";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
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

export function printCopilotStreamEvent(raw: string, debug: boolean): void {
  const line = raw.trim();
  if (!line) return;

  let parsed: Record<string, unknown>;
  try {
    parsed = asRecord(JSON.parse(line));
  } catch {
    console.log(line);
    return;
  }

  const type = asString(parsed.type);
  const data = asRecord(parsed.data);

  switch (type) {
    case "session.tools_updated": {
      const model = asString(data.model);
      if (model) console.log(pc.blue(`Copilot model: ${model}`));
      return;
    }
    case "assistant.message": {
      const content = asString(data.content).trim();
      if (content) console.log(pc.green(`assistant: ${content}`));
      return;
    }
    case "assistant.reasoning": {
      const content = asString(data.content).trim();
      if (content) console.log(pc.gray(`thinking: ${content}`));
      return;
    }
    case "tool.execution_start": {
      console.log(pc.yellow(`tool_call: ${asString(data.toolName, "tool")}`));
      const args = stringifyUnknown(data.arguments);
      if (args) console.log(pc.gray(args));
      return;
    }
    case "tool.execution_complete": {
      const failed = data.success === false;
      const content = asString(asRecord(data.result).content).trim();
      console.log((failed ? pc.red : pc.cyan)(failed ? "tool_result: error" : "tool_result"));
      if (content) console.log(pc.gray(content));
      return;
    }
    case "error":
    case "session.error": {
      console.log(pc.red(`error: ${asString(data.message) || stringifyUnknown(data)}`));
      return;
    }
    case "result": {
      const usage = asRecord(parsed.usage);
      const sessionId = asString(parsed.sessionId);
      const premium = typeof usage.premiumRequests === "number" ? usage.premiumRequests : 0;
      console.log(pc.blue(`Copilot session ${sessionId || "(unknown)"} finished · premium requests: ${premium}`));
      return;
    }
    default:
      if (debug) console.log(pc.gray(line));
  }
}
