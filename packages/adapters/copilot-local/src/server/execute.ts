import { createProviderStoppedBoundary } from "@paperclipai/adapter-utils/provider-stopped-boundary";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import {
  adapterExecutionTargetIsRemote,
  ensureAdapterExecutionTargetCommandResolvable,
  readAdapterExecutionTarget,
  resolveAdapterExecutionTargetCommandForLogs,
  runAdapterExecutionTargetProcess,
} from "@paperclipai/adapter-utils/execution-target";
import {
  asBoolean,
  asNumber,
  asString,
  asStringArray,
  buildInvocationEnvForLogs,
  buildPaperclipEnv,
  buildRuntimeToolsEnv,
  DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  DEFAULT_PAPERCLIP_CONVERSATION_PROMPT_TEMPLATE,
  ensureAbsoluteDirectory,
  ensurePathInEnv,
  hydrateFreshSessionHandoff,
  isPaperclipRecoveryWakePayload,
  joinPromptSections,
  parseObject,
  readPaperclipIssueWorkModeFromContext,
  refreshPaperclipWorkspaceEnvForExecution,
  renderTemplate,
  selectInitialCommunicationGuidance,
  selectPaperclipPromptSections,
} from "@paperclipai/adapter-utils/server-utils";
import {
  DEFAULT_COPILOT_LOCAL_COMMAND,
  DEFAULT_COPILOT_LOCAL_MODEL,
  normalizeCopilotReasoningEffort,
} from "../index.js";
import {
  firstCopilotDiagnosticLine,
  isCopilotUnknownSessionError,
  parseCopilotJsonl,
  sanitizeCopilotSessionId,
} from "./parse.js";
import { buildCopilotSkillsMount } from "./skills.js";

// High-volume streaming/telemetry events that the transcript does not render.
// The full stream is still captured in proc.stdout for parsing.
const NOISY_STREAM_EVENT_TYPES = new Set([
  "assistant.message_delta",
  "assistant.tool_call_delta",
  "assistant.reasoning_delta",
  "session.usage_checkpoint",
  "model.call_start",
  "model.call_finished",
  "model.call_final_result",
]);

const STDERR_RESULT_MAX_CHARS = 8_000;

