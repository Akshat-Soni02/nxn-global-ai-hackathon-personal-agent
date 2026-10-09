import { existsSync, statSync } from "node:fs";
import { glob, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { FileValue } from "@taskplayer/core";

// A file value ({ path, name, size, modified }), the type a skill's `file` variables hold.
export function fileValue(path: string): FileValue {
  const info = statSync(path, { throwIfNoEntry: false });
  return {
    path,
    name: basename(path),
    size: info?.size ?? 0,
    modified: info ? info.mtime.toISOString() : "",
  };
}

export function expandHome(path: string): string {
  return path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

const GLOB_CHARS = /[*?[{]/;

// Files matching a glob inside dir, newest first. Only regular files; optionally only those modified since `sinceMs`.
export async function findFiles(dir: string, pattern: string, sinceMs?: number): Promise<string[]> {
  const root = expandHome(dir);
  const found: { path: string; mtime: number }[] = [];
  for await (const rel of glob(pattern, { cwd: root })) {
    const path = join(root, rel);
    const info = await stat(path).catch(() => undefined);
    if (!info?.isFile()) continue;
    if (sinceMs !== undefined && info.mtimeMs < sinceMs) continue;
    found.push({ path, mtime: info.mtimeMs });
  }
  return found.sort((a, b) => b.mtime - a.mtime).map((f) => f.path);
}

// A file_exists check: a plain path, or a path whose last segment is a glob.
export async function fileExists(pattern: string): Promise<boolean> {
  const path = expandHome(pattern);
  if (!GLOB_CHARS.test(basename(path))) return existsSync(path);
  return (await findFiles(dirname(path), basename(path))).length > 0;
}

export async function poll(test: () => Promise<boolean>, timeoutMs: number, intervalMs = 250): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await test()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
