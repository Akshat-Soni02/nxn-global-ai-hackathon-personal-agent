// Drafts (docs/design.md, "Workflow lifecycle" and "6. Edit"): a workflow being changed in the editor is a base
// version plus the edit operations made on it, kept in skills/<id>/draft.json, never a copy of the tree. Undo drops
// the last operation, redo replays it, "what changed" is the list, and going live applies the operations to the
// latest version and saves the next one (by: user). The live version keeps running unchanged meanwhile.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyEdits, type EditInput, type Skill } from "@shadow/core";
import { loadSkill, skillDir } from "./skill-store.ts";

export interface DraftFile {
  // The version the operations were made on.
  base: number;
  ops: EditInput[];
  // Operations undone, newest last; redo takes the last one back.
  undone: EditInput[];
  updatedAt: number;
}

const path = (dataDir: string, id: string) => join(skillDir(dataDir, id), "draft.json");

export function readDraft(dataDir: string, id: string): DraftFile | undefined {
  const file = path(dataDir, id);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as DraftFile;
}

export function writeDraft(dataDir: string, id: string, draft: DraftFile): DraftFile {
  writeFileSync(path(dataDir, id), `${JSON.stringify(draft, null, 2)}\n`, { mode: 0o600 });
  return draft;
}

export function deleteDraft(dataDir: string, id: string): void {
  rmSync(path(dataDir, id), { force: true });
}

// The draft's tree: the version it was made on with its operations applied. Undefined when there is no draft.
export function draftSkill(dataDir: string, id: string): { skill: Skill; draft: DraftFile } | undefined {
  const draft = readDraft(dataDir, id);
  if (!draft) return undefined;
  const base = loadSkill(dataDir, id, draft.base);
  if (!base) throw new Error(`the draft was made on v${draft.base}, which is gone`);
  const applied = applyEdits(base, draft.ops);
  if (!applied.ok) throw new Error(`the draft no longer applies: ${applied.problems.join("; ")}`);
  return { skill: applied.skill, draft };
}
