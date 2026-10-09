// Runs a skill in the daemon: fs and script steps locally, web steps and page checks in the extension, ax steps
// (Mac apps) in Task Player.app.
// Every run is logged as JSON lines in ~/Library/Application Support/TaskPlayer/runs/<runId>.jsonl.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type ActionStep, type Message, Skill, type Step } from "@taskplayer/core";
import { APP_SUPPORT_DIR } from "@taskplayer/ipc";
import {
  type ChannelExecutor,
  DEFAULT_TIMEOUT_MS,
  type RunLogEvent,
  type RunOutcome,
  runSkill,
  type StepResult,
} from "@taskplayer/player";
import { fileExists, fsChannel, type LlmExecutor, poll, resolveInputs, scriptChannel } from "@taskplayer/player/node";
import type { Daemon } from "./daemon.ts";

// Extra time on top of a step's own timeout for the round trip and the extension's work.
const EXTENSION_MARGIN_MS = 20_000;
const CHROME_START_MS = 30_000;

export interface RunHooks {
  approve(step: Step, skill: Skill): Promise<boolean>;
  log(event: RunLogEvent): void;
  // data.pick steps (see dataChannel in @taskplayer/player/node).
  data?: ChannelExecutor;
  // llm steps (see llmExecutor in @taskplayer/player/node).
  llm?: LlmExecutor;
}

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

  try {
    return await runSkill(
      skill,
      {
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
        log,
      },
      { runId, inputs: await resolveInputs(skill, provided) },
    );
  } finally {
    daemon.notify({ id: randomUUID(), type: "run.end", runId });
  }
}
