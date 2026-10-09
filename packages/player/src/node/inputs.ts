// Fills a skill's inputs before a run: values supplied by the caller win, then file resolvers, then defaults.
import { statSync } from "node:fs";
import { basename } from "node:path";
import { fitValue, pathOf, type Skill, triggerOf, typeText, type VarType, wrongKind } from "@taskplayer/core";
import { expandHome, fileValue, findFiles } from "./paths.ts";

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

// Values the run starts with: the trigger step's inputs. A value given by the caller wins, then a file resolver,
// then the default. Every value is checked against the input's type; files become file values
// ({ path, name, size, modified }).
export async function resolveInputs(
  skill: Skill,
  provided: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};
  for (const [name, input] of Object.entries(triggerOf(skill).inputs)) {
    const fileList = input.type.type === "list" && input.type.items.type === "file";
    const isFile = input.type.type === "file";
    if (name in provided) {
      const given = provided[name];
      resolved[name] = isFile
        ? fileValue(expandHome(String(pathOf(given) ?? given)))
        : fileList && Array.isArray(given)
          ? given.map((g) => fileValue(expandHome(String(pathOf(g) ?? g))))
          : fitOrThrow(name, input.type, given);
      continue;
    }
    if ((isFile || fileList) && input.resolve) {
      const rule = input.resolve as FileRule;
      const { dir, glob, pick } = rule;
      if (!dir || !glob) throw new Error(`input ${name}: resolve needs dir and glob`);
      // Only files the step can take: not empty, and of the kind it takes.
      const found = (await findFiles(dir, glob)).filter((path) => !checkFile(path, rule));
      if (pick === "all" || fileList) {
        resolved[name] = found.map(fileValue);
        continue;
      }
      if (!found[0])
        throw new Error(
          `input ${name}: no file matches ${glob} in ${dir}${rule.accept ? ` (taking ${rule.accept})` : ""}`,
        );
      resolved[name] = fileValue(found[0]);
      continue;
    }
    if (input.default !== undefined) {
      resolved[name] = fitOrThrow(name, input.type, input.default);
      continue;
    }
    // TODO(player): secret inputs come from the macOS Keychain.
    throw new Error(`input ${name} has no value`);
  }
  return resolved;
}

function fitOrThrow(name: string, type: VarType, value: unknown): unknown {
  const fitted = fitValue(type, value);
  if (fitted === undefined) throw new Error(`input ${name} should be ${typeText(type)}, got ${JSON.stringify(value)}`);
  return fitted;
}
