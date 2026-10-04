// Mac-side capture: files created, moved or renamed while you record. Node's recursive fs.watch uses FSEvents on
// macOS. FSEvents only says "something happened at this path", so each report is turned into an observation
// (the file appeared or vanished) and a short settled batch of those is classified into create / move / rename.
// By default the whole home folder is watched, so any folder you work in is covered with no setup. Places where apps
// write their own files all day are skipped: ~/Library, hidden folders, node_modules and app libraries.
import { type FSWatcher, readdirSync, statSync, watch } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, sep } from "node:path";

export interface FsObservation {
  kind: "appear" | "vanish";
  path: string;
  at: number;
  ino?: number;
}

export interface FsChange {
  event: "fs_create" | "fs_move" | "fs_rename";
  path: string;
  toPath?: string;
  at: number;
}

// Temporary and system files: in-progress downloads, editor swap files, Finder metadata, anything hidden. And folders
// that are someone else's working space: dependencies, caches, and app libraries kept as packages (Photos, Music).
const IGNORED_NAME =
  /^\.|\.crdownload$|\.download$|\.part$|\.tmp$|\.swp$|^~\$|^Icon\r$|^node_modules$|^__pycache__$|\.(app|photoslibrary|musiclibrary|imovielibrary|tvlibrary|fcpbundle|xcodeproj|xcworkspace)$/;

// Inside ~/Library, the folders that hold your own files: cloud storage (Google Drive, OneDrive, Dropbox) and iCloud.
export const CLOUD_FOLDERS = ["CloudStorage", "Mobile Documents"];

// Folders macOS guards with its own question (Privacy & Security > Files and Folders), asked once per app.
export const PROTECTED_FOLDERS = ["Desktop", "Documents", "Downloads"];

export function ignored(path: string): boolean {
  return path.split(sep).some((segment) => IGNORED_NAME.test(segment));
}

// One settled batch -> what happened. A file that vanished from one place and appeared in another (same inode, or
// same name) was moved, or renamed if it stayed in the same folder. Anything else that appeared was created.
// Deletions are not steps (moving to the Trash is a delete as far as a skill is concerned), so they are dropped.
export function classify(batch: FsObservation[]): FsChange[] {
  const seen = batch.filter((o) => !ignored(o.path));
  const vanished = seen.filter((o) => o.kind === "vanish");
  const used = new Set<FsObservation>();
  const changes: FsChange[] = [];
  const created: FsObservation[] = [];

  for (const appeared of seen.filter((o) => o.kind === "appear")) {
    // Appeared and then vanished again in the same batch: a temporary file.
    if (vanished.some((v) => v.path === appeared.path && v.at >= appeared.at)) continue;
    const from = vanished.find(
      (v) =>
        !used.has(v) &&
        v.path !== appeared.path &&
        ((v.ino !== undefined && v.ino === appeared.ino) || basename(v.path) === basename(appeared.path)),
    );
    if (from) {
      used.add(from);
      const event = dirname(from.path) === dirname(appeared.path) ? "fs_rename" : "fs_move";
      changes.push({ event, path: from.path, toPath: appeared.path, at: appeared.at });
    } else created.push(appeared);
  }

  // A file we never saw before (so no inode) renamed in place: exactly one vanish and one appear in the same folder.
  for (const appeared of created) {
    const candidates = vanished.filter((v) => !used.has(v) && dirname(v.path) === dirname(appeared.path));
    const others = created.filter((c) => c !== appeared && dirname(c.path) === dirname(appeared.path));
    const from = candidates.length === 1 && others.length === 0 ? candidates[0] : undefined;
    if (from) {
      used.add(from);
      changes.push({ event: "fs_rename", path: from.path, toPath: appeared.path, at: appeared.at });
    } else if (!changes.some((c) => c.event === "fs_create" && c.path === appeared.path)) {
      changes.push({ event: "fs_create", path: appeared.path, at: appeared.at });
    }
  }
  return changes.sort((a, b) => a.at - b.at);
}

