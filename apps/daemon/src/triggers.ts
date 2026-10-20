// Triggers (docs/design.md, "Triggers"): live workflows start on their own. Runs in the daemon.
//
// Schedules: each live workflow's next time comes from its cron (croner, the Mac's time zone). tick() looks every
// so often (main.ts: every 30 s), which also notices the clock jumping after the Mac wakes. When a schedule last
// fired is saved (trigger_marks), so a restart never runs the same time twice. A time found more than graceMs late
// was missed: `missed: "run_once"` runs it once (never once per missed time), `"skip"` waits for the next one.
//
// Folders: only the chosen folder is watched. A file has appeared once its size and modified time stayed the same
// across scans settleMs apart, so downloads and copies still being written don't start a run; temporary and hidden
// names are ignored. Files that started a run are remembered (trigger_files). A file from before the workflow went
// live never counts. Files that arrived while Shadow wasn't running are found by the first scan, and follow `missed`.
// A file that appears while the workflow's previous run is still going or waiting waits its turn (it is not marked,
// so a later scan starts it): unlike a schedule's time, a file is work that must not be lost.
import { type FSWatcher, statSync, watch } from "node:fs";
import { basename } from "node:path";
import { type Skill, type Trigger, triggerOf } from "@shadow/core";
import { expandHome, findFiles } from "@shadow/player/node";
import { folderInput, nextTime, readState, triggerKey } from "./lifecycle.ts";
import { readReview } from "./review-store.ts";
import type { Service } from "./service.ts";
import { listSkills, loadSkill } from "./skill-store.ts";
import type { Store } from "./store.ts";

const TEMPORARY = /^\.|\.crdownload$|\.download$|\.part$|\.tmp$|\.swp$|^~\$/;

export interface Triggers {
  // Looks at every live workflow: fires due schedules, starts or stops folder watches, scans folders.
  tick(): Promise<void>;
  stop(): void;
}

