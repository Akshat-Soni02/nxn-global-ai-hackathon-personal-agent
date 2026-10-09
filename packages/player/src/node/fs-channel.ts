// fs channel: find, move, copy, rename, read, write. Never overwrites: a clash gets a Finder-style " (n)" suffix.
// Paths may be given as text or as file values; files come back as file values ({ path, name, size, modified }).
import { existsSync } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { pathOf, type ActionStep as Step } from "@taskplayer/core";
import type { RunContext, StepResult } from "../types.ts";
import { expandHome, fileValue, findFiles, poll } from "./paths.ts";

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || v === "") throw new Error(`${name} must be a non-empty string`);
  return v;
};
// A path argument: text, or a file value's path.
const path = (v: unknown, name: string): string => str(pathOf(v), name);

function freePath(path: string): string {
  if (!existsSync(path)) return path;
  const ext = extname(path);
  const stem = path.slice(0, path.length - ext.length);
  for (let n = 1; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!existsSync(candidate)) return candidate;
  }
}

async function destinationFor(source: string, to: string): Promise<string> {
  const isFolder = to.endsWith("/");
  const target = expandHome(isFolder ? join(to, basename(source)) : to);
  await mkdir(dirname(target), { recursive: true });
  return freePath(target);
}

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await copyFile(from, to);
    await unlink(from);
  }
}

export async function fsChannel(step: Step, ctx: RunContext): Promise<StepResult> {
  const a = step.args;
  switch (step.action) {
    case "find": {
      const pick = a.pick === "all" ? "all" : "newest";
      const since = a.since_run_start ? ctx.startedAt : undefined;
      let found: string[] = [];
      const search = async () => {
        found = await findFiles(str(a.dir, "dir"), str(a.glob, "glob"), since);
        return found.length > 0;
      };
      // With timeout_ms, wait for at least one match (e.g. a download finishing). Otherwise look once.
      await poll(search, step.timeout_ms ?? 0);
      if (pick === "all") return { ok: true, value: found.map(fileValue) };
      if (!found[0]) return { ok: false, error: `no file matches ${a.glob} in ${a.dir}` };
      return { ok: true, value: fileValue(found[0]) };
    }
    case "move":
    case "copy": {
      const sources = Array.isArray(a.from) ? a.from.map((f) => path(f, "from")) : [path(a.from, "from")];
      const to = str(a.to, "to");
      if (sources.length > 1 && !to.endsWith("/"))
        throw new Error(`moving several files needs a folder ("to" ending in /)`);
      const done: string[] = [];
      for (const source of sources.map(expandHome)) {
        const target = await destinationFor(source, to);
        if (step.action === "move") await moveFile(source, target);
        else await copyFile(source, target);
        done.push(target);
      }
      const files = done.map(fileValue);
      return { ok: true, value: Array.isArray(a.from) ? files : files[0] };
    }
    case "rename": {
      const from = expandHome(path(a.from, "from"));
      const to = str(a.to, "to");
      const target = freePath(to.includes("/") ? expandHome(to) : join(dirname(from), to));
      await moveFile(from, target);
      return { ok: true, value: fileValue(target) };
    }
    case "read":
      return { ok: true, value: await readFile(expandHome(path(a.path, "path")), "utf8") };
    case "write": {
      const target = expandHome(path(a.path, "path"));
      await mkdir(dirname(target), { recursive: true });
      const content = typeof a.content === "string" ? a.content : "";
      if (a.append) await appendFile(target, content);
      else await writeFile(target, content);
      return { ok: true, value: fileValue(target) };
    }
    default:
      return { ok: false, error: `fs.${step.action} is not supported` };
  }
}
