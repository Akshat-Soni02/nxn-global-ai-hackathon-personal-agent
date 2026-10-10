// Runs a skill in the daemon: fs and script steps locally, web steps and page checks in the extension, ax steps
// (Mac apps) in Task Player.app.
// Every run is logged as JSON lines in ~/Library/Application Support/TaskPlayer/runs/<runId>.jsonl.
//
// Recovery (runWithRecovery in @taskplayer/player/repair): a step that fails every attempt pauses the run, is
// repaired or waits for the user, and resumes. Repair transcripts go next to the run log (<runId>.repair-N.json).
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ActionStep, type Message, Skill, type Step } from "@taskplayer/core";
import { APP_SUPPORT_DIR } from "@taskplayer/ipc";
import type { MemoryStore } from "@taskplayer/memory";
import {
  type ChannelExecutor,
  DEFAULT_TIMEOUT_MS,
  type RunDeps,
  type RunLogEvent,
  type RunOutcome,
  runSkill,
  type StepResult,
} from "@taskplayer/player";
import { fileExists, fsChannel, type LlmExecutor, poll, resolveInputs, scriptChannel } from "@taskplayer/player/node";
import { type Recovery as PlayerRecovery, runWithRecovery } from "@taskplayer/player/repair";
import type { PageOp, PageOpResult } from "@taskplayer/player/web";
import type { Daemon } from "./daemon.ts";

// Extra time on top of a step's own timeout for the round trip and the extension's work.
const EXTENSION_MARGIN_MS = 20_000;
const CHROME_START_MS = 30_000;

export interface RunHooks {
  approve(step: Step, skill: Skill): Promise<boolean>;
  // A step's question for you (an ask), answered in the daemon terminal.
  ask?: RunDeps["ask"];
  log(event: RunLogEvent): void;
  // data.pick steps (see dataChannel in @taskplayer/player/node).
  data?: ChannelExecutor;
  // llm steps (see llmExecutor in @taskplayer/player/node).
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
  const runId = `${skill.id}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
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

  // Mac-app steps act through the Accessibility API, which only Task Player.app is allowed to use. The app itself says
  // when macOS hasn't allowed it yet (the step fails with how to allow it).
  const ax = async (step: ActionStep, ctx: { runId: string }): Promise<StepResult> => {
    if (!daemon.mac().connected) throw new Error("Task Player.app is not running: build it with pnpm setup:mac");
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
    const inputs = await resolveInputs(skill, provided);
    if (!hooks.recovery) return await runSkill(skill, deps, { runId, inputs });
    const { memory, ...recovery } = hooks.recovery;
    return await runWithRecovery(skill, deps, {
      runId,
      inputs,
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
          writeFileSync(logFile.replace(/\.jsonl$/, `.repair-${n}.json`), `${JSON.stringify(record, null, 1)}\n`),
      },
    });
  } finally {
    daemon.notify({ id: randomUUID(), type: "run.end", runId });
  }
}
