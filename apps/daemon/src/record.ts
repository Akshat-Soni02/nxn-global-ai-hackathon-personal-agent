// Record, daemon side. While recording: every event goes to the session's trace file, web events from the extension
// and file events from the folder watcher alike. After stop: trace -> normalise -> compile (Nemotron) -> drill ->
// skills/<id>/vN.json. The trace is kept, so a failed or poor compile can be redone with `compile <session>`.
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, sep } from "node:path";
import type { Skill, TraceEvent } from "@taskplayer/core";
import { chat, configFromEnv } from "@taskplayer/llm";
import type { MemoryStore } from "@taskplayer/memory";
import { type Chat, compile, drill, normalise, type Prompter } from "@taskplayer/recorder";
import { type FsChange, watchFiles } from "./fs-watch.ts";
import { type LocateOptions, locateFiles } from "./locate-file.ts";
import { newSkillId, saveSkill } from "./skill-store.ts";
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
  chat?: Chat;
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

  log(options.chat ? "compiling with Nemotron..." : "compiling with code only (no model configured)...");
  const price = Number(process.env.NEMOTRON_PRICE_PER_MTOK);
  const compiled = await compile(steps, {
    chat: options.chat,
    memory: options.memory,
    pricePerMTok: Number.isFinite(price) && price > 0 ? price : undefined,
  });
  for (const warning of compiled.warnings) log(warning);
  if (compiled.model === "nemotron") log(`model answer accepted after ${compiled.attempts} attempt(s)`);

  // Every recording is a new skill, even of a task you already have: its own id, so recordings never collide.
  const skill = { ...compiled.skill, id: newSkillId(dataDir, compiled.skill.id) };

  if (compiled.questions.length > 0)
    log(`${compiled.questions.length} question(s) before saving. Enter takes the default.`);
  const drilled = await drill(skill, compiled.questions, { prompter: options.prompter, memory: options.memory });
  for (const problem of drilled.problems) log("answer not applied:", problem);

  // A per-run AI step you declined in the drill goes back to its free rule.
  const saved = saveSkill(dataDir, drilled.skill);
  log(`saved ${saved.skill.id} v${saved.skill.version}: ${saved.path}`);
  return saved;
}

// The model client for data.ai steps at run time: plain text answers, not the JSON object compile asks for.
export function askFromEnv(env: Record<string, string | undefined> = process.env) {
  let config: ReturnType<typeof configFromEnv>;
  try {
    config = configFromEnv(env);
  } catch {
    return undefined;
  }
  return (system: string, user: string) =>
    chat(
      config,
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { signal: AbortSignal.timeout(60_000) },
    );
}

// The model client for compile, or undefined when NEBIUS_BASE_URL / NEBIUS_API_KEY / NEMOTRON_MODEL aren't set.
export function chatFromEnv(env: Record<string, string | undefined> = process.env): Chat | undefined {
  let config: ReturnType<typeof configFromEnv>;
  try {
    config = configFromEnv(env);
  } catch {
    return undefined;
  }
  return async (messages) => {
    try {
      return await chat(config, messages, { json: true, signal: AbortSignal.timeout(120_000) });
    } catch (error) {
      // Some endpoints reject response_format. Ask again without it: compile extracts the JSON itself.
      if (!/response_format|json_object/i.test(String(error))) throw error;
      return chat(config, messages, { signal: AbortSignal.timeout(120_000) });
    }
  };
}