// Your home folder unless TASKPLAYER_WATCH_DIRS says otherwise ("~/Work:/Volumes/Drive", ":"-separated like PATH).
// Empty turns file capture off.
export function watchDirsFromEnv(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.TASKPLAYER_WATCH_DIRS;
  if (raw === undefined) return [homedir()];
  return raw
    .split(delimiter)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith("~") ? join(homedir(), p.slice(1)) : p));
}

// Asks macOS for the guarded folders inside the watched ones, once, when the daemon starts: macOS shows its question
// then (and remembers the answer), not in the middle of a recording. Returns the folders it refused.
export function askFolderAccess(dirs: string[], home = homedir()): string[] {
  const guarded = PROTECTED_FOLDERS.map((name) => join(home, name)).filter((p) =>
    dirs.some((d) => p === d || p.startsWith(`${d}${sep}`)),
  );
  return guarded.filter((p) => {
    try {
      readdirSync(p);
      return false;
    } catch (error) {
      return ["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "");
    }
  });
}

export function watchFiles(
  dirs: string[],
  onChange: (change: FsChange) => void,
  options: { log: (...args: unknown[]) => void; ignoreUnder?: string[]; settleMs?: number; home?: string },
): { close(): void } {
  const library = join(options.home ?? homedir(), "Library");
  // Except your cloud folders, which macOS keeps inside Library: Google Drive, OneDrive, Dropbox, and iCloud Drive.
  const cloud = CLOUD_FOLDERS.map((name) => join(library, name));
  const under = (path: string, root: string) => path === root || path.startsWith(`${root}${sep}`);
  const blocked = new Set<string>(); // folders macOS would not let us look into: said once, not per file
  const known = new Map<string, number>(); // path -> inode, so a vanished file can be matched to where it reappears
  const watchers: FSWatcher[] = [];
  let batch: FsObservation[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    const settled = batch;
    batch = [];
    for (const change of classify(settled)) onChange(change);
  };

  for (const dir of dirs) {
    try {
      // Listing the folder doubles as the permission check: macOS privacy (TCC) blocks it with EPERM.
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        try {
          known.set(path, statSync(path).ino);
        } catch {
          // vanished while listing
        }
      }
      // ~/Library is where apps keep their own files; skipped (but for cloud folders) unless you asked to watch a
      // folder inside it.
      const skipLibrary = !under(dir, library);
      const skipped = (path: string) =>
        (options.ignoreUnder ?? []).some((root) => under(path, root)) ||
        (skipLibrary && under(path, library) && !cloud.some((root) => under(path, root)));
      const watcher = watch(dir, { recursive: true }, (type, filename) => {
        if (!filename || type === "change") return; // content edits are not steps
        const path = join(dir, filename.toString());
        if (ignored(path) || skipped(path)) return;
        let ino: number | undefined;
        try {
          const stat = statSync(path);
          if (!stat.isFile()) return;
          ino = stat.ino;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          // macOS refused to look (a guarded folder you haven't allowed): not a file that vanished.
          if (code === "EPERM" || code === "EACCES") {
            const top = dirname(path);
            if (!blocked.has(top)) {
              blocked.add(top);
              options.log(`!! macOS blocked ${top}: allow your terminal in Privacy & Security > Files and Folders`);
            }
            return;
          }
          ino = undefined;
        }
        if (ino !== undefined && known.get(path) === ino) return; // the same file, rewritten in place
        batch.push(
          ino === undefined
            ? { kind: "vanish", path, at: Date.now(), ino: known.get(path) }
            : { kind: "appear", path, at: Date.now(), ino },
        );
        if (ino === undefined) known.delete(path);
        else known.set(path, ino);
        clearTimeout(timer);
        timer = setTimeout(flush, options.settleMs ?? 700);
      });
      watcher.on("error", (error) => options.log("file watch error in", dir, error.message));
      watchers.push(watcher);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") {
        options.log(
          `!! can't watch ${dir}: macOS privacy blocked it (${code}). File steps there won't be recorded.`,
          "Allow your terminal in System Settings → Privacy & Security → Files and Folders, then restart the daemon.",
        );
      } else options.log("can't watch", dir, code ?? error);
    }
  }

  return {
    close() {
      clearTimeout(timer);
      flush();
      for (const watcher of watchers) watcher.close();
    },
  };
}
