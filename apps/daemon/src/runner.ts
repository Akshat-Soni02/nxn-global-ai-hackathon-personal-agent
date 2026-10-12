// Runs a skill in the daemon: fs and script steps locally, web steps and page checks in the extension, ax steps
// (Mac apps) in Shadow.app.
// Every run is logged as JSON lines in ~/Library/Application Support/Shadow/runs/<runId>.jsonl.
//
// Recovery (runWithRecovery in @shadow/player/repair): a step that fails every attempt pauses the run, is
// repaired or waits for the user, and resumes. Repair transcripts go next to the run log (<runId>.repair-N.json).
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ActionStep, type Message, Skill } from "@shadow/core";
import { APP_SUPPORT_DIR } from "@shadow/ipc";
import type { MemoryStore } from "@shadow/memory";
import {
  type ChannelExecutor,
  DEFAULT_TIMEOUT_MS,
  type Resume,
  type RunDeps,
  type RunLogEvent,
  type RunOutcome,
  runSkill,
  type StepResult,
} from "@shadow/player";
import { fileExists, fsChannel, type LlmExecutor, poll, resolveInputs, scriptChannel } from "@shadow/player/node";
import { type Recovery as PlayerRecovery, runWithRecovery } from "@shadow/player/repair";
import type { PageOp, PageOpResult } from "@shadow/player/web";
import type { Daemon } from "./daemon.ts";

// Extra time on top of a step's own timeout for the round trip and the extension's work.
const EXTENSION_MARGIN_MS = 20_000;
const CHROME_START_MS = 30_000;

export interface RunHooks {
  // A step's approval. The service answers WAIT: the run then waits in the inbox (service.ts).
  approve: RunDeps["approve"];
  // A step's question for you (an ask); WAIT too.
  ask?: RunDeps["ask"];
  log(event: RunLogEvent): void;
  // data.pick steps (see dataChannel in @shadow/player/node).
  data?: ChannelExecutor;
  // llm steps (see llmExecutor in @shadow/player/node).
  llm?: LlmExecutor;
  // Recovery from failures. Without it, a step that fails every attempt fails the run.
  recovery?: Recovery;
}

// Recovery as the daemon sets it up: the page, site notes, and transcripts are filled in here.
export type Recovery = Omit<PlayerRecovery, "page" | "recall" | "note" | "available" | "onEpisode"> & {
  // Site notes for the repair agent.
  memory?: MemoryStore;
};

export async function runSkillFile(
  daemon: Daemon,
  path: string,
  provided: Record<string, unknown>,
  hooks: RunHooks,
  logDir = join(APP_SUPPORT_DIR, "runs"),
): Promise<RunOutcome> {
  const skill = Skill.parse(JSON.parse(readFileSync(path, "utf8")));
  return runSkillOn(daemon, skill, { provided }, hooks, logDir);
}

export const newRunId = (skillId: string, now = new Date()) => `${skillId}-${now.toISOString().replace(/[:.]/g, "-")}`;

