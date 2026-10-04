// Skill store: skills/<id>/v<N>.json. A version is never overwritten: a new recording of the same skill, or a fix
// approved by replay's learn-back, becomes the next version and the older ones stay as history and fallbacks.
// The highest version is the one replay runs.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Skill } from "@taskplayer/core";

const VERSION_FILE = /^v(\d+)\.json$/;

export function skillDir(dataDir: string, id: string): string {
  // Same rule as Skill.id, so an id can never climb out of skills/.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`invalid skill id: ${id}`);
  return join(dataDir, "skills", id);
}

export function versions(dataDir: string, id: string): number[] {
  const dir = skillDir(dataDir, id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((f) => {
      const match = VERSION_FILE.exec(f);
      return match ? [Number(match[1])] : [];
    })
    .sort((a, b) => a - b);
}

export function loadSkill(dataDir: string, id: string, version?: number): Skill | undefined {
  const v = version ?? versions(dataDir, id).at(-1);
  if (v === undefined) return undefined;
  const path = join(skillDir(dataDir, id), `v${v}.json`);
  return existsSync(path) ? Skill.parse(JSON.parse(readFileSync(path, "utf8"))) : undefined;
}

// Saves as the next version of its id. "wx" makes the write fail rather than replace a file that already exists.
export function saveSkill(dataDir: string, skill: Skill): { path: string; skill: Skill } {
  const dir = skillDir(dataDir, skill.id);
  const saved = Skill.parse({ ...skill, version: (versions(dataDir, skill.id).at(-1) ?? 0) + 1 });
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `v${saved.version}.json`);
  writeFileSync(path, `${JSON.stringify(saved, null, 2)}\n`, { flag: "wx" });
  return { path, skill: saved };
}

export function listSkills(dataDir: string): { id: string; versions: number[]; intent: string }[] {
  const root = join(dataDir, "skills");
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((id) => {
    const all = /^[a-z0-9][a-z0-9-]*$/.test(id) ? versions(dataDir, id) : [];
    const latest = all.length > 0 ? loadSkill(dataDir, id) : undefined;
    return latest ? [{ id, versions: all, intent: latest.intent }] : [];
  });
}