export function startTriggers(options: {
  dataDir: string;
  store: Store;
  service: Pick<Service, "fire" | "busy">;
  now?: () => number;
  log?: (...args: unknown[]) => void;
  settleMs?: number;
  graceMs?: number;
  // Watches a folder for changes (fs.watch); tests pass a fake.
  watchDir?: (dir: string, recursive: boolean, onChange: () => void) => { close(): void };
}): Triggers {
  const { dataDir, store, service } = options;
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => {});
  const settleMs = options.settleMs ?? 3_000;
  const graceMs = options.graceMs ?? 120_000;
  const watchDir =
    options.watchDir ??
    ((dir: string, recursive: boolean, onChange: () => void) => {
      const watcher: FSWatcher = watch(dir, { recursive }, onChange);
      watcher.on("error", () => {});
      return watcher;
    });
  const started = now();
  const folders = new Map<string, Folder>();

  interface Folder {
    scan(): Promise<void>;
    close(): void;
  }

  function schedule(skill: Skill, index: number, trigger: Extract<Trigger, { type: "schedule" }>, since: number) {
    const key = triggerKey(index, trigger);
    // From the later of: the last time it fired, and when the workflow went live (or was resumed).
    const from = Math.max(store.getMark(skill.id, key) ?? 0, since);
    const due = nextTime(trigger.cron, from);
    const at = now();
    if (due === undefined || due > at) return;
    store.setMark(skill.id, key, at);
    const late = at - due > graceMs;
    const lateness = late
      ? ` (missed at ${new Date(due).toLocaleString()}, ${Math.round((at - due) / 60_000)} min late)`
      : "";
    if (late && trigger.missed === "skip") {
      log(`${skill.id}: skipped its missed time${lateness}; next time as usual`);
      return;
    }
    log(`${skill.id}: schedule ${trigger.cron} fired${lateness}`);
    const run = service.fire(skill.id, "schedule");
    if (run.status === "skipped") log(`${skill.id}: ${run.error}`);
  }

  function folder(skill: Skill, index: number, trigger: Extract<Trigger, { type: "folder_watch" }>, since: number) {
    const key = triggerKey(index, trigger);
    const id = `${skill.id}|${key}|${since}`;
    if (folders.has(id)) return id;
    const dir = expandHome(trigger.dir);
    const glob = trigger.glob ?? "*";
    const input = folderInput(skill, trigger);
    const pending = new Map<string, { size: number; mtime: number; since: number }>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let watcher: { close(): void } | undefined;
    let warned = false;
    const later = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => void scan(), ms);
      timer.unref?.();
    };

    async function scan() {
      let found: string[];
      try {
        found = await findFiles(dir, glob);
        warned = false;
      } catch (error) {
        if (!warned) log(`${skill.id}: can't look in ${dir}: ${(error as Error).message}`);
        warned = true;
        return;
      }
      watcher ??= tryWatch();
      for (const path of found.reverse()) {
        if (TEMPORARY.test(basename(path)) || !input) continue;
        let info: ReturnType<typeof statSync>;
        try {
          info = statSync(path);
        } catch {
          continue;
        }
        // When it arrived: a copy keeps its old modified time but gets a new change time.
        const arrived = Math.max(info.mtimeMs, info.ctimeMs, info.birthtimeMs);
        if (arrived < since) continue;
        const fileKey = `${key}|${path}|${info.ino}|${info.size}|${info.mtimeMs}`;
        if (store.seenFile(skill.id, fileKey)) continue;
        if (arrived < started && trigger.missed === "skip") {
          store.markFile(skill.id, fileKey, now());
          continue;
        }
        const seen = pending.get(path);
        if (!seen || seen.size !== info.size || seen.mtime !== info.mtimeMs) {
          pending.set(path, { size: Number(info.size), mtime: info.mtimeMs, since: now() });
          later(settleMs);
          continue;
        }
        if (now() - seen.since < settleMs) {
          later(settleMs - (now() - seen.since));
          continue;
        }
        // One run at a time per workflow: the file waits its turn, unmarked.
        if (service.busy(skill.id)) {
          later(settleMs);
          continue;
        }
        pending.delete(path);
        store.markFile(skill.id, fileKey, now());
        log(`${skill.id}: ${basename(path)} appeared in ${trigger.dir}`);
        service.fire(skill.id, "folder", { [input]: path });
      }
    }

    function tryWatch() {
      try {
        return watchDir(dir, glob.includes("/"), () => later(500));
      } catch {
        return undefined; // the folder doesn't exist yet: the periodic scan keeps looking
      }
    }

    if (!input) log(`${skill.id}: its folder trigger has no file input to give the file to`);
    folders.set(id, {
      scan,
      close() {
        clearTimeout(timer);
        watcher?.close();
      },
    });
    return id;
  }

  return {
    async tick() {
      const active = new Set<string>();
      for (const { id } of listSkills(dataDir)) {
        const state = readState(dataDir, id);
        if (state.state !== "live") continue;
        const skill = loadSkill(dataDir, id);
        if (!skill) continue;
        // A design not looked at yet doesn't start on its own (a live workflow recorded again): Looks right first.
        const review = readReview(dataDir, id);
        if (review && !review.reviewed && review.version <= skill.version) continue;
        triggerOf(skill).when.forEach((trigger, index) => {
          if (trigger.type === "schedule") schedule(skill, index, trigger, state.since);
          if (trigger.type === "folder_watch") active.add(folder(skill, index, trigger, state.since));
        });
      }
      // Stop watching folders of workflows no longer live, or whose trigger changed.
      for (const [id, watched] of folders) {
        if (active.has(id)) continue;
        watched.close();
        folders.delete(id);
      }
      for (const watched of folders.values()) await watched.scan();
    },
    stop() {
      for (const watched of folders.values()) watched.close();
      folders.clear();
    },
  };
}
