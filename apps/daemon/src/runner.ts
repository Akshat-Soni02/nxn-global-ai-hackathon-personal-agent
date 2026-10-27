// Runs a skill in the daemon: fs and script steps locally, web steps and page checks in the extension, ax steps
// (Mac apps) in Shadow.app.
// Every run is logged as JSON lines in ~/Library/Application Support/Shadow/runs/<runId>.jsonl.
//
// Recovery (runWithRecovery in @shadow/player/repair): a step that fails every attempt pauses the run, is
// repaired or waits for the user, and resumes. Repair transcripts go next to the run log (<runId>.repair-N.json).
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
import {
  fileExists,
  fsChannel,
  type LlmExecutor,
  poll,
  resolveInputs,
  savePdf,
  scriptChannel,
} from "@shadow/player/node";
import { type Recovery as PlayerRecovery, runWithRecovery } from "@shadow/player/repair";
import type { PageOp, PageOpResult } from "@shadow/player/web";
import type { Daemon } from "./daemon.ts";
import type { ScreenDescriber } from "./describe.ts";
import {
  connectedToolsOf,
  coveringApp,
  describeAppTool,
  listedToolsOf,
  type McpTools,
  mcpChannel,
  prepareMcpSteps,
} from "./mcp-tools.ts";

// Extra time on top of a step's own timeout for the round trip and the extension's work.
const EXTENSION_MARGIN_MS = 20_000;
const CHROME_START_MS = 30_000;

export interface RunHooks {
  // A step's approval. The service answers WAIT: the run then waits in the inbox (service.ts).
  approve: RunDeps["approve"];
  // A step's question for you (an ask); WAIT too.
  ask?: RunDeps["ask"];
  // A walk-through: every step waits for you (WAIT too), after its target was outlined on the page or in the app.
  walk?: RunDeps["walk"];
  log(event: RunLogEvent): void;
  // The test run (rehearse.ts): told whether each outline found its control.
  onHighlight?(step: ActionStep, error?: string): void;
  // data.pick steps (see dataChannel in @shadow/player/node).
  data?: ChannelExecutor;
  // llm steps (see llmExecutor in @shadow/player/node).
  llm?: LlmExecutor;
  // Recovery from failures. Without it, a step that fails every attempt fails the run.
  recovery?: Recovery;
  // Masked pictures for the repair agent's describe_screen (describe.ts). Used only when the user allowed pictures.
  describer?: ScreenDescriber;
  // Connected apps (mcp steps), through the signed-in account. Without it a workflow with mcp steps doesn't start.
  tools?: McpTools;
}

// Recovery as the daemon sets it up: the page, site notes, pictures and transcripts are filled in here.
export type Recovery = Omit<
  PlayerRecovery,
  "page" | "recall" | "note" | "available" | "appTool" | "onEpisode" | "describeScreen"
> & {
  // Site notes for the repair agent.
  memory?: MemoryStore;
};

