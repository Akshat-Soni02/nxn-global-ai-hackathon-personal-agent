// fs channel: find, move, copy, rename, read, write. Never overwrites: a clash gets a Finder-style " (n)" suffix.
import { existsSync } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { ActionStep as Step } from "@taskplayer/core";
import type { RunContext, StepResult } from "../types.ts";
import { expandHome, findFiles, poll } from "./paths.ts";

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || v === "") throw new Error(`${name} must be a non-empty string`);
  return v;
};

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
      if (pick === "all") return { ok: true, value: found };
      if (found.length === 0) return { ok: false, error: `no file matches ${a.glob} in ${a.dir}` };
      return { ok: true, value: found[0] };
    }
    case "move":
    case "copy": {
      const sources = Array.isArray(a.from) ? a.from.map((f) => str(f, "from")) : [str(a.from, "from")];
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
      return { ok: true, value: Array.isArray(a.from) ? done : done[0] };
    }
    case "rename": {
      const from = expandHome(str(a.from, "from"));
      const to = str(a.to, "to");
      const target = freePath(to.includes("/") ? expandHome(to) : join(dirname(from), to));
      await moveFile(from, target);
      return { ok: true, value: target };
    }
    case "read":
      return { ok: true, value: await readFile(expandHome(str(a.path, "path")), "utf8") };
    case "write": {
      const path = expandHome(str(a.path, "path"));
      await mkdir(dirname(path), { recursive: true });
      const content = typeof a.content === "string" ? a.content : "";
      if (a.append) await appendFile(path, content);
      else await writeFile(path, content);
      return { ok: true, value: path };
    }
    default:
      return { ok: false, error: `fs.${step.action} is not supported` };
  }
}
