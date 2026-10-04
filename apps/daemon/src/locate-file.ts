// Finds a file on this Mac from what a web page saw of it: name, size and date. Pages never get paths, whether
// the file was picked in the Open dialog or dragged in from Finder, but a skill needs to know where such files live.
// Spotlight first (mdfind: the whole disk, fast), then a bounded walk of the usual folders.
import { execFile } from "node:child_process";
import { type Dirent, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FileInfo, TraceEvent } from "@taskplayer/core";

export interface LocateOptions {
  searchDirs: string[];
  spotlight?: (name: string) => Promise<string[]>;
  maxEntries?: number; // per walk, so a huge home folder can't stall a compile
}

export function defaultSearchDirs(watchDirs: string[] = []): string[] {
  const home = homedir();
  const usual = ["Downloads", "Desktop", "Documents", "Movies", "Pictures"].map((d) => join(home, d));
  return [...new Set([...watchDirs, ...usual])];
}

export function spotlight(name: string): Promise<string[]> {
  const query = `kMDItemFSName == "${name.replace(/["\\]/g, "\\$&")}"`;
  return new Promise((resolve) => {
    execFile("mdfind", [query], { timeout: 5_000 }, (error, stdout) =>
      resolve(error ? [] : stdout.split("\n").filter(Boolean)),
    );
  });
}

export async function locateFile(file: FileInfo, options: LocateOptions): Promise<string | undefined> {
  // Same name and size; if several, the one whose modified time is closest to what the page saw.
  const best = (paths: string[]) => {
    const found = paths.flatMap((path) => {
      try {
        const stat = statSync(path);
        if (!stat.isFile() || stat.size !== file.size) return [];
        return [{ path, gap: Math.abs(stat.mtimeMs - (file.lastModified ?? stat.mtimeMs)) }];
      } catch {
        return [];
      }
    });
    return found.sort((a, b) => a.gap - b.gap)[0]?.path;
  };
  return (
    best(await (options.spotlight ?? spotlight)(file.name)) ??
    best(walk(options.searchDirs, file.name, options.maxEntries ?? 20_000))
  );
}

// Breadth-first, three levels deep, skipping hidden folders, Library and node_modules.
function walk(dirs: string[], name: string, maxEntries: number): string[] {
  const hits: string[] = [];
  let seen = 0;
  let level = dirs.map((dir) => ({ dir, depth: 0 }));
  while (level.length > 0 && seen < maxEntries) {
    const next: typeof level = [];
    for (const { dir, depth } of level) {
      let entries: Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue; // missing, or blocked by macOS privacy
      }
      for (const entry of entries) {
        if (++seen > maxEntries) break;
        if (entry.name.startsWith(".") || entry.name === "Library" || entry.name === "node_modules") continue;
        const path = join(dir, entry.name);
        if (entry.isFile() && entry.name === name) hits.push(path);
        else if (entry.isDirectory() && depth < 3) next.push({ dir: path, depth: depth + 1 });
      }
    }
    level = next;
  }
  return hits;
}

// Fills in `path` for every file a page saw (picked or dropped) that can be found on disk. Unfound files keep no
// path; the compiler then asks where such files arrive.
export async function locateFiles(trace: TraceEvent[], options: LocateOptions): Promise<TraceEvent[]> {
  const cache = new Map<string, string | undefined>();
  const find = async (file: FileInfo): Promise<FileInfo> => {
    if (file.path) return file;
    const key = `${file.name}\n${file.size}`;
    if (!cache.has(key)) cache.set(key, await locateFile(file, options));
    const path = cache.get(key);
    return path ? { ...file, path } : file;
  };
  const out: TraceEvent[] = [];
  for (const event of trace) {
    if (!event.file && !event.files) {
      out.push(event);
      continue;
    }
    out.push({
      ...event,
      file: event.file && (await find(event.file)),
      files: event.files && (await Promise.all(event.files.map(find))),
    });
  }
  return out;
}
