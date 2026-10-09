// Record, daemon side. While recording: every event goes to the session's trace file, web events from the extension
// and file events from the folder watcher alike. After stop: trace -> normalise -> compile (Nemotron) -> drill ->
// skills/<id>/vN.json. The trace is kept, so a failed or poor compile can be redone with `compile <session>`.
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, sep } from "node:path";
import type { Skill, TraceEvent } from "@taskplayer/core";
import type { Llm } from "@taskplayer/llm";
import type { MemoryStore } from "@taskplayer/memory";
import { type Chat, compile, drill, normalise, type Prompter } from "@taskplayer/recorder";
import { type FsChange, watchFiles } from "./fs-watch.ts";
import { type LocateOptions, locateFiles } from "./locate-file.ts";
import { saveSkill, versions } from "./skill-store.ts";
import { appendTrace, readTrace } from "./trace-store.ts";

type Log = (...args: unknown[]) => void;

export interface Recording {
  sessionId: string;
  append(event: TraceEvent): void;
  // A folder opened in Finder outside the watched ones: watched for the rest of this recording. True if it is new.
  watchFolder(path: string): boolean;
  stopWatching(): void;
}

export function openRecording(
  sessionId: string,
  options: { dataDir: string; watchDirs: string[]; log: Log },
): Recording {
  const append = (event: TraceEvent) => {
    try {
      appendTrace(options.dataDir, event);
    } catch (error) {
      options.log("could not write trace event", error instanceof Error ? error.message : error);
    }
  };
  const onChange = (change: FsChange) => append({ id: randomUUID(), sessionId, ...change });
  const watch = (dirs: string[]) => watchFiles(dirs, onChange, { log: options.log, ignoreUnder: [options.dataDir] });
  const roots = [...options.watchDirs];
  const watchers = roots.length > 0 ? [watch(roots)] : [];
  const covered = (path: string) => roots.some((r) => path === r || path.startsWith(`${r}${sep}`));

  const watchFolder = (folder: string) => {
    if (watchers.length === 0 || !isAbsolute(folder) || !existsSync(folder)) return false; // file capture is off
    // On an external drive, the whole drive: a file is usually moved between two of its folders.
    const drive = /^\/Volumes\/[^/]+/.exec(folder)?.[0];
    let root = drive ?? folder;
    try {
      root = realpathSync(root);
    } catch {
      return false;
    }
    // /Volumes/Macintosh HD is your startup disk ("/"): never watched whole.
    if (root === "/" || covered(root)) return false;
    roots.push(root);
    watchers.push(watch([root]));
    options.log(`watching ${root} too (opened in Finder)`);
    return true;
  };
  const stopWatching = () => {
    for (const w of watchers) w.close();
  };
  return { sessionId, append, watchFolder, stopWatching };
}

export interface FinishOptions {
  dataDir: string;
  prompter: Prompter;
  // The model client; without one, skills are compiled by code only.
  llm?: Llm;
  memory?: MemoryStore;
  // Where to look for files the pages saw (picked or dropped). Off when absent, e.g. in tests.
  locate?: LocateOptions;
  log: Log;
}

export async function finishRecording(
  sessionId: string,
  options: FinishOptions,
): Promise<{ path: string; skill: Skill } | undefined> {
  const { dataDir, log } = options;
  // Pages never see a file's path; find each picked or dropped file on disk so the skill knows where they live.
  const raw = readTrace(dataDir, sessionId);
  const trace = options.locate ? await locateFiles(raw, options.locate) : raw;
  const steps = normalise(trace);
  log(`trace ${sessionId}: ${trace.length} event(s) -> ${steps.length} step(s)`);
  if (steps.length === 0) {
    log("nothing to compile");
    return undefined;
  }

  const { llm } = options;
  log(llm ? "compiling with Nemotron..." : "compiling with code only (no model configured)...");
  // Per-run AI steps run on the fast profile: its input price is what the drill shows them costing.
  const fast = llm?.config.catalog[llm.config.profiles.fast.model];
  const compiled = await compile(steps, {
    chat: llm ? compileChat(llm) : undefined,
    memory: options.memory,
    pricePerMTok: fast?.priceIn,
  });
  for (const warning of compiled.warnings) log(warning);
  if (compiled.model === "nemotron") log(`model answer accepted after ${compiled.attempts} attempt(s)`);

  // Same id as a skill you already have: a new version of it, or a separate skill?
  let skill = compiled.skill;
  const existing = versions(dataDir, skill.id);
  if (existing.length > 0) {
    const answer = await options.prompter.ask({
      id: "same-id",
      text: `A skill called ${skill.id} already exists (v${existing.join(", v")}). Save this as its next version or as a new skill?`,
      options: [{ label: "next version" }, { label: "new skill" }],
      default: "next version",
    });
    if (/^(2|new skill)$/i.test(answer.trim())) skill = { ...skill, id: freeId(dataDir, skill.id) };
  }

  if (compiled.questions.length > 0)
    log(`${compiled.questions.length} question(s) before saving. Enter takes the default.`);
  const drilled = await drill(skill, compiled.questions, { prompter: options.prompter, memory: options.memory });
  for (const problem of drilled.problems) log("answer not applied:", problem);

  // A per-run AI step you declined in the drill goes back to its free rule.
  const saved = saveSkill(dataDir, drilled.skill);
  log(`saved ${saved.skill.id} v${saved.skill.version}: ${saved.path}`);
  return saved;
}

// Compile asks the smart profile for a JSON object; compile checks the answer itself and asks again if it must.
export function compileChat(llm: Llm): Chat {
  return async (messages) => (await llm.generate({ profile: "smart", messages, json: true })).text;
}

function freeId(dataDir: string, id: string): string {
  for (let n = 2; ; n++) {
    const candidate = `${id}-${n}`;
    if (versions(dataDir, candidate).length === 0) return candidate;
  }
}
