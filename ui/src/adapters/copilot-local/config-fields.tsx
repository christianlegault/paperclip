import { configFieldsForSection } from "../config-sections";
import type { AdapterConfigFieldsProps } from "../types";
import {
  DraftInput,
  DraftNumberInput,
  Field,
} from "../../components/agent-config-primitives";
import { ChoosePathButton } from "../../components/PathInstructionsModal";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";
const instructionsFileHint =
  "Absolute path to a markdown file (e.g. AGENTS.md) that defines this agent's behavior. Prepended to the Copilot prompt at runtime.";
const autopilotHint =
  "Lets Copilot keep working autonomously for up to this many continuations per heartbeat (--autopilot). 0 turns autopilot off.";

export function CopilotLocalConfigFields({
  section,
  isCreate,
  values,
  set,
  config,
  eff,
  mark,
  hideInstructionsFile,
}: AdapterConfigFieldsProps) {
  return configFieldsForSection(section, (
    <>
      {!hideInstructionsFile && (
        <Field label="Agent instructions file" hint={instructionsFileHint}>
          <div className="flex items-center gap-2">
            <DraftInput
              value={
                isCreate
                  ? values!.instructionsFilePath ?? ""
                  : eff(
                      "adapterConfig",
                      "instructionsFilePath",
                      String(config.instructionsFilePath ?? ""),
                    )
              }
              onCommit={(v) =>
                isCreate
                  ? set!({ instructionsFilePath: v })
                  : mark("adapterConfig", "instructionsFilePath", v || undefined)
              }
              immediate
              className={inputClass}
              placeholder="/absolute/path/to/AGENTS.md"
            />
            <ChoosePathButton />
          </div>
        </Field>
      )}
      {!isCreate && (
        <Field configSection="runPolicy" label="Autopilot continuations" hint={autopilotHint}>
          <DraftNumberInput
            value={eff(
              "adapterConfig",
              "maxAutopilotContinues",
              Number(config.maxAutopilotContinues ?? 0),
            )}
            onCommit={(v) =>
              mark(
                "adapterConfig",
                "maxAutopilotContinues",
                Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined,
              )
            }
            immediate
            className={inputClass}
            min={0}
          />
        </Field>
      )}
    </>
  ));
}