function readNonEmptyContextString(context: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = context[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function resolveProviderFromModel(model: string): string | null {
  const trimmed = model.trim().toLowerCase();
  if (!trimmed || trimmed === "auto") return null;
  if (trimmed.startsWith("claude")) return "anthropic";
  if (trimmed.startsWith("gpt") || /^o\d/.test(trimmed)) return "openai";
  if (trimmed.startsWith("gemini")) return "google";
  if (trimmed.startsWith("grok")) return "xai";
  return null;
}

function renderPaperclipEnvNote(env: Record<string, string>): string {
  const paperclipKeys = Object.keys(env)
    .filter((key) => key.startsWith("PAPERCLIP_"))
    .sort();
  if (paperclipKeys.length === 0) return "";
  return [
    "Paperclip runtime note:",
    `The following PAPERCLIP_* environment variables are available in this run: ${paperclipKeys.join(", ")}`,
    "Do not assume these variables are missing without checking your shell environment.",
    "",
    "",
  ].join("\n");
}

function serializeMcpConfig(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return "";
}

export function shouldForwardCopilotStdoutLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (!trimmed.startsWith("{")) return true;
  try {
    const parsed = JSON.parse(trimmed) as { type?: unknown };
    return !(typeof parsed.type === "string" && NOISY_STREAM_EVENT_TYPES.has(parsed.type));
  } catch {
    return true;
  }
}

export type CopilotArgsOptions = {
  resumeSessionId: string | null;
  newSessionId: string | null;
  model: string;
  effort: string | null;
  maxAutopilotContinues: number;
  agent: string;
  availableTools: string[];
  excludedTools: string[];
  additionalMcpConfig: string;
  noCustomInstructions: boolean;
  skillsDir: string | null;
  extraArgs: string[];
};

export function buildCopilotArgs(options: CopilotArgsOptions): string[] {
  const args = ["--output-format", "json", "--allow-all-tools", "--no-ask-user", "--no-auto-update"];
  if (options.resumeSessionId) {
    args.push("--resume", options.resumeSessionId);
  } else if (options.newSessionId) {
    args.push("--session-id", options.newSessionId);
  }
  if (options.model) args.push("--model", options.model);
  if (options.effort) args.push("--reasoning-effort", options.effort);
  if (options.maxAutopilotContinues > 0) {
    args.push("--autopilot", "--max-autopilot-continues", String(options.maxAutopilotContinues));
  }
  if (options.agent) args.push("--agent", options.agent);
  if (options.noCustomInstructions) args.push("--no-custom-instructions");
  if (options.availableTools.length > 0) args.push(`--available-tools=${options.availableTools.join(",")}`);
  if (options.excludedTools.length > 0) args.push(`--excluded-tools=${options.excludedTools.join(",")}`);
  if (options.additionalMcpConfig) args.push("--additional-mcp-config", options.additionalMcpConfig);
  if (options.skillsDir) args.push("--add-dir", options.skillsDir);
  if (options.extraArgs.length > 0) args.push(...options.extraArgs);
  return args;
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const providerStop = createProviderStoppedBoundary(ctx.onProviderStopped);
  const { runId, agent, runtime, config, context, onLog, onMeta, onSpawn, authToken } = ctx;
  const executionTarget = readAdapterExecutionTarget({
    executionTarget: ctx.executionTarget,
    legacyRemoteExecution: ctx.executionTransport?.remoteExecution,
  });
  if (adapterExecutionTargetIsRemote(executionTarget)) {
    return {
      exitCode: null,
      signal: null,
      timedOut: false,
      errorMessage:
        "The GitHub Copilot adapter (copilot_local) supports local execution only. Move this agent to a local environment.",
    };
  }

  const promptTemplate = asString(
    config.promptTemplate,
    context.conversationMode === true
      ? DEFAULT_PAPERCLIP_CONVERSATION_PROMPT_TEMPLATE
      : DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  );
  const command = asString(config.command, DEFAULT_COPILOT_LOCAL_COMMAND);
  const model = asString(config.model, DEFAULT_COPILOT_LOCAL_MODEL).trim();
  const effort = normalizeCopilotReasoningEffort(config.effort);
  const maxAutopilotContinues = Math.max(0, Math.floor(asNumber(config.maxAutopilotContinues, 0)));
  const copilotAgent = asString(config.agent, "").trim();
  const availableTools = asStringArray(config.availableTools);
  const excludedTools = asStringArray(config.excludedTools);
  const additionalMcpConfig = serializeMcpConfig(config.additionalMcpConfig);
  const noCustomInstructions = asBoolean(config.noCustomInstructions, false);
  const extraArgs = (() => {
    const fromExtraArgs = asStringArray(config.extraArgs);
    if (fromExtraArgs.length > 0) return fromExtraArgs;
    return asStringArray(config.args);
  })();

  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const workspaceSource = asString(workspaceContext.source, "");
  const workspaceId = asString(workspaceContext.workspaceId, "");
  const workspaceRepoUrl = asString(workspaceContext.repoUrl, "");
  const workspaceRepoRef = asString(workspaceContext.repoRef, "");
  const agentHome = asString(workspaceContext.agentHome, "");
  const workspaceHints = Array.isArray(context.paperclipWorkspaces)
    ? context.paperclipWorkspaces.filter(
        (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
      )
    : [];
  const configuredCwd = asString(config.cwd, "");
  const useConfiguredInsteadOfAgentHome = workspaceSource === "agent_home" && configuredCwd.length > 0;
  const effectiveWorkspaceCwd = useConfiguredInsteadOfAgentHome ? "" : workspaceCwd;
  const cwd = effectiveWorkspaceCwd || configuredCwd || process.cwd();
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = {
    ...buildPaperclipEnv(agent),
    ...buildRuntimeToolsEnv(ctx.runtimeTools),
  };
  env.PAPERCLIP_RUN_ID = runId;
  const wakeTaskId = readNonEmptyContextString(context, "taskId", "issueId");
  const wakeReason = readNonEmptyContextString(context, "wakeReason");
  const wakeCommentId = readNonEmptyContextString(context, "wakeCommentId", "commentId");
  const approvalId = readNonEmptyContextString(context, "approvalId");
  const approvalStatus = readNonEmptyContextString(context, "approvalStatus");
  const linkedIssueIds = Array.isArray(context.issueIds)
    ? context.issueIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const issueWorkMode = readPaperclipIssueWorkModeFromContext(context);
  if (wakeTaskId) env.PAPERCLIP_TASK_ID = wakeTaskId;
  if (issueWorkMode) env.PAPERCLIP_ISSUE_WORK_MODE = issueWorkMode;
  if (wakeReason) env.PAPERCLIP_WAKE_REASON = wakeReason;
  if (wakeCommentId) env.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;
  if (approvalId) env.PAPERCLIP_APPROVAL_ID = approvalId;
  if (approvalStatus) env.PAPERCLIP_APPROVAL_STATUS = approvalStatus;
  if (linkedIssueIds.length > 0) env.PAPERCLIP_LINKED_ISSUE_IDS = linkedIssueIds.join(",");
  refreshPaperclipWorkspaceEnvForExecution({
    env,
    envConfig,
    workspaceCwd: effectiveWorkspaceCwd,
    workspaceSource,
    workspaceId,
    workspaceRepoUrl,
    workspaceRepoRef,
    workspaceHints,
    agentHome,
    executionTargetIsRemote: false,
    executionCwd: cwd,
  });
  if (authToken) env.PAPERCLIP_API_KEY = authToken;

  const timeoutSec = Math.max(0, asNumber(config.timeoutSec, 0));
  const graceSec = Math.max(1, asNumber(config.graceSec, 20));

  const runtimeEnv = ensurePathInEnv(
    Object.fromEntries(
      Object.entries({ ...process.env, ...env }).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  );
  await ensureAdapterExecutionTargetCommandResolvable(command, executionTarget, cwd, runtimeEnv);
  const resolvedCommand = await resolveAdapterExecutionTargetCommandForLogs(command, executionTarget, cwd, runtimeEnv);
  const loggedEnv = buildInvocationEnvForLogs(env, {
    runtimeEnv,
    includeRuntimeKeys: ["HOME"],
    resolvedCommand,
  });

  const runtimeSessionParams = parseObject(runtime.sessionParams);
  const runtimeSessionId = sanitizeCopilotSessionId(
    asString(runtimeSessionParams.sessionId, runtime.sessionId ?? ""),
  ) ?? "";
  const runtimeSessionCwd = asString(runtimeSessionParams.cwd, "");
  const canResumeSession =
    runtimeSessionId.length > 0 &&
    (runtimeSessionCwd.length === 0 || path.resolve(runtimeSessionCwd) === path.resolve(cwd));
  const sessionId = canResumeSession ? runtimeSessionId : null;
  if (runtimeSessionId && !canResumeSession) {
    await onLog(
      "stdout",
      `[paperclip] Copilot session "${runtimeSessionId}" was saved for cwd "${runtimeSessionCwd}" and will not be resumed in "${cwd}".\n`,
    );
  }

  const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
  const instructionsDir = instructionsFilePath ? `${path.dirname(instructionsFilePath)}/` : "";
  let instructionsPrefix = "";
  if (instructionsFilePath) {
    try {
      const instructionsContents = await fs.readFile(instructionsFilePath, "utf8");
      instructionsPrefix =
        `${instructionsContents}\n\n` +
        `The above agent instructions were loaded from ${instructionsFilePath}. ` +
        `Resolve any relative file references from ${instructionsDir}.\n\n`;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await onLog(
        "stdout",
        `[paperclip] Warning: could not read agent instructions file "${instructionsFilePath}": ${reason}\n`,
      );
    }
  }

  const bootstrapPromptTemplate = asString(config.bootstrapPromptTemplate, "");
  const templateData = {
    agentId: agent.id,
    companyId: agent.companyId,
    runId,
    company: { id: agent.companyId },
    agent,
    run: { id: runId, source: "on_demand" },
    context,
  };
  const buildPrompt = (resumedSession: boolean) => {
    const renderedBootstrapPrompt =
      !resumedSession && bootstrapPromptTemplate.trim().length > 0
        ? renderTemplate(bootstrapPromptTemplate, templateData).trim()
        : "";
    const { taskContextNote, wakePrompt } = selectPaperclipPromptSections(context, {
      resumedSession,
      includeCommunicationGuidance: false,
    });
    const shouldUseResumeDeltaPrompt = resumedSession && wakePrompt.length > 0;
    const renderedPrompt = shouldUseResumeDeltaPrompt || isPaperclipRecoveryWakePayload(context.paperclipWake)
      ? ""
      : renderTemplate(promptTemplate, templateData);
    const sessionHandoffNote = asString(context.paperclipSessionHandoffMarkdown, "").trim();
    const paperclipEnvNote = renderPaperclipEnvNote(env);
    const basePrompt = joinPromptSections([
      instructionsPrefix,
      renderedBootstrapPrompt,
      wakePrompt,
      taskContextNote,
      sessionHandoffNote,
      paperclipEnvNote,
      renderedPrompt,
    ]);
    return {
      basePrompt,
      promptMetrics: {
        promptChars: basePrompt.length,
        instructionsChars: instructionsPrefix.length,
        bootstrapPromptChars: renderedBootstrapPrompt.length,
        wakePromptChars: wakePrompt.length,
        taskContextChars: taskContextNote.length,
        sessionHandoffChars: sessionHandoffNote.length,
        runtimeNoteChars: paperclipEnvNote.length,
        heartbeatPromptChars: renderedPrompt.length,
      },
    };
  };

  let skillsMount: Awaited<ReturnType<typeof buildCopilotSkillsMount>> = null;
  try {
    skillsMount = await buildCopilotSkillsMount(config);
  } catch (err) {
    await onLog(
      "stderr",
      `[paperclip] Failed to mount Paperclip skills for Copilot: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  const commandNotes = [
    "Prompt is piped to Copilot via stdin.",
    "Runs with --allow-all-tools --no-ask-user because Copilot non-interactive mode requires pre-approved tools.",
    ...(skillsMount
      ? [`Mounted ${skillsMount.skillNames.length} Paperclip skill(s) via --add-dir ${skillsMount.dir}.`]
      : []),
    ...(instructionsFilePath && instructionsPrefix
      ? [`Loaded agent instructions from ${instructionsFilePath}.`]
      : []),
  ];

  const runAttempt = async (resumeSessionId: string | null) => {
    await hydrateFreshSessionHandoff(ctx, { resumedSession: Boolean(resumeSessionId) });
    const { basePrompt, promptMetrics } = buildPrompt(Boolean(resumeSessionId));
    const prompt = joinPromptSections([
      selectInitialCommunicationGuidance(context, { resumedSession: Boolean(resumeSessionId) }),
      basePrompt,
    ]);
    const newSessionId = resumeSessionId ? null : randomUUID();
    const args = buildCopilotArgs({
      resumeSessionId,
      newSessionId,
      model,
      effort,
      maxAutopilotContinues,
      agent: copilotAgent,
      availableTools,
      excludedTools,
      additionalMcpConfig,
      noCustomInstructions,
      skillsDir: skillsMount?.dir ?? null,
      extraArgs,
    });
    if (onMeta) {
      await onMeta({
        adapterType: "copilot_local",
        command: resolvedCommand,
        cwd,
        commandNotes,
        commandArgs: args,
        env: loggedEnv,
        prompt,
        promptMetrics: { ...promptMetrics, promptChars: prompt.length },
        context,
      });
    }

    let stdoutLineBuffer = "";
    const forwardStdout = async (chunk: string, finalize = false) => {
      const combined = `${stdoutLineBuffer}${chunk}`;
      const lines = combined.split(/\r?\n/);
      stdoutLineBuffer = finalize ? "" : lines.pop() ?? "";
      for (const line of lines) {
        if (shouldForwardCopilotStdoutLine(line)) await onLog("stdout", `${line.trim()}\n`);
      }
    };

    const proc = await runAdapterExecutionTargetProcess(runId, executionTarget, command, args, {
      onProcessStopped: providerStop.beginInvocation(),
      cwd,
      env,
      timeoutSec,
      graceSec,
      stdin: prompt,
      onSpawn,
      onRuntimeProgress: ctx.onRuntimeProgress,
      onLog: async (stream, chunk) => {
        if (stream !== "stdout") {
          await onLog(stream, chunk);
          return;
        }
        await forwardStdout(chunk);
      },
    });
    await forwardStdout("", true);

    return { proc, parsed: parseCopilotJsonl(proc.stdout), newSessionId };
  };

  const toResult = (
    attempt: Awaited<ReturnType<typeof runAttempt>>,
    clearSessionOnMissingSession = false,
  ): AdapterExecutionResult => {
    const { proc, parsed } = attempt;
    if (proc.timedOut) {
      return {
        exitCode: proc.exitCode,
        signal: proc.signal,
        timedOut: true,
        errorMessage: `Timed out after ${timeoutSec}s`,
        clearSession: clearSessionOnMissingSession,
      };
    }

    const resolvedSessionId =
      parsed.sessionId ?? attempt.newSessionId ?? (clearSessionOnMissingSession ? null : sessionId);
    const resolvedSessionParams = resolvedSessionId
      ? ({
          sessionId: resolvedSessionId,
          cwd,
          ...(workspaceId ? { workspaceId } : {}),
          ...(workspaceRepoUrl ? { repoUrl: workspaceRepoUrl } : {}),
          ...(workspaceRepoRef ? { repoRef: workspaceRepoRef } : {}),
        } as Record<string, unknown>)
      : null;
    const failed = (proc.exitCode ?? 0) !== 0;
    const errorMessage = failed
      ? parsed.errorMessage?.trim()
        || firstCopilotDiagnosticLine(proc.stderr)
        || `Copilot exited with code ${proc.exitCode ?? -1}`
      : null;
    const resolvedModel = parsed.model ?? model;
    const provider = resolveProviderFromModel(resolvedModel);
    const stderrTail = proc.stderr.length > STDERR_RESULT_MAX_CHARS
      ? proc.stderr.slice(-STDERR_RESULT_MAX_CHARS)
      : proc.stderr;

    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: false,
      errorMessage,
      errorCode: proc.errorCode ?? null,
      sessionId: resolvedSessionId,
      sessionParams: resolvedSessionParams,
      sessionDisplayId: resolvedSessionId,
      provider: provider ?? "github",
      biller: "github",
      billingType: "subscription",
      model: resolvedModel,
      resultJson: {
        copilot: {
          premiumRequests: parsed.usage?.premiumRequests ?? null,
          totalApiDurationMs: parsed.usage?.totalApiDurationMs ?? null,
          sessionDurationMs: parsed.usage?.sessionDurationMs ?? null,
          codeChanges: parsed.usage?.codeChanges ?? null,
          toolCallCount: parsed.toolCallCount,
        },
        ...(parsed.sawResult ? {} : { stdout: proc.stdout }),
        stderr: stderrTail,
      },
      summary: parsed.summary,
      clearSession: Boolean(clearSessionOnMissingSession && !resolvedSessionId),
    };
  };

  try {
    const initial = await runAttempt(sessionId);
    if (
      sessionId &&
      !initial.proc.timedOut &&
      (initial.proc.exitCode ?? 0) !== 0 &&
      isCopilotUnknownSessionError(initial.proc.stdout, initial.proc.stderr)
    ) {
      await onLog(
        "stdout",
        `[paperclip] Copilot resume session "${sessionId}" is unavailable; retrying with a fresh session.\n`,
      );
      const retry = await runAttempt(null);
      return toResult(retry, true);
    }
    return toResult(initial);
  } finally {
    try {
      await providerStop.collectBeforeRestore();
    } finally {
      if (skillsMount) {
        await fs.rm(skillsMount.dir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }
}
