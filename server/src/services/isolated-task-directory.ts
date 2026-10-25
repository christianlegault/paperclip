import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { parseObject } from "../adapters/utils.js";
import { resolvePaperclipInstanceRoot } from "../home-paths.js";

/** A repository-free sandbox task needs isolation, but has no Git base. */
export function shouldUseIsolatedTaskDirectory(input: {
  trustPreset: string;
  environmentDriver: string | null;
  mode: string;
  hasProjectWorkspace: boolean;
  projectWorkspaceId: string | null;
  workspaceStrategies: unknown[];
}): boolean {
  return input.trustPreset === "low_trust_review"
    && input.environmentDriver === "sandbox"
    && input.mode === "isolated_workspace"
    && !input.hasProjectWorkspace
    && !input.projectWorkspaceId
    // Never discard an explicit repository/branch requirement or setup hook.
    && input.workspaceStrategies.every((value) => Object.keys(parseObject(value)).length === 0);
}

/**
 * Identifies a persisted execution workspace as this task's own isolated task
 * directory: the retained root (`{}`) or a fresh-attempt sibling (`{ attemptId }`).
 * Such a directory has no Git base, so later turns must keep using it as a plain
 * task directory. Returns null for any other workspace.
 */
export async function resolveIsolatedTaskDirectoryIdentity(
  workspace: {
    companyId: string;
    sourceIssueId: string | null;
    mode: string;
    strategyType: string;
    projectWorkspaceId: string | null;
    repoUrl: string | null;
    branchName: string | null;
    cwd: string | null;
  },
  task: { companyId: string; issueId: string },
): Promise<{ attemptId?: string } | null> {
  if (workspace.companyId !== task.companyId || workspace.sourceIssueId !== task.issueId ||
      workspace.mode !== "isolated_workspace" || workspace.strategyType !== "project_primary" ||
      workspace.projectWorkspaceId || workspace.repoUrl || workspace.branchName || !workspace.cwd) {
    return null;
  }
  if ([task.companyId, task.issueId].some((value) => !/^[a-zA-Z0-9_-]+$/.test(value))) return null;
  const configuredRoot = resolvePaperclipInstanceRoot();
  const root = await realpath(configuredRoot).catch(() => path.resolve(configuredRoot));
  const cwd = path.resolve(workspace.cwd);
  if (cwd === path.join(root, "isolated-workspaces", task.companyId, task.issueId)) return {};
  const attemptId = path.basename(cwd);
  return path.dirname(cwd) === path.join(root, "isolated-workspace-attempts", task.companyId, task.issueId) &&
    /^[a-zA-Z0-9_-]+$/.test(attemptId) ? { attemptId } : null;
}

/** Stable across turns, separate from project roots and shared agent homes. */
export async function materializeIsolatedTaskDirectory(input: {
  companyId: string;
  issueId: string;
  attemptId?: string;
}): Promise<string> {
  // Files belong to the task, so reassignment preserves the same workspace.
  const identities = [input.companyId, input.issueId, ...(input.attemptId ? [input.attemptId] : [])];
  if (identities.some((value) => !/^[a-zA-Z0-9_-]+$/.test(value))) {
    throw new Error("Invalid isolated task workspace identity");
  }
  const root = resolvePaperclipInstanceRoot();
  await mkdir(root, { recursive: true });
  let cwd = await realpath(root);
  // A retry is a sibling namespace, never a descendant of the retained root.
  // An old copyback operation must not be able to overwrite its replacement.
  for (const segment of [input.attemptId ? "isolated-workspace-attempts" : "isolated-workspaces", ...identities]) {
    cwd = path.join(cwd, segment);
    await mkdir(cwd, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const stat = await lstat(cwd);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(cwd) !== cwd) {
      throw new Error("Isolated task workspace path is not a private directory");
    }
  }
  return cwd;
}
