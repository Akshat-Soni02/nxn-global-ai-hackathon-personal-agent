// Skill store: skills/<id>/v<N>.json. Every recording is a new skill with its own id, even when it is the same task
// as one you already have (newSkillId), so two recordings never land in one skill. A version is never overwritten: a
// repair made during a run (by: debug) or a change you make becomes the next version and the older ones stay as
// history. The highest version is the one replay runs; a rollback saves the version before it again, as the next one.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyEdits, type EditInput, repairViolations, Skill } from "@shadow/core";

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

// Saves a repair made during a run. A run keeps the version it started on, so the fix can be built on a version older
// than the latest (you edited the workflow while the run waited). Saved as latest + 1 as it is, it would put the old
// content on top of your edit. So the fix (its edits) is applied again to the latest; if it no longer fits there, no
// version is saved and the run goes on with its own fixed copy (the next run meets the failure again, and you know why).
export function saveRepair(dataDir: string, repaired: Skill, edits: EditInput[] = []): Skill {
  const latest = loadSkill(dataDir, repaired.id);
  if (!latest || repaired.version === latest.version + 1) return saveSkill(dataDir, repaired).skill;
  const applied = applyEdits(latest, edits);
  const note = repaired.history.at(-1);
  if (!applied.ok || !note || repairViolations(latest, applied.skill).length > 0) return repaired;
  const version = latest.version + 1;
  return saveSkill(dataDir, {
    ...applied.skill,
    version,
    history: [...latest.history, { ...note, version }],
  }).skill;
}

export function listSkills(dataDir: string): { id: string; versions: number[]; name: string }[] {
  const root = join(dataDir, "skills");
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((id) => {
    const all = /^[a-z0-9][a-z0-9-]*$/.test(id) ? versions(dataDir, id) : [];
    const latest = all.length > 0 ? loadSkill(dataDir, id) : undefined;
    return latest ? [{ id, versions: all, name: latest.name }] : [];
  });
}

// A readable name and a random tag: upload-invoice-k3f9q2. The tag is what keeps two recordings of the same task
// apart; the name is what you recognise in "skills".
export function newSkillId(dataDir: string, name: string): string {
  for (;;) {
    const tag = randomBytes(5).readUIntBE(0, 5).toString(36).padStart(6, "0").slice(-6);
    const id = `${name}-${tag}`;
    if (versions(dataDir, id).length === 0) return id;
  }
}

// The skills a name you typed refers to: the one with exactly that id, else every skill whose id starts with it
// ("run upload-invoice" finds upload-invoice-k3f9q2 when it is the only one).
export function findSkills(dataDir: string, ref: string): string[] {
  const all = listSkills(dataDir).map((s) => s.id);
  return all.includes(ref) ? [ref] : all.filter((id) => id.startsWith(ref));
}

// One-step rollback: the version before the latest becomes the next version, with a note saying what was undone.
export function rollbackSkill(dataDir: string, id: string, now = new Date()): { path: string; skill: Skill } {
  const all = versions(dataDir, id);
  const latest = loadSkill(dataDir, id);
  const previous = all.length >= 2 ? loadSkill(dataDir, id, all[all.length - 2]) : undefined;
  if (!latest || !previous) throw new Error(`${id} has no earlier version to roll back to`);
  const undone = latest.history.find((h) => h.version === latest.version)?.summary ?? `v${latest.version}`;
  const next = latest.version + 1;
  return saveSkill(dataDir, {
    ...previous,
    history: [
      ...latest.history,
      {
        version: next,
        by: "user",
        summary: `rolled back to v${previous.version} (undid: ${undone})`,
        at: now.toISOString(),
      },
    ],
  });
}
