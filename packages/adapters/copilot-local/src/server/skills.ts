import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AdapterSkillContext,
  AdapterSkillSnapshot,
} from "@paperclipai/adapter-utils";
import {
  buildRuntimeMountedSkillSnapshot,
  isPaperclipSkillSourceMissing,
  readInstalledSkillTargets,
  readPaperclipRuntimeSkillEntries,
  resolveLegacyPaperclipDesiredSkillNames,
} from "@paperclipai/adapter-utils/server-utils";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function resolveCopilotPersonalSkillsHome(config: Record<string, unknown>) {
  const env =
    typeof config.env === "object" && config.env !== null && !Array.isArray(config.env)
      ? (config.env as Record<string, unknown>)
      : {};
  const configuredHome = asNonEmptyString(env.HOME);
  const home = configuredHome ? path.resolve(configuredHome) : os.homedir();
  return path.join(home, ".copilot", "skills");
}

async function buildCopilotSkillSnapshot(config: Record<string, unknown>): Promise<AdapterSkillSnapshot> {
  const availableEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const desiredSkills = resolveLegacyPaperclipDesiredSkillNames(config, availableEntries);
  const skillsHome = resolveCopilotPersonalSkillsHome(config);
  const installed = await readInstalledSkillTargets(skillsHome);
  return buildRuntimeMountedSkillSnapshot({
    adapterType: "copilot_local",
    availableEntries,
    desiredSkills,
    configuredDetail: "Will be mounted for Copilot through a temporary --add-dir on the next run.",
    externalInstalled: installed,
    externalLocationLabel: "~/.copilot/skills",
    externalDetail: "Installed outside Paperclip management in the Copilot personal skills home.",
    skillsHome,
  });
}

export async function listCopilotSkills(ctx: AdapterSkillContext): Promise<AdapterSkillSnapshot> {
  return buildCopilotSkillSnapshot(ctx.config);
}

export async function syncCopilotSkills(
  ctx: AdapterSkillContext,
  _desiredSkills: string[],
): Promise<AdapterSkillSnapshot> {
  return buildCopilotSkillSnapshot(ctx.config);
}

/**
 * Build a throwaway directory whose `.github/skills/` symlinks the desired
 * Paperclip skills. Passing it to Copilot with `--add-dir` makes the CLI load
 * those skills without touching the agent cwd or ~/.copilot.
 */
export async function buildCopilotSkillsMount(
  config: Record<string, unknown>,
): Promise<{ dir: string; skillNames: string[] } | null> {
  const availableEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const desiredNames = new Set(resolveLegacyPaperclipDesiredSkillNames(config, availableEntries));
  const selected = availableEntries.filter(
    (entry) => desiredNames.has(entry.key) && !isPaperclipSkillSourceMissing(entry),
  );
  if (selected.length === 0) return null;

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-copilot-skills-"));
  const target = path.join(dir, ".github", "skills");
  await fs.mkdir(target, { recursive: true });
  const skillNames: string[] = [];
  for (const entry of selected) {
    await fs.symlink(entry.source, path.join(target, entry.runtimeName));
    skillNames.push(entry.runtimeName);
  }
  return { dir, skillNames };
}
