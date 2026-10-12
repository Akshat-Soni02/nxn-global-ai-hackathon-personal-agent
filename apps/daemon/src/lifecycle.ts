// A workflow's state, apart from any one run (docs/design.md, "Workflow lifecycle"): a draft never starts on its
// own, a live one starts when its trigger fires, a paused one waits to be resumed. Kept in skills/<id>/state.json,
// next to the versions and never inside them. No state.json: a draft (everything recorded before triggers existed).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Skill, type Trigger, triggerOf } from "@shadow/core";
import { Cron } from "croner";
import { skillDir } from "./skill-store.ts";
import type { StateFile } from "./types.ts";

export type { StateFile, WorkflowState } from "./types.ts";

// What identifies a trigger's bookkeeping (when it last fired, which files it saw). It includes what the trigger
// watches, so changing the schedule or the folder starts afresh.
export const triggerKey = (index: number, trigger: Trigger): string =>
  trigger.type === "schedule"
    ? `${index}:schedule:${trigger.cron}`
    : trigger.type === "folder_watch"
      ? `${index}:folder:${trigger.dir}:${trigger.glob ?? "*"}`
      : `${index}:manual`;

export function readState(dataDir: string, id: string): StateFile {
  const path = join(skillDir(dataDir, id), "state.json");
  if (!existsSync(path)) return { state: "draft", since: 0 };
  return JSON.parse(readFileSync(path, "utf8")) as StateFile;
}

export function writeState(dataDir: string, id: string, state: StateFile): StateFile {
  writeFileSync(join(skillDir(dataDir, id), "state.json"), `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

// The triggers that start a workflow on its own (not "only when I start it").
export const autoTriggers = (skill: Skill): Exclude<Trigger, { type: "manual" }>[] =>
  triggerOf(skill).when.filter((t): t is Exclude<Trigger, { type: "manual" }> => t.type !== "manual");

// The file input a folder trigger fills: the one it names, or the workflow's only file input.
export function folderInput(skill: Skill, trigger: Extract<Trigger, { type: "folder_watch" }>): string | undefined {
  const inputs = triggerOf(skill).inputs;
  if (trigger.input) return inputs[trigger.input]?.type.type === "file" ? trigger.input : undefined;
  const files = Object.entries(inputs).filter(([, input]) => input.type.type === "file");
  return files.length === 1 ? files[0]?.[0] : undefined;
}

// Why a workflow can't go live, in words; empty when it can. The workflow already parses and passes check.ts (it
// was saved), so these are the things only an unattended run needs. A workflow that only runs when you start it can
// always go live: you are there to give it what it needs, so there is nothing more to check.
export function goLiveProblems(skill: Skill): string[] {
  const problems: string[] = [];
  const triggers = autoTriggers(skill);
  if (triggers.length === 0) return problems;
  const filledByFolder = new Set<string>();
  for (const trigger of triggers) {
    if (trigger.type === "schedule") {
      try {
        new Cron(trigger.cron);
      } catch (error) {
        problems.push(`its schedule "${trigger.cron}" isn't valid: ${(error as Error).message}`);
      }
    } else {
      if (!trigger.dir.trim()) problems.push("its folder trigger has no folder");
      const input = folderInput(skill, trigger);
      if (!input) {
        problems.push(
          trigger.input
            ? `its folder trigger names "${trigger.input}", which isn't a file input`
            : "its folder trigger needs exactly one file input to give the new file to (or name one)",
        );
      } else filledByFolder.add(input);
    }
  }
  // A folder trigger fills its input only when every trigger is a folder trigger: a scheduled run has no file.
  const allFolders = triggers.every((t) => t.type === "folder_watch");
  for (const [name, input] of Object.entries(triggerOf(skill).inputs)) {
    if (input.default !== undefined || input.resolve) continue;
    if (allFolders && filledByFolder.has(name)) continue;
    problems.push(`input "${name}" has no default and no way to be found: an unattended run has nobody to ask`);
  }
  return problems;
}

// The next time a schedule fires after `from` (epoch ms), or undefined if it never does.
export function nextTime(cron: string, from: number): number | undefined {
  try {
    return new Cron(cron).nextRun(new Date(from))?.getTime();
  } catch {
    return undefined;
  }
}
