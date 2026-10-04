export const type = "copilot_local";
export const label = "GitHub Copilot";

export const DEFAULT_COPILOT_LOCAL_MODEL = "auto";
export const DEFAULT_COPILOT_LOCAL_COMMAND = "copilot";

export const COPILOT_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type CopilotReasoningEffort = (typeof COPILOT_REASONING_EFFORTS)[number];

export function normalizeCopilotReasoningEffort(value: unknown): CopilotReasoningEffort | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (COPILOT_REASONING_EFFORTS as readonly string[]).includes(normalized)
    ? (normalized as CopilotReasoningEffort)
    : null;
}

// Mirrors `copilot help config` (Copilot CLI 1.0.x). The CLI also accepts any
// model id the signed-in account is entitled to, so this is a picker fallback,
// not an allowlist.
const COPILOT_MODEL_IDS = [
  "auto",
  "claude-sonnet-5",
  "claude-sonnet-5.5",
  "claude-opus-5.5",
  "claude-opus-5",
  "claude-opus-4.8",
  "claude-sonnet-4.6",
  "claude-haiku-4.5",
  "gpt-6.1-sol",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5-mini",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "grok-4.6",
  "grok-4.5",
];

export const models = COPILOT_MODEL_IDS.map((id) => ({
  id,
  label: id === "auto" ? "Auto (Copilot picks)" : id,
}));

export const agentConfigurationDoc = `# copilot_local agent configuration

Adapter: copilot_local

Use when:
- You want Paperclip to run the GitHub Copilot CLI (\`copilot\`) locally as the agent runtime
- The operator has a GitHub Copilot subscription and is signed in with \`copilot login\` (or provides COPILOT_GITHUB_TOKEN / GH_TOKEN)
- You want Copilot session resume across heartbeats (--resume <sessionId>)
- You want access to the models offered through Copilot (Claude, GPT, Gemini, Grok) behind one subscription

Don't use when:
- The Copilot CLI is not installed on the Paperclip host (install with \`npm install -g @github/copilot\` or \`brew install copilot-cli\`)
- You need remote sandbox or SSH execution (copilot_local supports local execution only)
- You only need one-shot shell commands (use process)
- You need webhook-style external invocation (use http or openclaw_gateway)

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process (created if missing when possible)
- instructionsFilePath (string, optional): absolute path to a markdown instructions file prepended to the run prompt
- promptTemplate (string, optional): run prompt template
- model (string, optional): Copilot model id passed as --model. Defaults to "auto" (Copilot picks).
- effort (string, optional): reasoning effort passed as --reasoning-effort (none|minimal|low|medium|high|xhigh|max)
- maxAutopilotContinues (number, optional): cap on autopilot continuations per heartbeat (--autopilot --max-autopilot-continues N). 0 or unset disables autopilot mode.
- agent (string, optional): Copilot custom agent name passed as --agent
- availableTools (string[], optional): tool allowlist passed as --available-tools
- excludedTools (string[], optional): tool denylist passed as --excluded-tools
- additionalMcpConfig (object|string, optional): extra MCP servers passed as --additional-mcp-config (JSON object or "@/path/to/file.json")
- noCustomInstructions (boolean, optional): pass --no-custom-instructions to skip AGENTS.md/.github instructions in the workspace
- command (string, optional): defaults to "copilot"
- extraArgs (string[], optional): additional CLI args appended last
- env (object, optional): KEY=VALUE environment variables (for example COPILOT_GITHUB_TOKEN)

Operational fields:
- timeoutSec (number, optional): run timeout in seconds (0 = no timeout)
- graceSec (number, optional): SIGTERM grace period in seconds

Notes:
- Runs are executed with: copilot --output-format json --allow-all-tools --no-ask-user ... and the prompt piped via stdin.
- --allow-all-tools is required for non-interactive mode, so the agent can run any tool (shell, file edits, network) inside its working directory without confirmation. Restrict with availableTools/excludedTools when the role does not need full access.
- Sessions resume with --resume when the stored session cwd matches the current cwd; unknown sessions are retried fresh automatically.
- Paperclip skills are mounted for each run through a temporary directory passed with --add-dir (Copilot loads its .github/skills). Nothing is written to the agent cwd or ~/.copilot.
- Copilot reports premium requests rather than token counts; usage is recorded in resultJson and billed as a subscription.
`;
