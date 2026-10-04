import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import {
  asNumber,
  asString,
  asStringArray,
  ensurePathInEnv,
  parseObject,
} from "@paperclipai/adapter-utils/server-utils";
import {
  ensureAdapterExecutionTargetCommandResolvable,
  ensureAdapterExecutionTargetDirectory,
  runAdapterExecutionTargetProcess,
} from "@paperclipai/adapter-utils/execution-target";
import { DEFAULT_COPILOT_LOCAL_COMMAND, DEFAULT_COPILOT_LOCAL_MODEL } from "../index.js";
import {
  COPILOT_AUTH_REQUIRED_RE,
  firstCopilotDiagnosticLine,
  parseCopilotJsonl,
} from "./parse.js";

const COPILOT_TOKEN_ENV_KEYS = ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"] as const;
const HELLO_PROBE_COMMAND_HINT =
  "copilot --output-format json --allow-all-tools --no-ask-user -p \"Respond with hello.\"";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function summarizeDetail(text: string | null | undefined): string | null {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > 240 ? `${clean.slice(0, 239)}…` : clean;
}

function isDefaultCopilotCommand(command: string): boolean {
  const base = command.trim().split(/[\\/]/).pop() ?? "";
  return base === "copilot" || base === "copilot.exe";
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.command, DEFAULT_COPILOT_LOCAL_COMMAND);
  const target = ctx.executionTarget ?? null;
  const done = (): AdapterEnvironmentTestResult => ({
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  });

  if (target?.kind === "remote") {
    checks.push({
      code: "copilot_remote_unsupported",
      level: "error",
      message: "GitHub Copilot (copilot_local) supports local execution only.",
      hint: "Select a local environment for this agent.",
    });
    return done();
  }

  const cwd = asString(config.cwd, "") || process.cwd();
  const runId = `copilot-envtest-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  try {
    await ensureAdapterExecutionTargetDirectory(runId, target, cwd, {
      cwd,
      env: {},
      createIfMissing: true,
    });
    checks.push({
      code: "copilot_cwd_valid",
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch (err) {
    checks.push({
      code: "copilot_cwd_invalid",
      level: "error",
      message: err instanceof Error ? err.message : "Invalid working directory",
      detail: cwd,
    });
  }

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }
  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });

  try {
    await ensureAdapterExecutionTargetCommandResolvable(command, target, cwd, runtimeEnv);
    checks.push({
      code: "copilot_command_resolvable",
      level: "info",
      message: `Command is executable: ${command}`,
    });
  } catch (err) {
    checks.push({
      code: "copilot_command_unresolvable",
      level: "error",
      message: err instanceof Error ? err.message : "Command is not executable",
      detail: command,
      hint: "Install the GitHub Copilot CLI with `npm install -g @github/copilot` (or `brew install copilot-cli`), then run `copilot login`.",
    });
  }

  const configuredTokenKey = COPILOT_TOKEN_ENV_KEYS.find((key) => isNonEmpty(env[key]));
  const hostTokenKey = COPILOT_TOKEN_ENV_KEYS.find((key) => isNonEmpty(process.env[key]));
  if (configuredTokenKey) {
    checks.push({
      code: "copilot_token_configured",
      level: "info",
      message: `${configuredTokenKey} is set in adapter env for Copilot authentication.`,
    });
  } else if (hostTokenKey) {
    checks.push({
      code: "copilot_token_ambient",
      level: "info",
      message: `${hostTokenKey} is set in the server environment; Copilot may use it instead of your \`copilot login\` session.`,
    });
  } else {
    checks.push({
      code: "copilot_auth_login_expected",
      level: "info",
      message: "No Copilot token env var is set; Copilot will use the account from `copilot login`.",
    });
  }

  const canProbe = checks.every(
    (check) => check.code !== "copilot_cwd_invalid" && check.code !== "copilot_command_unresolvable",
  );
  if (!canProbe) return done();

  if (!isDefaultCopilotCommand(command)) {
    checks.push({
      code: "copilot_hello_probe_skipped_custom_command",
      level: "info",
      message: "Skipped hello probe because command is not the default Copilot CLI entrypoint.",
      detail: command,
    });
    return done();
  }

  const versionProbe = await runAdapterExecutionTargetProcess(runId, target, command, ["--version"], {
    cwd,
    env,
    timeoutSec: Math.max(1, asNumber(config.versionProbeTimeoutSec, 30)),
    graceSec: 5,
    onLog: async () => {},
  });
  const versionDetail = summarizeDetail(
    firstCopilotDiagnosticLine(versionProbe.stdout) || firstCopilotDiagnosticLine(versionProbe.stderr),
  );
  if (versionProbe.timedOut || (versionProbe.exitCode ?? 1) !== 0) {
    checks.push({
      code: versionProbe.timedOut ? "copilot_version_probe_timed_out" : "copilot_version_probe_failed",
      level: "error",
      message: versionProbe.timedOut ? "Copilot version probe timed out." : "Copilot version probe failed.",
      ...(versionDetail ? { detail: versionDetail } : {}),
      hint: "Run `copilot --version` manually to confirm the CLI works non-interactively.",
    });
    return done();
  }
  checks.push({
    code: "copilot_version_probe_passed",
    level: "info",
    message: "Copilot version probe succeeded.",
    ...(versionDetail ? { detail: versionDetail } : {}),
  });

  const model = asString(config.model, DEFAULT_COPILOT_LOCAL_MODEL).trim();
  const args = ["--output-format", "json", "--allow-all-tools", "--no-ask-user", "--no-auto-update"];
  if (model) args.push("--model", model);
  const extraArgs = asStringArray(config.extraArgs);
  if (extraArgs.length > 0) args.push(...extraArgs);
  args.push("-p", "Respond with hello. Do not use any tools.");

  const probe = await runAdapterExecutionTargetProcess(runId, target, command, args, {
    cwd,
    env,
    timeoutSec: Math.max(1, asNumber(config.helloProbeTimeoutSec, 90)),
    graceSec: 5,
    onLog: async () => {},
  });
  const parsed = parseCopilotJsonl(probe.stdout);
  const detail = summarizeDetail(parsed.errorMessage || firstCopilotDiagnosticLine(probe.stderr));
  const authEvidence = `${parsed.errorMessage ?? ""}\n${probe.stderr}`;

  if (probe.timedOut) {
    checks.push({
      code: "copilot_hello_probe_timed_out",
      level: "warn",
      message: "Copilot hello probe timed out.",
      hint: `Retry the probe. If this persists, run \`${HELLO_PROBE_COMMAND_HINT}\` manually.`,
    });
  } else if ((probe.exitCode ?? 1) === 0) {
    const hasHello = /\bhello\b/i.test(parsed.summary);
    checks.push({
      code: hasHello ? "copilot_hello_probe_passed" : "copilot_hello_probe_unexpected_output",
      level: hasHello ? "info" : "warn",
      message: hasHello
        ? "Copilot hello probe succeeded."
        : "Copilot probe ran but did not return `hello` as expected.",
      ...(parsed.summary ? { detail: summarizeDetail(parsed.summary) } : {}),
    });
  } else if (COPILOT_AUTH_REQUIRED_RE.test(authEvidence)) {
    checks.push({
      code: "copilot_hello_probe_auth_required",
      level: "warn",
      message: "Copilot CLI is installed, but authentication is not ready.",
      ...(detail ? { detail } : {}),
      hint: "Run `copilot login` (or set COPILOT_GITHUB_TOKEN in adapter env), then retry.",
    });
  } else {
    checks.push({
      code: "copilot_hello_probe_failed",
      level: "error",
      message: "Copilot hello probe failed.",
      ...(detail ? { detail } : {}),
      hint: `Run \`${HELLO_PROBE_COMMAND_HINT}\` manually in this working directory to debug.`,
    });
  }

  return done();
}
