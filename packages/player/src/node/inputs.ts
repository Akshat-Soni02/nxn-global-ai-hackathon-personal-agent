// Fills a skill's inputs before a run: values supplied by the caller win, then file resolvers, then defaults.
import type { Skill } from "@taskplayer/core";
import { expandHome, findFiles } from "./paths.ts";

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
      const { dir, glob, pick } = input.resolve as { dir?: string; glob?: string; pick?: string };
      if (!dir || !glob) throw new Error(`input ${name}: resolve needs dir and glob`);
      const found = await findFiles(dir, glob);
      if (pick === "all") {
        resolved[name] = found;
        continue;
      }
      if (!found[0]) throw new Error(`input ${name}: no file matches ${glob} in ${dir}`);
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
