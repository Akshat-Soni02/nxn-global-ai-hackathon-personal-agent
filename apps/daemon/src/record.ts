// Record, daemon side. While recording: every event goes to the session's trace file, web events from the extension
// and file events from the folder watcher alike. After stop: trace -> normalise -> compile (Nemotron) -> drill ->
// skills/<id>/vN.json. The trace is kept, so a failed or poor compile can be redone with `compile <session>`.
import { randomUUID } from "node:crypto";
import type { Skill, TraceEvent } from "@taskplayer/core";
import { chat, configFromEnv } from "@taskplayer/llm";
import type { MemoryStore } from "@taskplayer/memory";
import { type Chat, compile, drill, normalise, type Prompter, settleDataSteps } from "@taskplayer/recorder";
import { watchFiles } from "./fs-watch.ts";
import { type LocateOptions, locateFiles } from "./locate-file.ts";
import { saveSkill, versions } from "./skill-store.ts";
import { appendTrace, readTrace } from "./trace-store.ts";

type Log = (...args: unknown[]) => void;

export interface Recording {
  sessionId: string;
  append(event: TraceEvent): void;
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
  const watcher =
    options.watchDirs.length > 0
      ? watchFiles(options.watchDirs, (change) => append({ id: randomUUID(), sessionId, ...change }), {
          log: options.log,
          ignoreUnder: [options.dataDir],
        })
      : undefined;
  return { sessionId, append, stopWatching: () => watcher?.close() };
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
  const saved = saveSkill(dataDir, settleDataSteps(drilled.skill));
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

function freeId(dataDir: string, id: string): string {
  for (let n = 2; ; n++) {
    const candidate = `${id}-${n}`;
    if (versions(dataDir, candidate).length === 0) return candidate;
  }
}