// What the recording showed at each step, from the workflow's folder (skills/<id>/recorded.json, written when it was
// saved; the skills folder is beside the runs folder); empty for a workflow saved before it.
function recordedOf(logDir: string, skillId: string): Record<string, string> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(skillId)) return {};
  try {
    const path = join(dirname(logDir), "skills", skillId, "recorded.json");
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

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

// The workflow, when, and a short random part: two runs can start in the same millisecond (two files arriving at
// once, a trigger firing as you press Run now).
export const newRunId = (skillId: string, now = new Date()) =>
  `${skillId}-${now.toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 4)}`;

// One leg of a run: from the start, or from a waiting run's checkpoint (`resume`). A run's legs share its id, so they
// share one log file. Going on from a checkpoint doesn't resolve inputs again: the saved variables carry on.
export async function runSkillOn(
  daemon: Daemon,
  saved: Skill,
  options: { runId?: string; provided?: Record<string, unknown>; resume?: Resume; signal?: AbortSignal },
  hooks: RunHooks,
  logDir = join(APP_SUPPORT_DIR, "runs"),
): Promise<RunOutcome> {
  // Connected-app steps: their apps must be connected, and a tool that changes things asks first.
  const prepared = await prepareMcpSteps(saved, hooks.tools);
  if (prepared.error) return { status: "failed", vars: {}, error: prepared.error };
  const skill = prepared.skill;
  const runId = options.runId ?? newRunId(skill.id);
  const provided = options.provided ?? {};
  const { signal } = options;
  // Stopped by the user: the extension lets go of the automation tab at once (a step in progress there fails), and
  // nothing here waits for an answer any more.
  const stopped = () => daemon.notify({ id: randomUUID(), type: "run.end", runId });
  signal?.addEventListener("abort", stopped, { once: true });
  const untilStopped = <T>(work: Promise<T>): Promise<T> =>
    signal
      ? Promise.race([
          work,
          new Promise<never>((_, reject) => {
            if (signal.aborted) reject(new Error("you stopped it"));
            signal.addEventListener("abort", () => reject(new Error("you stopped it")), { once: true });
          }),
        ])
      : work;
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

  // A request that got no answer because the Mac slept through its timeout is asked once more after the wake: the
  // page or app didn't fail, the clock just jumped.
  const unlessAsleep = async <T>(ask: () => Promise<T>): Promise<T> => {
    const askedAt = Date.now();
    try {
      return await ask();
    } catch (error) {
      if (daemon.wokeAt() > askedAt && /did not answer/.test((error as Error).message)) return await ask();
      throw error;
    }
  };

  const web = async (step: ActionStep, ctx: { runId: string }): Promise<StepResult> => {
    await ensureExtension();
    const reply = await untilStopped(
      unlessAsleep(() =>
        daemon.request(
          { id: randomUUID(), type: "run.step", runId: ctx.runId, step },
          (step.timeout_ms ?? DEFAULT_TIMEOUT_MS) * 3 + EXTENSION_MARGIN_MS,
        ),
      ),
    );
    if (reply.type !== "run.step_result") throw new Error(`unexpected reply ${reply.type}`);
    const { ok, value, matchScore, matchedBy, failedCheck, error } = reply;
    // web.save_pdf: the extension printed the page; the file is written here (never its bytes into the run's log).
    if (ok && step.action === "save_pdf") {
      const pdf = (value as { pdf?: unknown } | undefined)?.pdf;
      if (typeof pdf !== "string") return { ok: false, error: "the page could not be printed to a PDF" };
      return { ok, value: await savePdf(step.args, pdf) };
    }
    return { ok, value, matchScore, matchedBy, failedCheck, error };
  };

  // Mac-app steps act through the Accessibility API, which only Shadow.app is allowed to use. The app itself says
  // when macOS hasn't allowed it yet (the step fails with how to allow it).
  const ax = async (step: ActionStep, ctx: { runId: string }): Promise<StepResult> => {
    if (!daemon.mac().connected) throw new Error("Shadow.app is not running: build it with pnpm setup:mac");
    const reply = await untilStopped(
      unlessAsleep(() =>
        daemon.requestMac(
          { id: randomUUID(), type: "run.step", runId: ctx.runId, step },
          (step.timeout_ms ?? DEFAULT_TIMEOUT_MS) * 2 + EXTENSION_MARGIN_MS,
        ),
      ),
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

  // A walk-through outlines where a step would act: on the page through the extension, in a Mac app through
  // Shadow.app. Acting on nothing.
  const highlight = async (step: ActionStep): Promise<void> => {
    if (!step.target) return;
    if (step.channel === "web") {
      // In the step's own tab: the extension's last-used one is the previous step's.
      const result = await page({ op: "highlight", target: step.target, ...(step.tab ? { tab: step.tab } : {}) });
      if (!result.ok) throw new Error(result.error);
      return;
    }
    if (step.channel === "ax") {
      if (!daemon.mac().connected) throw new Error("Shadow.app is not running");
      const reply = await daemon.requestMac({ id: randomUUID(), type: "ax.highlight", target: step.target }, 15_000);
      if (reply.type !== "ax.highlight_result") throw new Error(`unexpected reply ${reply.type}`);
      if (!reply.ok) throw new Error(reply.error ?? "could not highlight the control");
    }
  };

  let ended: RunOutcome | undefined;
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
      mcp: hooks.tools ? mcpChannel(hooks.tools) : undefined,
      approve: hooks.approve,
      ask: hooks.ask,
      walk: hooks.walk,
      highlight: hooks.walk
        ? async (step: ActionStep) => {
            try {
              await highlight(step);
              hooks.onHighlight?.(step);
            } catch (error) {
              hooks.onHighlight?.(step, (error as Error).message);
              throw error;
            }
          }
        : undefined,
      log,
    };
    const resume = options.resume;
    const inputs = resume ? provided : await resolveInputs(skill, provided);
    if (!hooks.recovery) {
      ended = await runSkill(skill, deps, { runId, inputs, resume, signal });
      return ended;
    }
    const { memory, ...recovery } = hooks.recovery;
    // Episodes are numbered across the run's legs, so a leg after a wait doesn't overwrite an earlier transcript.
    const earlier = readdirSync(logDir).filter((f) => f.startsWith(`${runId}.repair-`)).length;
    const describer = hooks.describer?.allowed() ? hooks.describer : undefined;
    // The page's own picture (through the extension) or the frontmost window's (through Shadow.app), masked by the
    // describer before the vision model sees it. The workflow's Never words are masked too.
    const describeScreen = describer
      ? async (question: string, channel: "web" | "ax") => {
          const never = skill.description.never;
          let described: { description: string; words: string };
          if (channel === "ax") {
            const path = describer.tempPath();
            try {
              const reply = await daemon.requestMac({ id: randomUUID(), type: "mac.screenshot", path }, 15_000);
              if (reply.type !== "mac.screenshot_result") throw new Error(`unexpected reply ${reply.type}`);
              if (!reply.ok) throw new Error(reply.error ?? "no picture of the window");
              described = await describer.describe({ path }, question, never);
            } finally {
              // The app may write the window's picture even when the request failed or timed out: never leave it
              // (unmasked) on disk.
              rmSync(path, { force: true });
            }
          } else {
            const shot = await page({ op: "screenshot" });
            if (!shot.ok) throw new Error(shot.error);
            described = await describer.describe({ image: String(shot.value) }, question, never);
          }
          return `${described.description}\n\nWords on screen (private ones masked):\n${described.words}`;
        }
      : undefined;
    // The connected apps' tools, for repair's briefing: it was never told any ("none"), so it could not move a step that
    // clicks into an app's page to the app's own tool (X4). The list is cached, so this is one call at most.
    const connectedTools = await connectedToolsOf(hooks.tools);
    const listedTools = await listedToolsOf(hooks.tools);
    ended = await runWithRecovery(skill, deps, {
      runId,
      inputs,
      resume,
      signal,
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
        describeScreen,
        // A connected tool's arguments, so repair doesn't guess them when it switches a step to the app.
        appTool: listedTools.length > 0 ? (name: string) => describeAppTool(listedTools, name) : undefined,
        // The connected app that covers a failing step's page: repair moves the step to its tool (A3, app-first).
        appFor: listedTools.length > 0 ? (url: string) => coveringApp(listedTools, url) : undefined,
        // What the recording showed at the step, kept beside the workflow's versions (review-store.ts).
        recorded: (stepId) => recordedOf(logDir, skill.id)[stepId],
        available: () => ({
          extension: daemon.extensions.size > 0,
          macApp: daemon.mac().connected,
          screenConsent: describer !== undefined,
          connectedTools,
        }),
        onEpisode: (n, record) =>
          writeFileSync(
            logFile.replace(/\.jsonl$/, `.repair-${earlier + n}.json`),
            `${JSON.stringify(record, null, 1)}\n`,
          ),
      },
    });
    return ended;
  } finally {
    signal?.removeEventListener("abort", stopped);
    // The extension lets go of the run's tabs (and closes its named ones) only when the run is over: a leg that waits
    // for an answer keeps them, so the next leg goes on in the same tabs (F6: a run waiting for an OK lost them).
    if (ended?.status !== "waiting") daemon.notify({ id: randomUUID(), type: "run.end", runId });
  }
}