// One leg of a run: from the start, or from a waiting run's checkpoint (`resume`). A run's legs share its id, so they
// share one log file. Going on from a checkpoint doesn't resolve inputs again: the saved variables carry on.
export async function runSkillOn(
  daemon: Daemon,
  skill: Skill,
  options: { runId?: string; provided?: Record<string, unknown>; resume?: Resume },
  hooks: RunHooks,
  logDir = join(APP_SUPPORT_DIR, "runs"),
): Promise<RunOutcome> {
  const runId = options.runId ?? newRunId(skill.id);
  const provided = options.provided ?? {};
  mkdirSync(logDir, { recursive: true });
  const logFile = join(logDir, `${runId}.jsonl`);
  const log = (event: RunLogEvent) => {
    appendFileSync(logFile, `${JSON.stringify({ at: Date.now(), ...event })}\n`);
    hooks.log(event);
  };

  const ensureExtension = async () => {
    if (daemon.extensions.size > 0) return;
    // Open Chrome in the background; its extension connects on startup.
    execFile("open", ["-g", "-a", "Google Chrome"]);
    if (!(await daemon.waitForExtension(CHROME_START_MS))) throw new Error("Chrome's extension did not connect");
  };

  const web = async (step: ActionStep, ctx: { runId: string }): Promise<StepResult> => {
    await ensureExtension();
    const reply = await daemon.request(
      { id: randomUUID(), type: "run.step", runId: ctx.runId, step },
      (step.timeout_ms ?? DEFAULT_TIMEOUT_MS) * 3 + EXTENSION_MARGIN_MS,
    );
    if (reply.type !== "run.step_result") throw new Error(`unexpected reply ${reply.type}`);
    const { ok, value, matchScore, matchedBy, failedCheck, error } = reply;
    return { ok, value, matchScore, matchedBy, failedCheck, error };
  };

  // Mac-app steps act through the Accessibility API, which only Shadow.app is allowed to use. The app itself says
  // when macOS hasn't allowed it yet (the step fails with how to allow it).
  const ax = async (step: ActionStep, ctx: { runId: string }): Promise<StepResult> => {
    if (!daemon.mac().connected) throw new Error("Shadow.app is not running: build it with pnpm setup:mac");
    const reply = await daemon.requestMac(
      { id: randomUUID(), type: "run.step", runId: ctx.runId, step },
      (step.timeout_ms ?? DEFAULT_TIMEOUT_MS) * 2 + EXTENSION_MARGIN_MS,
    );
    if (reply.type !== "run.step_result") throw new Error(`unexpected reply ${reply.type}`);
    const { ok, value, matchScore, matchedBy, error } = reply;
    return { ok, value, matchScore, matchedBy, error };
  };

  const page = async (op: PageOp): Promise<PageOpResult> => {
    await ensureExtension();
    const reply = await daemon.request({ id: randomUUID(), type: "page.op", runId, op }, 30_000 + EXTENSION_MARGIN_MS);
    if (reply.type !== "page.op_result") throw new Error(`unexpected reply ${reply.type}`);
    return reply.ok ? { ok: true, value: reply.value } : { ok: false, error: reply.error ?? "failed" };
  };

  try {
    const deps: RunDeps = {
      web,
      fs: fsChannel,
      script: scriptChannel,
      fileExists: (pattern, timeoutMs) => poll(() => fileExists(pattern), timeoutMs),
      async webCheck(check, timeoutMs) {
        await ensureExtension();
        const reply: Message = await daemon.request(
          { id: randomUUID(), type: "run.check", runId, check, timeoutMs },
          timeoutMs + EXTENSION_MARGIN_MS,
        );
        return reply.type === "run.check_result" && reply.ok;
      },
      data: hooks.data,
      llm: hooks.llm,
      ax,
      approve: hooks.approve,
      ask: hooks.ask,
      log,
    };
    const resume = options.resume;
    const inputs = resume ? provided : await resolveInputs(skill, provided);
    if (!hooks.recovery) return await runSkill(skill, deps, { runId, inputs, resume });
    const { memory, ...recovery } = hooks.recovery;
    // Episodes are numbered across the run's legs, so a leg after a wait doesn't overwrite an earlier transcript.
    const earlier = readdirSync(logDir).filter((f) => f.startsWith(`${runId}.repair-`)).length;
    return await runWithRecovery(skill, deps, {
      runId,
      inputs,
      resume,
      recovery: {
        ...recovery,
        page,
        recall:
          memory && (async (query, skillId) => (await memory.search(query, { skillId, limit: 5 })).map((m) => m.text)),
        note:
          memory &&
          (async (text, skillId) => {
            await memory.add({ kind: "site_note", text, skillId });
          }),
        available: () => ({
          extension: daemon.extensions.size > 0,
          macApp: daemon.mac().connected,
          screenConsent: false,
        }),
        onEpisode: (n, record) =>
          writeFileSync(
            logFile.replace(/\.jsonl$/, `.repair-${earlier + n}.json`),
            `${JSON.stringify(record, null, 1)}\n`,
          ),
      },
    });
  } finally {
    daemon.notify({ id: randomUUID(), type: "run.end", runId });
  }
}
