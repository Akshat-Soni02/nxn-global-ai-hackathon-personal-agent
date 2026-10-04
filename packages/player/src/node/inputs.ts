// Fills a skill's inputs before a run: values supplied by the caller win, then file resolvers, then defaults.
import { statSync } from "node:fs";
import { basename } from "node:path";
import { type Skill, wrongKind } from "@taskplayer/core";
import { expandHome, findFiles } from "./paths.ts";

// A file input's rule (Input.resolve): where to look, and which files it takes. accept uses the HTML syntax
// ("image/*,.pdf"); max_mb is only ever set by hand, because a page does not say its limit in a standard way.
export interface FileRule {
  dir?: string;
  glob?: string;
  pick?: string;
  ask?: boolean;
  accept?: string;
  max_mb?: number;
}

// Why a file can't be used for an input, in words, or undefined when it can. Checked before any step runs, so a
// wrong file never leaves a task half done.
export function checkFile(path: string, rule: FileRule = {}): string | undefined {
  let size: number;
  try {
    const info = statSync(path);
    if (info.isDirectory()) return `${path} is a folder, not a file`;
    if (!info.isFile()) return `${path} is not a file`;
    size = info.size;
  } catch {
    return `no file at ${path}`;
  }
  if (size === 0) return `${basename(path)} is empty (0 bytes)`;
  const kind = wrongKind(path, rule.accept);
  if (kind) return kind;
  const max = Number(rule.max_mb);
  if (rule.max_mb !== undefined && Number.isFinite(max) && size > max * 1024 * 1024)
    return `${basename(path)} is ${(size / 1024 / 1024).toFixed(1)} MB: this step takes at most ${max} MB`;
  return undefined;
}

export async function resolveInputs(
  skill: Skill,
  provided: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};
  for (const [name, input] of Object.entries(skill.inputs)) {
    if (name in provided) {
      resolved[name] = input.type === "file" ? expandPaths(provided[name]) : provided[name];
      continue;
    }
    if (input.type === "file" && input.resolve) {
      const rule = input.resolve as FileRule;
      const { dir, glob, pick } = rule;
      if (!dir || !glob) throw new Error(`input ${name}: resolve needs dir and glob`);
      // Only files the step can take: not empty, and of the kind it takes.
      const found = (await findFiles(dir, glob)).filter((path) => !checkFile(path, rule));
      if (pick === "all") {
        resolved[name] = found;
        continue;
      }
      if (!found[0])
        throw new Error(
          `input ${name}: no file matches ${glob} in ${dir}${rule.accept ? ` (taking ${rule.accept})` : ""}`,
        );
      resolved[name] = found[0];
      continue;
    }
    if (input.default !== undefined) {
      resolved[name] = input.default;
      continue;
    }
    // TODO(player): secret inputs come from the macOS Keychain.
    throw new Error(`input ${name} has no value`);
  }
  return resolved;
}

const expandPaths = (v: unknown) => (Array.isArray(v) ? v.map((p) => expandHome(String(p))) : expandHome(String(v)));
