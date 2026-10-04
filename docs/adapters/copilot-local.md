---
title: GitHub Copilot CLI
summary: GitHub Copilot CLI local adapter setup and configuration
---

The `copilot_local` adapter runs the [GitHub Copilot CLI](https://github.com/github/copilot-cli) (`copilot`) locally. It supports session persistence with `--resume`, ephemeral Paperclip skills mounting, and structured `--output-format json` (JSONL) parsing.

## Prerequisites

- GitHub Copilot CLI installed (`npm install -g @github/copilot` or `brew install copilot-cli`), so the `copilot` command is on the server's `PATH`
- An active GitHub Copilot subscription, signed in with `copilot login` (or `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` set in the agent env)
- Local execution only — this adapter does not run in SSH or sandbox environments

## Configuration Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cwd` | string | No | Working directory fallback for the agent process (absolute path; created automatically if missing when permissions allow) |
| `model` | string | No | Copilot model id passed as `--model`. Defaults to `auto` (Copilot picks). |
| `effort` | string | No | Reasoning effort passed as `--reasoning-effort` (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`) |
| `maxAutopilotContinues` | number | No | Enables `--autopilot` with this many continuations per heartbeat. `0`/unset disables autopilot. |
| `agent` | string | No | Copilot custom agent name passed as `--agent` |
| `availableTools` | string[] | No | Tool allowlist passed as `--available-tools` |
| `excludedTools` | string[] | No | Tool denylist passed as `--excluded-tools` |
| `additionalMcpConfig` | object \| string | No | Extra MCP servers passed as `--additional-mcp-config` (JSON object or `@/path/to/file.json`) |
| `noCustomInstructions` | boolean | No | Pass `--no-custom-instructions` to skip workspace `AGENTS.md` / `.github` instructions |
| `promptTemplate` | string | No | Prompt used for all runs |
| `instructionsFilePath` | string | No | Markdown instructions file prepended to the prompt |
| `command` | string | No | CLI command. Defaults to `copilot`. |
| `extraArgs` | string[] | No | Additional CLI args appended last |
| `env` | object | No | Environment variables (supports secret refs) |
| `timeoutSec` | number | No | Process timeout (0 = no timeout) |
| `graceSec` | number | No | Grace period before force-kill |

## Execution

Each heartbeat runs:

```sh
copilot --output-format json --allow-all-tools --no-ask-user --no-auto-update \
  [--resume <sessionId> | --session-id <new-uuid>] [--model <model>] [--add-dir <skills-mount>] ...
```

The prompt is piped through stdin. Copilot requires pre-approved tools in non-interactive mode, so `--allow-all-tools` is always passed; narrow access with `availableTools` / `excludedTools` when an agent role does not need shell or network tools.

## Session Persistence

New sessions are created with a Paperclip-generated `--session-id`, and the session ID is persisted between heartbeats. On the next wake, the adapter resumes the conversation with `--resume` so the agent retains context. Copilot manages its own context compaction, so Paperclip does not rotate sessions on thresholds.

Session resume is cwd-aware: if the working directory changed since the last run, a fresh session starts instead. If resume fails with Copilot's `No session, task, or name matched` error, the adapter automatically retries with a fresh session.

## Skills Injection

For each run, the adapter builds a temporary directory containing `.github/skills/` symlinks to the desired Paperclip skills and passes it with `--add-dir`, which Copilot loads as trusted skills. The directory is removed after the run. Nothing is written to the agent's working directory or `~/.copilot`.

## Usage and Billing

Copilot reports premium requests rather than token counts. Runs are recorded as `subscription` billing with biller `github`; premium requests, API duration, and code-change stats are stored under `resultJson.copilot`.

## Environment Test

Use the "Test Environment" button in the UI to validate the adapter config. It checks:

- Working directory is absolute and available (auto-created if missing and permitted)
- `copilot` is installed and accessible (`copilot --version`)
- Which credential source Copilot will use (`COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN`, or the `copilot login` session)
- A live hello probe (`copilot --output-format json --allow-all-tools --no-ask-user -p "Respond with hello."`) to verify CLI readiness and authentication
